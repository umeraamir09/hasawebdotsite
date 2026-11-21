import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../test/sqlite-d1";
import {
  AUDIT_RETENTION_MS,
  collectAbandonedUploads,
  collectDormantStaging,
  collectGitHubResiduals,
  collectOperatorAudits,
  D1_SIZE_ALERT_BYTES,
  databaseSize,
  orphanDraftKeys,
  retryExhaustedCleanups,
  STAGING_DORMANT_MS,
  UPLOAD_UNREFERENCED_MS,
} from "./maintenance";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const OLD = NOW - UPLOAD_UNREFERENCED_MS - DAY;

function world() {
  const db = sqliteD1();
  const run = (query: string, ...values: (string | number | null)[]) =>
    db.sqlite.prepare(query).run(...values);
  const rows = (query: string, ...values: (string | number | null)[]) =>
    db.sqlite.prepare(query).all(...values) as Record<string, unknown>[];
  function owner(
    id: string,
    {
      entered = true,
      session = true,
    }: { entered?: boolean; session?: boolean } = {},
  ) {
    run(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      id,
      id,
      `${id}@example.test`,
      NOW - 200 * DAY,
      NOW - 200 * DAY,
    );
    if (session)
      run(
        "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        `${id}-session`,
        `${id}-token`,
        id,
        NOW + DAY,
        NOW,
        NOW,
      );
    run(
      "INSERT INTO portfolio(id,user_id,status,draft,first_editor_entered_at,created_at,updated_at) VALUES(?,?,'draft','{}',?,?,?)",
      `${id}-portfolio`,
      id,
      entered ? NOW - 100 * DAY : null,
      NOW - 200 * DAY,
      NOW - 200 * DAY,
    );
    return `${id}-portfolio`;
  }
  function asset(
    portfolio: string,
    id: string,
    status: "ready" | "pending" | "failed" = "ready",
    at = OLD,
  ) {
    run(
      "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES(?,?,'avatar','image/webp',10,?,?,?)",
      id,
      portfolio,
      status,
      at,
      at,
    );
    return id;
  }
  const assets = () =>
    rows("SELECT id FROM asset ORDER BY id").map((row) => row.id);
  return { db, run, rows, owner, asset, assets };
}

