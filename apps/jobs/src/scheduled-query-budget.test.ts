import {
  AUDIT_RETENTION_MS,
  type DeletionWake,
  databaseSize,
  type OutboxMessage,
  STAGING_DORMANT_MS,
  sweepContactOutbox,
  type UnpublishWake,
  type Wake,
} from "@hasaweb/db";
import type { EmailProvider } from "@hasaweb/email";
import {
  credentialBinding,
  encryptActivityToken,
  type RefreshMessage,
} from "@hasaweb/github";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryBucket, sqliteD1 } from "../../../packages/db/test/sqlite-d1";
import { type DeletionEnv, sweepAccountDeletions } from "./account-deletion";
import { sweepGitHubCleanups, sweepGitHubRefreshes } from "./github-routes";
import { type MaintenanceEnv, runMaintenance } from "./maintenance";
import { sweepPublicationTasks } from "./publication-dispatch";
import { sweepUnpublishWithdrawals } from "./publication-unpublish";
import {
  sweepPublicationWithdrawals,
  type WithdrawalEnv,
} from "./publication-withdrawal";
import {
  CRON_EVERY_FIVE_MINUTES,
  CRON_EVERY_MINUTE,
  CRON_EVERY_TWO_MINUTES,
  CRON_HOURLY,
  runScheduled,
} from "./scheduled";

const DAY = 86_400_000;
const FAR = Date.UTC(2100, 0, 1);
const MINUTE_AT = Date.UTC(2027, 0, 4, 12, 1);
const TWO_AT = Date.UTC(2027, 0, 4, 12, 2);
const FIVE_AT = Date.UTC(2027, 0, 4, 12, 5);
const HOUR_AT = Date.UTC(2027, 0, 4, 13, 0);
const EXHAUSTED_CLEANUP = "66666666-6666-4666-8666-666666666666";
// Same activity-app fixture as github-routes.test.ts, 32 bytes of 7.
const ACTIVITY = {
  GITHUB_CLIENT_ID: "sign-in-client",
  GITHUB_CLIENT_SECRET: "sign-in-secret",
  GITHUB_ACTIVITY_CLIENT_ID: "activity-client",
  GITHUB_ACTIVITY_CLIENT_SECRET: "activity-secret",
  GITHUB_ACTIVITY_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
};
const QUERY_LIMIT = 50;
// runGitHubCleanups selects this many pending grants per call.
const GRANT_LIMIT = 10;
const MESSAGE_LIMIT = 3;
const NOTICE_LIMIT = 3;
const PRIVATE_LIMIT = 10;

type Bound = {
  query: string;
  values: unknown[];
  bind: (...values: unknown[]) => Bound;
  all: () => Promise<unknown>;
  first: (column?: string) => Promise<unknown>;
  run: () => Promise<unknown>;
  raw: (options?: unknown) => Promise<unknown>;
};

// A batch counts as one query. Calling bind does not count. Statements that
// run only inside a batch are not counted again. sqliteD1.batch reads query
// and values and does not call run.
function countQueries(base: D1Database) {
  let queries = 0;
  const wrap = (statement: Bound): D1PreparedStatement => {
    const wrapped = {
      query: statement.query,
      values: statement.values,
      bind(...next: unknown[]) {
        return wrap(statement.bind(...next));
      },
      async all() {
        queries += 1;
        return statement.all();
      },
      async first(column?: string) {
        queries += 1;
        return statement.first(column);
      },
      async run() {
        queries += 1;
        return statement.run();
      },
      async raw(options?: unknown) {
        queries += 1;
        return statement.raw(options);
      },
    };
    return wrapped as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: (query: string) => wrap(base.prepare(query) as unknown as Bound),
    async batch(statements: D1PreparedStatement[]) {
      queries += 1;
      return base.batch(statements as never);
    },
    exec: (query: string) => base.exec(query),
  };
  return { db: db as D1Database, count: () => queries };
}

