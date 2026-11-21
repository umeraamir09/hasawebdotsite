import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../packages/db/test/sqlite-d1";
import {
  OperatorError,
  operatorCommands,
  purgeHosts,
  sqlLiteral,
  target,
} from "./commands.mjs";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function world() {
  const db = sqliteD1();
  const run = (query, ...values) => db.sqlite.prepare(query).run(...values);
  const rows = (query, ...values) => db.sqlite.prepare(query).all(...values);
  let clock = NOW;
  const ops = operatorCommands({
    sql: async (query, values = []) => db.sqlite.prepare(query).all(...values),
    now: () => clock,
  });
  function owner(id, { status = "published", version = 1 } = {}) {
    run(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      id,
      id,
      `${id}@example.test`,
      NOW,
      NOW,
    );
    const published = status !== "draft";
    run(
      "INSERT INTO portfolio(id,user_id,subdomain,status,published_version,draft,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?)",
      `${id}-portfolio`,
      id,
      published ? id : null,
      status,
      published ? version : null,
      NOW,
      NOW,
    );
    run(
      "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at,claimed_at) VALUES(?,?,?,?,?)",
      id,
      `${id}-portfolio`,
      published ? "claimed" : "held",
      published ? null : NOW,
      published ? NOW : null,
    );
  }
  return {
    db,
    run,
    rows,
    ops,
    owner,
    tick: (ms) => {
      clock += ms;
    },
  };
}

describe("targets", () => {
  it("accepts an address, a portfolio URL, an account or a portfolio", () => {
    expect(target({ address: "Ada" })).toEqual({ address: "ada" });
    expect(
      target({ address: "https://ada.hasaweb.site/projects/x?y=1" }),
    ).toEqual({ address: "ada" });
    expect(target({ account: "user-1" })).toEqual({ account: "user-1" });
    expect(() => target({})).toThrow(OperatorError);
    expect(() => target({ address: "a", account: "b" })).toThrow(OperatorError);
    expect(() => target({ address: "-bad-" })).toThrow(OperatorError);
    expect(() => target({ account: "x' OR 1=1" })).toThrow(OperatorError);
  });

  it("quotes SQL literals for wrangler", () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral(12)).toBe("12");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(() => sqlLiteral("a\0b")).toThrow(OperatorError);
    expect(() => sqlLiteral(1.5)).toThrow(OperatorError);
  });
});

describe("suspension", () => {
  it("stops serving at once, withdraws public files once, and unsuspends to unpublished", async () => {
    const w = world();
    w.owner("ada", { version: 3 });
    await expect(
      w.ops.suspend({ address: "ada", case: "case-51", reason: "spam" }),
    ).resolves.toMatchObject({
      status: "suspended",
      suspended_at: NOW,
      suspended_reason: "case-51: spam",
      claim_state: "claimed",
    });
    const withdrawals = () =>
      w.rows("SELECT portfolio_id,address,version FROM publication_withdrawal");
    expect(withdrawals()).toEqual([
      { portfolio_id: "ada-portfolio", address: "ada", version: 3 },
    ]);
    // Repeating it, before or after the cleanup finished, adds nothing.
    await w.ops.suspend({ address: "ada", case: "case-51", reason: "spam" });
    w.run("UPDATE publication_withdrawal SET completed_at=?", NOW + 1);
    w.tick(DAY);
    await w.ops.suspend({ address: "ada", case: "case-51", reason: "spam" });
    expect(withdrawals()).toHaveLength(1);
    expect((await w.ops.abuseReport({ address: "ada" })).served).toBe(false);

    const lifted = await w.ops.unsuspend({ address: "ada", case: "case-51" });
    expect(lifted).toMatchObject({
      status: "unpublished",
      subdomain: "ada",
      published_version: 3,
      suspended_at: null,
      suspended_reason: null,
      claim_state: "claimed",
    });
    await expect(
      w.ops.unsuspend({ address: "ada", case: "case-51" }),
    ).rejects.toThrow("The portfolio is unpublished");
  });

  it("suspends a draft without a withdrawal and returns it to draft", async () => {
    const w = world();
    w.owner("boris", { status: "draft" });
    await w.ops.suspend({
      address: "boris",
      case: "case-52",
      reason: "phishing",
    });
    expect(w.rows("SELECT * FROM publication_withdrawal")).toEqual([]);
    expect(
      (await w.ops.unsuspend({ account: "boris", case: "case-52" })).status,
    ).toBe("draft");
    // The hold survives both.
    expect(
      w.rows("SELECT state FROM subdomain_claim WHERE name='boris'"),
    ).toEqual([{ state: "held" }]);
  });

  it("refuses accounts being deleted and inputs that could hold an email", async () => {
    const w = world();
    w.owner("cyril");
    w.run("UPDATE user SET deleting_at=? WHERE id='cyril'", NOW);
    await expect(
      w.ops.suspend({ address: "cyril", case: "case-53", reason: "x" }),
    ).rejects.toThrow("being deleted");
    await expect(
      w.ops.suspend({ address: "cyril", case: "a@b.test", reason: "x" }),
    ).rejects.toThrow("--case");
    await expect(
      w.ops.suspend({ address: "cyril", case: "case-53", reason: "mail a@b" }),
    ).rejects.toThrow("--reason");
  });
});