describe("upload collection", () => {
  it("collects only abandoned, unreachable uploads", async () => {
    const w = world();
    const p = w.owner("ada");
    // Collected: abandoned failed and stalled pending uploads, and a ready
    // upload nothing references for 30 days after setup.
    w.asset(p, "a-failed", "failed", NOW - 2 * DAY);
    w.asset(p, "a-pending", "pending", NOW - 2 * DAY);
    w.asset(p, "a-unreferenced");
    // Kept: recent activity.
    w.asset(p, "k-recent-ready", "ready", NOW - DAY);
    w.asset(p, "k-recent-pending", "pending", NOW - 60_000);
    // Kept: the canonical draft names it.
    w.asset(p, "k-draft");
    w.run(
      "UPDATE portfolio SET draft=json_object('profile',json_object('avatar',json_object('assetId','k-draft'))) WHERE id=?",
      p,
    );

    expect((await collectAbandonedUploads(w.db, NOW)).sort()).toEqual([
      `draft/${p}/a-failed`,
      `draft/${p}/a-pending`,
      `draft/${p}/a-unreferenced`,
    ]);
    expect(w.assets()).toEqual([
      "k-draft",
      "k-recent-pending",
      "k-recent-ready",
    ]);
    // Repeating finds nothing more.
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([]);
  });

  it("never collects an asset unfinished setup may still use", async () => {
    const w = world();
    const p = w.owner("setup", { entered: false });
    w.asset(p, "k-setup-ready");
    w.asset(p, "a-setup-failed", "failed", NOW - 2 * DAY);
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([
      `draft/${p}/a-setup-failed`,
    ]);
    expect(w.assets()).toEqual(["k-setup-ready"]);
  });

  it("keeps every asset while a staged attempt is open or holds pieces", async () => {
    const w = world();
    const p = w.owner("staged");
    w.asset(p, "k-any");
    for (const [state, draft] of [
      ["open", "{}"],
      ["string", "{}"],
    ] as const) {
      w.run(
        "INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,state,draft,progress,expires_at) VALUES('attempt','staged','old-session',0,?,?,'{}',?)",
        state,
        draft,
        NOW - 30 * DAY,
      );
      expect(await collectAbandonedUploads(w.db, NOW)).toEqual([]);
      w.run("DELETE FROM owner_save_attempt");
    }
    // A committed receipt with leftover string pieces still protects.
    w.run(
      "INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,state,progress,expires_at) VALUES('attempt','staged','old-session',0,'committed','{}',?)",
      NOW - 30 * DAY,
    );
    w.run(
      "INSERT INTO owner_save_piece(attempt_id,n,data) VALUES('attempt',0,'\"k-an\"')",
    );
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([]);
    w.run("DELETE FROM owner_save_piece");
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([
      `draft/${p}/k-any`,
    ]);
  });

  it("keeps assets a sealed candidate or live version refers to", async () => {
    const w = world();
    const p = w.owner("pub");
    for (const id of [
      "k-unindexed",
      "k-indexed",
      "k-transfer",
      "k-live",
      "a-free",
    ])
      w.asset(p, id);
    const candidate = (id: string, status: string, source: string | null) =>
      w.run(
        "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) VALUES(?,?,'pub',1,?,?,'[]',0,?,?,?)",
        id,
        p,
        source,
        status,
        NOW + DAY,
        NOW,
        NOW,
      );
    // Sealed but not indexed and no transfer rows yet: the whole portfolio
    // is retained, even an asset the source does not name.
    candidate("11111111-1111-4111-8111-111111111111", "preparing", "{}");
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([]);
    // Indexed: only the indexed references (and its source) are retained.
    w.run(
      "INSERT INTO publication_candidate_index(candidate_id,value) VALUES(?,?)",
      "11111111-1111-4111-8111-111111111111",
      JSON.stringify({ assets: [{ id: "k-indexed", purpose: "avatar" }] }),
    );
    w.run(
      "UPDATE publication_candidate SET source=? WHERE id=?",
      JSON.stringify({ profile: { banner: { assetId: "k-unindexed" } } }),
      "11111111-1111-4111-8111-111111111111",
    );
    w.run(
      "INSERT INTO publication_transfer(candidate_id,asset_id,purpose,bytes,content_type) VALUES(?,?,'avatar',10,'image/webp')",
      "11111111-1111-4111-8111-111111111111",
      "k-transfer",
    );
    // A live version whose source was released keeps its indexed assets.
    candidate("22222222-2222-4222-8222-222222222222", "ready", "{}");
    w.run(
      "INSERT INTO publication_candidate_index(candidate_id,value) VALUES(?,?)",
      "22222222-2222-4222-8222-222222222222",
      JSON.stringify({ assets: [{ id: "k-live", purpose: "avatar" }] }),
    );
    w.run(
      "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES('v1',?,1,'live','publication-v8',?,?,?)",
      p,
      "22222222-2222-4222-8222-222222222222",
      NOW,
      NOW,
    );
    expect(
      w.rows(
        "SELECT source FROM publication_candidate WHERE id='22222222-2222-4222-8222-222222222222'",
      ),
    ).toEqual([{ source: null }]);
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([
      `draft/${p}/a-free`,
    ]);
    expect(w.assets()).toEqual([
      "k-indexed",
      "k-live",
      "k-transfer",
      "k-unindexed",
    ]);
  });

  it("leaves an account being deleted to its own cleanup", async () => {
    const w = world();
    const p = w.owner("leaving");
    w.asset(p, "k-deleting");
    w.run("UPDATE user SET deleting_at=? WHERE id='leaving'", NOW);
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([]);
    w.run("UPDATE user SET deleting_at=NULL WHERE id='leaving'");
    w.run("UPDATE portfolio SET status='deleting' WHERE id=?", p);
    expect(await collectAbandonedUploads(w.db, NOW)).toEqual([]);
  });

  it("finds draft objects that no asset row or deletion accounts for", async () => {
    const w = world();
    const p = w.owner("objects");
    w.asset(p, "known");
    w.run(
      "INSERT INTO account_deletion(id,user_id,portfolio_id,stage,cursor,attempts,next_attempt_at,created_at) VALUES('d1','gone','gone-portfolio','draft','',0,0,?)",
      NOW,
    );
    expect(
      await orphanDraftKeys(w.db, [
        `draft/${p}/known`,
        `draft/${p}/missing`,
        "draft/gone-portfolio/any",
        "draft/deleted-portfolio/left",
        "runtime/other.txt",
      ]),
    ).toEqual([`draft/${p}/missing`, "draft/deleted-portfolio/left"]);
  });
});