function open() {
  const base = sqliteD1();
  const counted = countQueries(base);
  const run = (query: string, ...values: (string | number | null)[]) =>
    base.sqlite.prepare(query).run(...values);
  const one = (query: string, ...values: (string | number | null)[]) =>
    base.sqlite.prepare(query).get(...values) as
      | Record<string, unknown>
      | undefined;
  const rows = (query: string, ...values: (string | number | null)[]) =>
    base.sqlite.prepare(query).all(...values) as Record<string, unknown>[];
  function owner(id: string) {
    run(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,1,1)",
      id,
      id,
      `${id}@example.test`,
    );
    const portfolioId = `${id}-portfolio`;
    run(
      "INSERT INTO portfolio(id,user_id,status,draft,created_at,updated_at) VALUES(?,?,'draft','{}',1,1)",
      portfolioId,
      id,
    );
    return { userId: id, portfolioId };
  }
  return { db: counted.db, count: counted.count, run, one, rows, owner };
}

type World = ReturnType<typeof open>;

function numbered(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function ids(messages: unknown[], key: string) {
  return messages
    .map((message) =>
      message && typeof message === "object" && key in message
        ? (message as Record<string, unknown>)[key]
        : undefined,
    )
    .filter((value): value is string => typeof value === "string")
    .sort();
}

function harness() {
  const world = open();
  const sites = memoryBucket();
  const assets = memoryBucket();
  const publication: unknown[] = [];
  const refreshes: RefreshMessage[] = [];
  const contact: ({ id: string } | OutboxMessage)[] = [];
  const env = {
    APP_ENV: "test",
    DB: world.db,
    ASSET_ORIGIN: "https://assets.example.test",
    SITES_BUCKET: sites as unknown as R2Bucket,
    PUBLIC_ASSETS_BUCKET: assets as unknown as R2Bucket,
    PRIVATE_SOURCE: {
      fetch: async () =>
        new Response(JSON.stringify({ abandoned: 0, orphans: 0 }), {
          status: 200,
        }),
    } as unknown as Fetcher,
    PLATFORM_ASSETS: {
      fetch: async () => new Response(null, { status: 404 }),
    } as unknown as Fetcher,
    PUBLICATION_QUEUE: {
      async send(body: Wake | UnpublishWake | DeletionWake) {
        publication.push(body);
      },
      async sendBatch(
        messages: Iterable<{ body: Wake | UnpublishWake | DeletionWake }>,
      ) {
        for (const message of messages) publication.push(message.body);
      },
    } as unknown as Queue<Wake | UnpublishWake | DeletionWake>,
    CONTACT_QUEUE: {
      async send(body: { id: string } | OutboxMessage) {
        contact.push(body);
      },
      async sendBatch(
        messages: Iterable<{ body: { id: string } | OutboxMessage }>,
      ) {
        for (const message of messages) contact.push(message.body);
      },
    } as unknown as Queue<{ id: string } | OutboxMessage>,
    GITHUB_QUEUE: {
      async send(body: RefreshMessage) {
        refreshes.push(body);
      },
      async sendBatch(messages: Iterable<{ body: RefreshMessage }>) {
        for (const message of messages) refreshes.push(message.body);
      },
    } as unknown as Queue<RefreshMessage>,
    PUBLISH_WORKFLOW: {} as Workflow<{ id: string }>,
    GITHUB_API_ORIGIN: "https://github.test",
    GITHUB_SERVICE_TOKEN: "platform-token",
    ...ACTIVITY,
  };
  return { world, sites, assets, publication, refreshes, env };
}

type Loaded = ReturnType<typeof harness>;

function insertCandidate(
  world: World,
  row: {
    id: string;
    portfolioId?: string;
    ownerId?: string;
    status: string;
    source?: string | null;
    lastError?: string | null;
    cleanedAt?: number | null;
    deadlineAt?: number;
    nextAttemptAt?: number;
    updatedAt?: number;
  },
) {
  const at = row.updatedAt ?? 1;
  world.run(
    `INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,lease_until,attempts,last_error,cleaned_at,created_at,updated_at) VALUES(?,?,?,1,?,?,'[]',?,?,0,0,?,?,?,?)`,
    row.id,
    row.portfolioId ?? "",
    row.ownerId ?? "",
    row.source ?? null,
    row.status,
    row.nextAttemptAt ?? 0,
    row.deadlineAt ?? 0,
    row.lastError ?? null,
    row.cleanedAt ?? null,
    at,
    at,
  );
}

async function activityKey() {
  const raw = Uint8Array.from(atob(ACTIVITY.GITHUB_ACTIVITY_KEY), (char) =>
    char.charCodeAt(0),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
}

async function seedGrants(world: World) {
  const key = await activityKey();
  for (const userId of numbered("cleanup", GRANT_LIMIT)) {
    const operationId = `op-${userId}`;
    const binding = credentialBinding(
      "cleanup",
      ACTIVITY.GITHUB_ACTIVITY_CLIENT_ID,
      userId,
      operationId,
    );
    const token = await encryptActivityToken(key, "gho_fixture", binding);
    world.run(
      "INSERT INTO github_grant(app_id,github_user_id,portfolio_id,operation_id,generation,state,token_enc,token_binding,retry_at) VALUES(?,?,NULL,?,1,'pending',?,?,0)",
      ACTIVITY.GITHUB_ACTIVITY_CLIENT_ID,
      userId,
      operationId,
      token,
      binding,
    );
  }
}

function seedConnection(world: World, id: string) {
  const { portfolioId } = world.owner(id);
  world.run(
    "INSERT INTO github_connection(portfolio_id,login,github_user_id,token_enc,private_enabled,status,generation) VALUES(?,?,?,?,1,'ok',1)",
    portfolioId,
    "octocat",
    `${id}-gh`,
    "sealed",
  );
  return portfolioId;
}

function seedQueuedMessage(world: World, id: string, ownerId: string) {
  const { portfolioId } = world.owner(ownerId);
  world.run(
    "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES(?,?,1)",
    portfolioId,
    "owner@example.test",
  );
  world.run(
    "INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day) VALUES(?,?,'contact',0,'2027-01-04')",
    id,
    portfolioId,
  );
  world.run(
    "INSERT INTO contact_outbox(id,portfolio_id,payload,status,attempts,next_attempt_at,is_test,accepted_at,deadline_at,budget_window_start) VALUES(?,?,?,'queued',0,0,0,1,?,0)",
    id,
    portfolioId,
    JSON.stringify({
      name: "Ada",
      email: "ada@example.test",
      message: "Hello",
      recipientVerifiedAt: 1,
    }),
    FAR,
  );
}

function seedOutbox(world: World, messages: number, notices: number) {
  const { portfolioId } = world.owner("mail");
  world.run(
    "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES(?,?,1)",
    portfolioId,
    "owner@example.test",
  );
  for (const id of numbered("message", messages)) {
    world.run(
      "INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day) VALUES(?,?,'contact',0,'2027-01-04')",
      id,
      portfolioId,
    );
    world.run(
      "INSERT INTO contact_outbox(id,portfolio_id,payload,status,attempts,next_attempt_at,is_test,accepted_at,deadline_at,budget_window_start) VALUES(?,?,?,'queued',0,0,0,1,?,0)",
      id,
      portfolioId,
      JSON.stringify({
        name: "Ada",
        email: "ada@example.test",
        message: "Hello",
        recipientVerifiedAt: 1,
      }),
      FAR,
    );
  }
  for (const id of numbered("notice", notices))
    world.run(
      "INSERT INTO contact_outbox(id,portfolio_id,payload,status,attempts,next_attempt_at,is_test,accepted_at,deadline_at,budget_window_start,finished_at,notice,notice_next_at) VALUES(?,?,NULL,'failed',5,0,0,1,?,0,1,'pending',0)",
      id,
      portfolioId,
      FAR,
    );
}

function seedDormant(world: World, now: number) {
  const { userId } = world.owner("away");
  world.run(
    "INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,state,draft,progress,expires_at) VALUES('dormant',?,'s',0,'string','{}','{}',?)",
    userId,
    now - STAGING_DORMANT_MS - 1,
  );
  world.run(
    `INSERT INTO owner_save_piece(attempt_id,n,data) VALUES('dormant',0,'"x"')`,
  );
}

function seedResiduals(world: World, now: number) {
  world.run(
    "INSERT INTO github_grant(app_id,github_user_id,portfolio_id,operation_id,generation,state) VALUES('app','gone-idle',NULL,'op-gone-idle',1,'idle')",
  );
  world.run(
    "INSERT INTO github_consent(state_hash,user_id,session_id,portfolio_id,app_id,github_user_id,login,operation_id,generation,verifier,return_to,state,created_at,expires_at) VALUES('resolved',NULL,'s',NULL,'app','gone-idle','login','op-gone-idle',1,'','editor','finished',?,?)",
    now,
    now,
  );
}

function seedAudit(world: World, now: number) {
  const { userId } = world.owner("kept");
  world.run(
    "INSERT INTO operator_email_audit(id,operator_id,account_id,case_reference,accessed_at) VALUES('old','ops',?,'case-1',?)",
    userId,
    now - AUDIT_RETENTION_MS - 1,
  );
}

function seedExhaustedCleanup(world: World, now: number) {
  world.run(
    "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,last_error,created_at,updated_at) VALUES(?,'','',1,NULL,'failed','[]',0,0,?,?,?)",
    EXHAUSTED_CLEANUP,
    "cleanup:exhausted",
    now - 2 * DAY,
    now - 2 * DAY,
  );
}

async function seedMinute(loaded: Loaded) {
  for (const id of numbered("exhausted", 4))
    insertCandidate(loaded.world, {
      id,
      status: "failed",
      source: "{}",
      lastError: "cleanup:stalled",
    });
  for (const id of numbered("failed", 4))
    insertCandidate(loaded.world, {
      id,
      status: "failed",
      lastError: "render_failed",
    });
  for (const id of numbered("tomb", 4)) {
    insertCandidate(loaded.world, {
      id,
      status: "cleaned",
      cleanedAt: MINUTE_AT,
    });
    await loaded.sites.put(`candidate/${id}/left`, "x");
    await loaded.assets.put(`candidate/${id}/left`, "x");
  }
  for (const id of numbered("expire", 8))
    insertCandidate(loaded.world, { id, status: "preparing" });
  const publisher = loaded.world.owner("publisher");
  for (const id of numbered("due", 8))
    insertCandidate(loaded.world, {
      id,
      portfolioId: publisher.portfolioId,
      ownerId: publisher.userId,
      status: "preparing",
      deadlineAt: FAR,
    });
  for (const [index, id] of numbered("withdraw", 4).entries()) {
    const owner = loaded.world.owner(`withdraw-owner-${index}`);
    loaded.world.run(
      "INSERT INTO publication_operation(id,portfolio_id,owner_id,source_revision,expected_status,created_at) VALUES(?,?,?,1,'published',1)",
      id,
      owner.portfolioId,
      owner.userId,
    );
    loaded.world.run(
      "INSERT INTO publication_commit(candidate_id,portfolio_id,payload_hash,version,address,committed_at,applied) VALUES(?,?,'hash',1,'ada',1,1)",
      id,
      owner.portfolioId,
    );
  }
  const unpublish = loaded.world.owner("unpublish-owner");
  for (const id of numbered("unpublish", 4))
    loaded.world.run(
      "INSERT INTO publication_withdrawal(id,portfolio_id,address,version,created_at) VALUES(?,?,'ada',1,1)",
      id,
      unpublish.portfolioId,
    );
  for (const [index, id] of numbered("deletion", 4).entries())
    loaded.world.run(
      "INSERT INTO account_deletion(id,user_id,created_at) VALUES(?,?,1)",
      id,
      `deletion-user-${index}`,
    );
  await seedGrants(loaded.world);
  seedQueuedMessage(loaded.world, "minute-message", "minute-contact");
  seedConnection(loaded.world, "minute-refresh");
}

function seedMaintenance(loaded: Loaded, now: number) {
  seedDormant(loaded.world, now);
  seedResiduals(loaded.world, now);
  seedAudit(loaded.world, now);
  seedExhaustedCleanup(loaded.world, now);
}

const accepted: EmailProvider = {
  async send() {
    return { status: "accepted", id: "accepted" };
  },
};

async function budgetMessage(cron: string, count: number) {
  if (count <= QUERY_LIMIT) return `${cron} used ${count} D1 queries`;
  try {
    const sweeps = await measureSweeps(cron);
    return `${cron} used ${count} D1 queries. Separate sweep counts, measured on their own databases: ${sweeps}.`;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "measurement failed";
    return `${cron} used ${count} D1 queries. Separate sweep measurement failed: ${reason}.`;
  }
}

async function measureSweeps(cron: string) {
  if (cron === CRON_EVERY_MINUTE) {
    const calls = [
      [
        "sweepPublicationTasks",
        (env: Loaded["env"]) => sweepPublicationTasks(env),
      ],
      [
        "sweepPublicationWithdrawals",
        (env: Loaded["env"]) =>
          sweepPublicationWithdrawals(env as WithdrawalEnv),
      ],
      [
        "sweepUnpublishWithdrawals",
        (env: Loaded["env"]) => sweepUnpublishWithdrawals(env as WithdrawalEnv),
      ],
      [
        "sweepAccountDeletions",
        (env: Loaded["env"]) => sweepAccountDeletions(env as DeletionEnv),
      ],
      ["sweepGitHubCleanups", (env: Loaded["env"]) => sweepGitHubCleanups(env)],
    ] as const;
    const parts: string[] = [];
    for (const [name, call] of calls) {
      const loaded = harness();
      await seedMinute(loaded);
      await call(loaded.env);
      parts.push(`${name} ${loaded.world.count()}`);
    }
    return parts.join(", ");
  }
  if (cron === CRON_EVERY_TWO_MINUTES) {
    const count = async (messages: number, notices: number) => {
      const loaded = harness();
      seedOutbox(loaded.world, messages, notices);
      await sweepContactOutbox(loaded.world.db, accepted, Date.now());
      return loaded.world.count();
    };
    const both = await count(MESSAGE_LIMIT, NOTICE_LIMIT);
    const messages = await count(MESSAGE_LIMIT, 0);
    const notices = await count(0, NOTICE_LIMIT);
    return `sweepContactOutbox ${both}, ${MESSAGE_LIMIT} messages measured alone ${messages}, ${NOTICE_LIMIT} notices measured alone ${notices}`;
  }
  if (cron === CRON_EVERY_FIVE_MINUTES) {
    const loaded = harness();
    seedMaintenance(loaded, FIVE_AT);
    await runMaintenance(loaded.env as MaintenanceEnv, FIVE_AT);
    return `runMaintenance ${loaded.world.count()}`;
  }
  const loaded = harness();
  for (const id of numbered("private", PRIVATE_LIMIT))
    seedConnection(loaded.world, id);
  await sweepGitHubRefreshes(loaded.env);
  const refresh = loaded.world.count();
  await databaseSize(loaded.world.db);
  return `sweepGitHubRefreshes ${refresh}, databaseSize ${loaded.world.count() - refresh}`;
}

let logs: string[] = [];

beforeEach(() => {
  logs = [];
  const record = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "DELETE" && String(input).includes("/applications/"))
      return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response(null, { status: 500 }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function schedule(loaded: Loaded, cron: string, scheduledTime: number) {
  await runScheduled({ cron, scheduledTime }, loaded.env);
  return budgetMessage(cron, loaded.world.count());
}

describe("scheduled D1 query budget", () => {
  it("keeps a loaded minute trigger within 50 queries", async () => {
    const loaded = harness();
    await seedMinute(loaded);
    const message = await schedule(loaded, CRON_EVERY_MINUTE, MINUTE_AT);
    expect(loaded.world.count(), message).toBeLessThanOrEqual(QUERY_LIMIT);
    expect(
      loaded.world.one(
        "SELECT status FROM contact_outbox WHERE id='minute-message'",
      ),
    ).toEqual({ status: "queued" });
    expect(loaded.refreshes).toEqual([]);
    expect(
      loaded.world
        .rows(
          "SELECT id FROM publication_candidate WHERE last_error='cleanup:exhausted' AND source IS NULL ORDER BY id",
        )
        .map((row) => row.id),
    ).toEqual(numbered("exhausted", 4));
    expect(
      loaded.world
        .rows(
          "SELECT id FROM publication_candidate WHERE id LIKE 'failed-%' AND status='cleaning' ORDER BY id",
        )
        .map((row) => row.id),
    ).toEqual(numbered("failed", 4));
    expect(
      loaded.world
        .rows(
          "SELECT id FROM publication_candidate WHERE id LIKE 'tomb-%' AND status='cleaning' ORDER BY id",
        )
        .map((row) => row.id),
    ).toEqual(numbered("tomb", 4));
    expect(
      loaded.world
        .rows(
          "SELECT id FROM publication_candidate WHERE id LIKE 'expire-%' AND status='failed' AND last_error='expired_or_deleted' ORDER BY id",
        )
        .map((row) => row.id),
    ).toEqual(numbered("expire", 8));
    expect(ids(loaded.publication, "candidateId")).toEqual(
      [...numbered("due", 8), ...numbered("withdraw", 4)].sort(),
    );
    expect(ids(loaded.publication, "withdrawalId")).toEqual(
      numbered("unpublish", 4),
    );
    expect(ids(loaded.publication, "deletionId")).toEqual(
      numbered("deletion", 4),
    );
    expect(
      loaded.world
        .rows("SELECT state FROM github_grant")
        .map((row) => row.state),
    ).toEqual(Array.from({ length: GRANT_LIMIT }, () => "idle"));
  });

  it("keeps a loaded two-minute trigger within 50 queries", async () => {
    const loaded = harness();
    seedOutbox(loaded.world, MESSAGE_LIMIT, NOTICE_LIMIT);
    const detail = await schedule(loaded, CRON_EVERY_TWO_MINUTES, TWO_AT);
    expect(
      loaded.world
        .rows(
          "SELECT id, status FROM contact_outbox WHERE id LIKE 'message-%' ORDER BY id",
        )
        .map((row) => row.status),
    ).toEqual(["sent", "sent", "sent"]);
    expect(
      loaded.world
        .rows(
          "SELECT notice FROM contact_outbox WHERE id LIKE 'notice-%' ORDER BY id",
        )
        .map((row) => row.notice),
    ).toEqual(Array.from({ length: NOTICE_LIMIT }, () => "sent"));
    expect(loaded.world.count(), detail).toBeLessThanOrEqual(QUERY_LIMIT);
  });

  it("keeps a loaded five-minute trigger within 50 queries", async () => {
    const loaded = harness();
    seedMaintenance(loaded, FIVE_AT);
    seedConnection(loaded.world, "five-refresh");
    const message = await schedule(loaded, CRON_EVERY_FIVE_MINUTES, FIVE_AT);
    expect(loaded.world.count(), message).toBeLessThanOrEqual(QUERY_LIMIT);
    expect(logs.some((line) => line.includes("d1_size"))).toBe(false);
    expect(loaded.refreshes).toEqual([]);
    expect(
      loaded.world.one("SELECT id FROM owner_save_attempt WHERE id='dormant'"),
    ).toBeUndefined();
    expect(
      loaded.world.one(
        "SELECT github_user_id FROM github_grant WHERE github_user_id='gone-idle'",
      ),
    ).toBeUndefined();
    expect(
      loaded.world.one(
        "SELECT state_hash FROM github_consent WHERE state_hash='resolved'",
      ),
    ).toBeUndefined();
    expect(
      loaded.world.one("SELECT id FROM operator_email_audit WHERE id='old'"),
    ).toBeUndefined();
    expect(
      loaded.world.one(
        "SELECT status FROM publication_candidate WHERE id=?",
        EXHAUSTED_CLEANUP,
      ),
    ).toEqual({ status: "cleaning" });
    expect(loaded.publication).toEqual([{ candidateId: EXHAUSTED_CLEANUP }]);
  });

  it("keeps a loaded hourly trigger within 50 queries", async () => {
    const loaded = harness();
    for (const id of numbered("private", PRIVATE_LIMIT))
      seedConnection(loaded.world, id);
    // Collection would remove this. The hourly trigger must leave it.
    seedDormant(loaded.world, HOUR_AT);
    const detail = await schedule(loaded, CRON_HOURLY, HOUR_AT);
    expect(loaded.world.count(), detail).toBeLessThanOrEqual(QUERY_LIMIT);
    expect(
      loaded.refreshes.map((refresh) => refresh.portfolioId).sort(),
    ).toEqual(
      numbered("private", PRIVATE_LIMIT)
        .map((id) => `${id}-portfolio`)
        .sort(),
    );
    expect(
      loaded.refreshes.every((refresh) => refresh.kind === "github-refresh"),
    ).toBe(true);
    expect(
      logs.some((line) => line.includes('{"event":"d1_size","bytes":null}')),
    ).toBe(true);
    expect(
      loaded.world.one("SELECT id FROM owner_save_attempt WHERE id='dormant'"),
    ).toEqual({ id: "dormant" });
  });
});