describe("audited email lookup", () => {
  it("audits without the email, and the audit goes with the account", async () => {
    const w = world();
    w.owner("dee");
    w.owner("eve");
    const found = await w.ops.emailLookup({
      address: "dee",
      operator: "ops.one",
      case: "abuse-77",
    });
    expect(found).toMatchObject({
      accountId: "dee",
      email: "dee@example.test",
    });
    await w.ops.emailLookup({
      account: "eve",
      operator: "ops.one",
      case: "abuse-78",
    });
    const audits = w.rows(
      "SELECT * FROM operator_email_audit ORDER BY account_id",
    );
    expect(audits).toEqual([
      {
        id: found.auditId,
        operator_id: "ops.one",
        account_id: "dee",
        case_reference: "abuse-77",
        accessed_at: NOW,
      },
      expect.objectContaining({ account_id: "eve" }),
    ]);
    expect(JSON.stringify(audits)).not.toContain("@");
    for (const bad of [
      { operator: "me@ops.test", case: "abuse-77" },
      { operator: "ops", case: "dee@example.test" },
      { case: "abuse-77" },
    ])
      await expect(
        w.ops.emailLookup({ address: "dee", ...bad }),
      ).rejects.toThrow(OperatorError);
    // Account removal (the Phase 49 rows stage) cascades the audit.
    w.run("DELETE FROM portfolio WHERE user_id='dee'");
    w.run("DELETE FROM user WHERE id='dee'");
    expect(w.rows("SELECT account_id FROM operator_email_audit")).toEqual([
      { account_id: "eve" },
    ]);
  });

  it("cleans up audits past 90 days", async () => {
    const w = world();
    w.owner("fay");
    for (let n = 0; n < 70; n++)
      w.run(
        "INSERT INTO operator_email_audit(id,operator_id,account_id,case_reference,accessed_at) VALUES(?,'ops','fay','case-1',?)",
        `old-${n}`,
        NOW - 91 * DAY,
      );
    w.run(
      "INSERT INTO operator_email_audit(id,operator_id,account_id,case_reference,accessed_at) VALUES('recent','ops','fay','case-1',?)",
      NOW - DAY,
    );
    expect(await w.ops.auditCleanup()).toEqual({ removed: 70 });
    expect(w.rows("SELECT id FROM operator_email_audit")).toEqual([
      { id: "recent" },
    ]);
  });
});

describe("outbox inspection", () => {
  it("reports state without message content", async () => {
    const w = world();
    w.owner("gus");
    w.run(
      "INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day) VALUES('r1','gus-portfolio','contact',0,'2027-01-04')",
    );
    w.run(
      "INSERT INTO contact_outbox(id,portfolio_id,payload,status,attempts,next_attempt_at,is_test,accepted_at,deadline_at,budget_window_start) VALUES('r1','gus-portfolio',?,'queued',1,?,0,?,?,?)",
      JSON.stringify({
        name: "V",
        email: "visitor@example.test",
        message: "hi",
      }),
      NOW,
      NOW,
      NOW + DAY,
      NOW,
    );
    const report = await w.ops.outbox({ status: "queued" });
    expect(report.totals).toEqual([
      { status: "queued", n: 1, next_attempt_at: NOW },
    ]);
    expect(report.rows).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("visitor@example.test");
    await expect(w.ops.outbox({ status: "lost" })).rejects.toThrow(
      OperatorError,
    );
  });
});

describe("rerender plan", () => {
  it("rerenders only the revision the live version was built from", async () => {
    const w = world();
    w.owner("hal", { version: 1 });
    w.run("UPDATE portfolio SET draft_rev=4 WHERE id='hal-portfolio'");
    w.run(
      "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,source,status,cursor,next_attempt_at,deadline_at,renderer_version,created_at,updated_at) VALUES('77777777-7777-4777-8777-777777777777','hal-portfolio','hal',4,'{}','ready','[]',0,?,'publication-v8',?,?)",
      NOW + DAY,
      NOW,
      NOW,
    );
    w.run(
      "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES('v1','hal-portfolio',1,'live','publication-v8','77777777-7777-4777-8777-777777777777',?,?)",
      NOW,
      NOW,
    );
    expect(await w.ops.rerenderPlan({ address: "hal" })).toEqual({
      accountId: "hal",
      portfolioId: "hal-portfolio",
      address: "hal",
      revision: 4,
      rendererVersion: "publication-v8",
    });
    // An unpublished edit must not go public through a rerender.
    w.run("UPDATE portfolio SET draft_rev=5 WHERE id='hal-portfolio'");
    await expect(w.ops.rerenderPlan({ address: "hal" })).rejects.toThrow(
      "only the owner's Publish",
    );
    w.run("UPDATE portfolio SET status='suspended' WHERE id='hal-portfolio'");
    await expect(w.ops.rerenderPlan({ address: "hal" })).rejects.toThrow(
      "not published",
    );
  });
});

describe("cache purge", () => {
  it("purges the portfolio and asset hosts", async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return Response.json({ success: true });
    };
    expect(
      await purgeHosts({ zoneId: "zone", token: "t", address: "ada", fetch }),
    ).toEqual({ hosts: ["ada.hasaweb.site", "assets.hasaweb.site"] });
    expect(calls).toEqual([
      {
        url: "https://api.cloudflare.com/client/v4/zones/zone/purge_cache",
        body: { hosts: ["ada.hasaweb.site", "assets.hasaweb.site"] },
      },
    ]);
    await expect(purgeHosts({ address: "ada", fetch })).rejects.toThrow(
      "CLOUDFLARE_ZONE_ID",
    );
  });
});

describe("ownerless names", () => {
  it("explains a deleted account's permanent claim", async () => {
    const w = world();
    w.run(
      "INSERT INTO subdomain_claim(name,portfolio_id,state,claimed_at) VALUES('gone',NULL,'claimed',?)",
      NOW,
    );
    await expect(w.ops.abuseReport({ address: "gone" })).rejects.toThrow(
      "ownerless claimed name",
    );
  });
});