describe("dormant staging", () => {
  it("collects only dormant attempts and never touches holds or receipts", async () => {
    const w = world();
    w.owner("active");
    w.owner("away", { session: false });
    const p = "away-portfolio";
    w.run(
      "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES('away-name',?,'held',?)",
      p,
      NOW - 100 * DAY,
    );
    w.run(
      "INSERT INTO address_confirmation(id,portfolio_id,payload_hash,name,state,revision,created_at,applied) VALUES('confirm',?,'hash','away-name','held',1,?,1)",
      p,
      NOW - 100 * DAY,
    );
    const attempt = (
      id: string,
      user: string,
      state: string,
      expires: number,
    ) =>
      w.run(
        "INSERT INTO owner_save_attempt(id,user_id,session_id,base_revision,state,draft,progress,expires_at) VALUES(?,?,'s',0,?,?,'{}',?)",
        id,
        user,
        state,
        state === "committed" ? null : "{}",
        expires,
      );
    const dormant = NOW - STAGING_DORMANT_MS - 1;
    // The active owner's expired receipt may still be reconciling: kept.
    attempt("receipt", "active", "committed", dormant);
    // The away owner's attempt is dormant, with pieces to remove first.
    attempt("dormant", "away", "string", dormant);
    for (let n = 0; n < 70; n++)
      w.run(
        "INSERT INTO owner_save_piece(attempt_id,n,data) VALUES('dormant',?,'\"x\"')",
        n,
      );
    expect(await collectDormantStaging(w.db, NOW)).toEqual({
      pieces: 64,
      attempts: 0,
    });
    expect(await collectDormantStaging(w.db, NOW)).toEqual({
      pieces: 6,
      attempts: 1,
    });
    // Not yet dormant: expired less than a week ago.
    attempt("recent", "away", "open", NOW - DAY);
    expect(await collectDormantStaging(w.db, NOW)).toEqual({
      pieces: 0,
      attempts: 0,
    });
    expect(
      w.rows("SELECT id FROM owner_save_attempt ORDER BY id").map((r) => r.id),
    ).toEqual(["receipt", "recent"]);
    expect(
      w.rows("SELECT name,state FROM subdomain_claim WHERE portfolio_id=?", p),
    ).toEqual([{ name: "away-name", state: "held" }]);
    expect(w.rows("SELECT id FROM address_confirmation")).toEqual([
      { id: "confirm" },
    ]);
  });
});

