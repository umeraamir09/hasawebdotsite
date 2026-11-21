import { requestAccountDeletion } from "@hasaweb/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryBucket, sqliteD1 } from "../../../packages/db/test/sqlite-d1";
import { purgeDeletedDrafts } from "../../web/lib/assets/deleted-drafts";
import {
  type DeletionEnv,
  runAccountDeletion,
  sweepAccountDeletions,
  UPLOAD_QUIET_MS,
} from "./account-deletion";
import { runPublicationBatch } from "./publication-dispatch";

const NOW = 1_800_000_000_000;
type Message = { deletionId: string } | { candidateId: string };

function world() {
  const db = sqliteD1();
  const buckets = {
    sites: memoryBucket(),
    assets: memoryBucket(),
    draft: memoryBucket(),
  };
  const queue: Message[] = [];
  const failures = { draft: 0, publicDelete: 0 };
  const run = (query: string, ...values: (string | number | null)[]) =>
    db.sqlite.prepare(query).run(...values);
  const env: DeletionEnv & {
    PLATFORM_ASSETS: Fetcher;
  } = {
    APP_ENV: "test",
    ASSET_ORIGIN: "https://assets.example.test",
    DB: db,
    SITES_BUCKET: buckets.sites,
    PUBLIC_ASSETS_BUCKET: new Proxy(buckets.assets, {
      get(target, key) {
        if (key === "delete" && failures.publicDelete > 0)
          return async () => {
            failures.publicDelete--;
            throw new Error("R2 unavailable");
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    PRIVATE_SOURCE: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (failures.draft > 0) {
          failures.draft--;
          return new Response(null, { status: 503 });
        }
        return purgeDeletedDrafts(new Request(input, init), {
          DB: db,
          DRAFT_BUCKET: buckets.draft,
        });
      },
    } as Fetcher,
    PLATFORM_ASSETS: {} as Fetcher,
    PUBLICATION_QUEUE: {
      send: async (body: Message) => void queue.push(body),
    } as never,
  };

  const candidates = new Map<string, string[]>();
  function owner(id: string, published: boolean) {
    const portfolio = `${id}-portfolio`;
    run(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      id,
      id,
      `${id}@example.test`,
      NOW,
      NOW,
    );
    run(
      "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      `${id}-session`,
      `${id}-token`,
      id,
      NOW + 86_400_000,
      NOW,
      NOW,
    );
    run(
      "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,'github',?,?,?)",
      `${id}-account`,
      `${id}-gh`,
      id,
      NOW,
      NOW,
    );
    run(
      "INSERT INTO portfolio(id,user_id,subdomain,status,published_version,draft,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      portfolio,
      id,
      published ? `${id}-site` : null,
      published ? "published" : "draft",
      published ? 1 : null,
      "{}",
      NOW,
      NOW,
    );
    run(
      "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at,claimed_at) VALUES(?,?,?,?,?)",
      `${id}-site`,
      portfolio,
      published ? "claimed" : "held",
      published ? null : NOW,
      published ? NOW : null,
    );
    // A private upload with its row.
    run(
      "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES(?,?,'avatar','image/png',3,'ready',?,?)",
      `${id}-avatar`,
      portfolio,
      NOW,
      NOW,
    );
    void buckets.draft.put(`draft/${portfolio}/${id}-avatar`, "png");
    // A live retained candidate and an abandoned in-flight one.
    const live = crypto.randomUUID(),
      stale = crypto.randomUUID();
    candidates.set(id, [live, stale]);
    for (const [candidate, status] of [
      [live, "ready"],
      [stale, "preparing"],
    ] as const) {
      run(
        "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,renderer_version,next_attempt_at,deadline_at,created_at,updated_at) VALUES(?,?,?,1,'{}',?,'[]','publication-v8',0,?,?,?)",
        candidate,
        portfolio,
        id,
        status,
        NOW + 3_600_000,
        NOW,
        NOW,
      );
      run(
        "INSERT INTO publication_candidate_index(candidate_id,value) VALUES(?,?)",
        candidate,
        JSON.stringify({
          receipts: [
            {
              bucket: "assets",
              key: `candidate/${candidate}/assets/avatar`,
              path: "/assets/avatar",
            },
            {
              bucket: "sites",
              key: `candidate/${candidate}/index.html`,
              path: "/",
            },
          ],
        }),
      );
      void buckets.assets.put(`candidate/${candidate}/assets/avatar`, "png");
      void buckets.sites.put(`candidate/${candidate}/index.html`, "<p>");
      // Output written without a receipt is found by the prefix cleanup.
      void buckets.sites.put(`candidate/${candidate}/snapshot.json`, "{}");
    }
    if (published)
      run(
        "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES(?,?,1,'live','publication-v8',?,?,?)",
        `${id}-v1`,
        portfolio,
        live,
        NOW,
        NOW,
      );
    // Private GitHub access granted after the request's withdrawal.
    run(
      "INSERT INTO github_connection(portfolio_id,login,github_user_id,token_enc,private_enabled,status,generation,app_id,grant_operation,token_binding) VALUES(?,?,?,?,1,'ok',1,'app',?,?)",
      portfolio,
      id,
      `${id}-ghid`,
      "sealed-token",
      `${id}-op`,
      "binding",
    );
    run(
      "INSERT INTO github_grant(app_id,github_user_id,portfolio_id,operation_id,generation,state) VALUES('app',?,?,?,1,'active')",
      `${id}-ghid`,
      portfolio,
      `${id}-op`,
    );
    return { user: { id }, session: { id: `${id}-session` } };
  }

  // Delivers queued wakes as the consumer does, moving the clock past waits.
  async function drain(limit = 200) {
    const errors: unknown[] = [];
    for (let n = 0; n < limit; n++) {
      const message = queue.shift();
      if (!message) {
        // An empty queue means the cron sweep would re-drive what is due.
        vi.setSystemTime(Date.now() + 60_000);
        await sweepAccountDeletions(env);
        if (!queue.length) return errors;
        continue;
      }
      try {
        if ("deletionId" in message)
          await runAccountDeletion(env, message.deletionId);
        else await runPublicationBatch(env as never, message.candidateId);
      } catch (error) {
        errors.push(error);
        vi.setSystemTime(Date.now() + 301_000);
      }
    }
    throw new Error("Cleanup did not settle");
  }
  const one = (query: string, ...values: string[]) =>
    db.sqlite.prepare(query).get(...values) as
      | Record<string, unknown>
      | undefined;
  const keysOf = (bucket: { objects: Map<string, unknown> }, owner: string) =>
    [...bucket.objects.keys()].filter((key) =>
      [`${owner}-portfolio`, ...(candidates.get(owner) ?? [])].some((part) =>
        key.includes(part),
      ),
    );
  const ids = (owner: string) =>
    (candidates.get(owner) ?? []).map((id) => `'${id}'`).join(",");
  return {
    db,
    env,
    buckets,
    queue,
    failures,
    owner,
    drain,
    one,
    run,
    keysOf,
    ids,
  };
}

describe("account deletion cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("removes output, uploads and rows, keeping only the ownerless claim", async () => {
    const w = world();
    const alice = w.owner("alice", true);
    w.owner("bob", true);
    const started = await requestAccountDeletion(w.db, alice);
    expect(started).not.toBeNull();
    await w.env.PUBLICATION_QUEUE.send({
      deletionId: started?.deletionId ?? "",
    });
    vi.setSystemTime(NOW + UPLOAD_QUIET_MS + 1);
    expect(await w.drain()).toEqual([]);

    for (const bucket of [w.buckets.assets, w.buckets.sites, w.buckets.draft])
      expect(w.keysOf(bucket, "alice")).toEqual([]);
    for (const table of [
      "user WHERE id='alice'",
      "session WHERE user_id='alice'",
      "account WHERE user_id='alice'",
      "portfolio WHERE user_id='alice'",
      "asset WHERE portfolio_id='alice-portfolio'",
      "publish_version WHERE portfolio_id='alice-portfolio'",
      "publication_candidate WHERE portfolio_id='alice-portfolio' OR owner_id='alice'",
      "github_connection WHERE portfolio_id='alice-portfolio'",
      "account_deletion",
    ])
      expect(w.one(`SELECT count(*) AS n FROM ${table}`), table).toEqual({
        n: 0,
      });
    // Candidates remain only as anonymous tombstones that recheck late writes.
    expect(
      w.one(
        `SELECT count(*) AS n FROM publication_candidate WHERE id IN (${w.ids("alice")}) AND status='cleaned' AND portfolio_id='' AND owner_id=''`,
      ),
    ).toEqual({ n: 2 });
    expect(
      w.one(
        `SELECT count(*) AS n FROM publication_candidate_pending WHERE candidate_id IN (${w.ids("alice")})`,
      ),
    ).toEqual({ n: 0 });
    // The grant activated after the withdrawal is queued for revocation.
    expect(
      w.one(
        "SELECT state,token_enc,portfolio_id FROM github_grant WHERE github_user_id='alice-ghid'",
      ),
    ).toEqual({
      state: "pending",
      token_enc: "sealed-token",
      portfolio_id: null,
    });
    expect(
      w.one(
        "SELECT portfolio_id,state FROM subdomain_claim WHERE name='alice-site'",
      ),
    ).toEqual({ portfolio_id: null, state: "claimed" });

    // Another account keeps everything.
    expect(w.keysOf(w.buckets.assets, "bob").length).toBe(2);
    expect(w.keysOf(w.buckets.sites, "bob").length).toBe(4);
    expect(w.keysOf(w.buckets.draft, "bob").length).toBe(1);
    expect(
      w.one("SELECT status FROM portfolio WHERE id='bob-portfolio'"),
    ).toEqual({ status: "published" });
    expect(
      w.one("SELECT state FROM github_grant WHERE github_user_id='bob-ghid'"),
    ).toEqual({ state: "active" });
  });

  it("releases a never-published reservation and resumes after failures", async () => {
    const w = world();
    const alice = w.owner("alice", false);
    w.owner("bob", false);
    const started = await requestAccountDeletion(w.db, alice);
    const deletionId = started?.deletionId ?? "";
    expect(w.one("SELECT * FROM subdomain_claim WHERE name='alice-site'")).toBe(
      undefined,
    );
    w.failures.publicDelete = 2;
    w.failures.draft = 3;
    await w.env.PUBLICATION_QUEUE.send({ deletionId });
    // An upload still in flight holds the private stage back.
    w.run(
      "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES('late','alice-portfolio','banner','image/png',0,'pending',?,?)",
      NOW,
      NOW,
    );
    const errors = await w.drain();
    expect(errors.length).toBe(5);
    expect(w.one("SELECT count(*) AS n FROM account_deletion")).toEqual({
      n: 0,
    });
    expect(w.one("SELECT count(*) AS n FROM user WHERE id='alice'")).toEqual({
      n: 0,
    });
    for (const bucket of [w.buckets.assets, w.buckets.sites, w.buckets.draft])
      expect(w.keysOf(bucket, "alice")).toEqual([]);
    // The released name can now be reserved by someone else.
    w.run("DELETE FROM subdomain_claim WHERE name='bob-site'");
    w.run(
      "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES('alice-site','bob-portfolio','held',?)",
      NOW,
    );
  });

  it("records a failed step for retry with backoff", async () => {
    const w = world();
    const alice = w.owner("alice", true);
    const started = await requestAccountDeletion(w.db, alice);
    const deletionId = started?.deletionId ?? "";
    w.failures.publicDelete = 1;
    await expect(runAccountDeletion(w.env, deletionId)).rejects.toThrow(
      "R2 unavailable",
    );
    expect(
      w.one(
        "SELECT stage,attempts,next_attempt_at FROM account_deletion WHERE id=?",
        deletionId,
      ),
    ).toEqual({ stage: "public", attempts: 1, next_attempt_at: NOW + 1000 });
    // Not due yet: a redelivered wake does nothing.
    expect(await runAccountDeletion(w.env, deletionId)).toBe(false);
    vi.setSystemTime(NOW + 1000);
    expect(await runAccountDeletion(w.env, deletionId)).toBe("public");
    expect(
      w.one("SELECT attempts FROM account_deletion WHERE id=?", deletionId),
    ).toEqual({ attempts: 0 });
  });
});