describe("GitHub residuals", () => {
  it("keeps cleanup state until revocation resolves", async () => {
    const w = world();
    const p = w.owner("live");
    const grant = (user: string, portfolio: string | null, state: string) =>
      w.run(
        "INSERT INTO github_grant(app_id,github_user_id,portfolio_id,operation_id,generation,state,token_enc,token_binding) VALUES('app',?,?,?,1,?,?,?)",
        user,
        portfolio,
        `op-${user}`,
        state,
        ["pending", "inflight", "uncertain"].includes(state) ? "enc" : null,
        ["pending", "inflight", "uncertain"].includes(state) ? "bind" : null,
      );
    for (const state of [
      "pending",
      "inflight",
      "uncertain",
      "consent",
      "active",
    ])
      grant(`gone-${state}`, null, state);
    grant("gone-idle", null, "idle");
    grant("live-idle", p, "idle");
    const consent = (hash: string, user: string, state: string) =>
      w.run(
        "INSERT INTO github_consent(state_hash,user_id,session_id,portfolio_id,app_id,github_user_id,login,operation_id,generation,verifier,return_to,state,created_at,expires_at) VALUES(?,NULL,'s',NULL,'app',?,'login',?,1,'','editor',?,?,?)",
        hash,
        user,
        `op-${user}`,
        state,
        NOW - DAY,
        NOW - DAY,
      );
    consent("resolved", "gone-idle", "finished");
    consent("waiting", "gone-pending", "void");
    expect(await collectGitHubResiduals(w.db)).toEqual({
      grants: 1,
      consents: 1,
    });
    expect(
      w
        .rows("SELECT github_user_id FROM github_grant ORDER BY github_user_id")
        .map((row) => row.github_user_id),
    ).toEqual([
      "gone-active",
      "gone-consent",
      "gone-inflight",
      "gone-pending",
      "gone-uncertain",
      "live-idle",
    ]);
    expect(w.rows("SELECT state_hash FROM github_consent")).toEqual([
      { state_hash: "waiting" },
    ]);
  });
});

describe("operator audits", () => {
  it("expires after 90 days and goes with the account", async () => {
    const w = world();
    w.owner("audited");
    w.owner("kept");
    const audit = (id: string, account: string, at: number) =>
      w.run(
        "INSERT INTO operator_email_audit(id,operator_id,account_id,case_reference,accessed_at) VALUES(?,'ops',?,'case-1',?)",
        id,
        account,
        at,
      );
    audit("old", "kept", NOW - AUDIT_RETENTION_MS - 1);
    audit("recent", "kept", NOW - DAY);
    audit("deleted", "audited", NOW - DAY);
    expect(await collectOperatorAudits(w.db, NOW)).toBe(1);
    w.run("DELETE FROM portfolio WHERE user_id='audited'");
    w.run("DELETE FROM user WHERE id='audited'");
    expect(w.rows("SELECT id FROM operator_email_audit")).toEqual([
      { id: "recent" },
    ]);
  });
});

describe("candidate tombstones", () => {
  it("restarts cleanups that ran out of attempts a day later", async () => {
    const w = world();
    const insert = (id: string, updated: number, lastError: string) =>
      w.run(
        "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,last_error,created_at,updated_at) VALUES(?,'','',1,NULL,'failed','[]',0,0,?,?,?)",
        id,
        lastError,
        updated,
        updated,
      );
    insert(
      "33333333-3333-4333-8333-333333333333",
      NOW - 2 * DAY,
      "cleanup:exhausted",
    );
    insert(
      "44444444-4444-4444-8444-444444444444",
      NOW - 60_000,
      "cleanup:exhausted",
    );
    insert(
      "55555555-5555-4555-8555-555555555555",
      NOW - 2 * DAY,
      "render_failed",
    );
    expect(await retryExhaustedCleanups(w.db, NOW)).toEqual([
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(
      w.rows("SELECT id,status FROM publication_candidate ORDER BY id"),
    ).toEqual([
      { id: "33333333-3333-4333-8333-333333333333", status: "cleaning" },
      { id: "44444444-4444-4444-8444-444444444444", status: "failed" },
      { id: "55555555-5555-4555-8555-555555555555", status: "failed" },
    ]);
  });
});

describe("database size", () => {
  it("alerts at 350 MB", async () => {
    const at = (size_after: number | undefined) =>
      ({
        prepare: () => ({ run: async () => ({ meta: { size_after } }) }),
      }) as unknown as D1Database;
    expect(await databaseSize(at(D1_SIZE_ALERT_BYTES - 1))).toEqual({
      bytes: D1_SIZE_ALERT_BYTES - 1,
      alert: false,
    });
    expect(await databaseSize(at(D1_SIZE_ALERT_BYTES))).toEqual({
      bytes: D1_SIZE_ALERT_BYTES,
      alert: true,
    });
    expect(await databaseSize(at(undefined))).toEqual({
      bytes: null,
      alert: false,
    });
  });
});
