import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../test/sqlite-d1";
import { requestAccountDeletion } from "./account-deletion";

const NOW = 1_800_000_000_000;

function seed(
  db: ReturnType<typeof sqliteD1>,
  owner: string,
  address?: { name: string; state: "held" | "claimed" },
) {
  const run = (query: string, ...values: (string | number | null)[]) =>
    db.sqlite.prepare(query).run(...values);
  run(
    "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    owner,
    owner,
    `${owner}@example.test`,
    NOW,
    NOW,
  );
  for (const id of [`${owner}-session`, `${owner}-laptop`])
    run(
      "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      id,
      `${id}-token`,
      owner,
      NOW + 3_600_000,
      NOW,
      NOW,
    );
  run(
    "INSERT INTO portfolio(id,user_id,subdomain,status,draft,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    `${owner}-portfolio`,
    owner,
    address?.state === "claimed" ? address.name : null,
    address?.state === "claimed" ? "published" : "draft",
    "{}",
    NOW,
    NOW,
  );
  if (address)
    run(
      "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at,claimed_at) VALUES(?,?,?,?,?)",
      address.name,
      `${owner}-portfolio`,
      address.state,
      address.state === "held" ? NOW : null,
      address.state === "claimed" ? NOW : null,
    );
  return {
    user: { id: owner },
    session: { id: `${owner}-session` },
  };
}
const one = (
  db: ReturnType<typeof sqliteD1>,
  query: string,
  ...values: string[]
) =>
  db.sqlite.prepare(query).get(...values) as
    | Record<string, unknown>
    | undefined;

describe("requestAccountDeletion", () => {
  it("denies access, ends every session, releases a hold and records the cleanup in one batch", async () => {
    const db = sqliteD1();
    const identity = seed(db, "alice", { name: "alice-site", state: "held" });
    seed(db, "bob");
    const started = await requestAccountDeletion(db, identity, NOW + 1);
    expect(started?.deletionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(one(db, "SELECT deleting_at FROM user WHERE id='alice'")).toEqual({
      deleting_at: NOW + 1,
    });
    expect(
      one(db, "SELECT status FROM portfolio WHERE id='alice-portfolio'"),
    ).toEqual({ status: "deleting" });
    expect(
      one(db, "SELECT count(*) AS n FROM session WHERE user_id='alice'"),
    ).toEqual({ n: 0 });
    // The never-published name is free for another account at once.
    expect(
      one(db, "SELECT * FROM subdomain_claim WHERE name='alice-site'"),
    ).toBeUndefined();
    db.sqlite
      .prepare(
        "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES('alice-site','bob-portfolio','held',?)",
      )
      .run(NOW + 2);
    expect(
      one(
        db,
        "SELECT user_id,portfolio_id,address,stage FROM account_deletion WHERE id=?",
        started?.deletionId ?? "",
      ),
    ).toEqual({
      user_id: "alice",
      portfolio_id: "alice-portfolio",
      address: null,
      stage: "public",
    });
    // Another account is untouched.
    expect(
      one(db, "SELECT count(*) AS n FROM session WHERE user_id='bob'"),
    ).toEqual({ n: 2 });
    expect(one(db, "SELECT deleting_at FROM user WHERE id='bob'")).toEqual({
      deleting_at: null,
    });
  });

  it("keeps a published address only as a permanent ownerless claim", async () => {
    const db = sqliteD1();
    const identity = seed(db, "alice", {
      name: "alice-site",
      state: "claimed",
    });
    seed(db, "bob");
    const started = await requestAccountDeletion(db, identity, NOW + 1);
    expect(
      one(
        db,
        "SELECT portfolio_id,state FROM subdomain_claim WHERE name='alice-site'",
      ),
    ).toEqual({ portfolio_id: null, state: "claimed" });
    expect(
      one(
        db,
        "SELECT address FROM account_deletion WHERE id=?",
        started?.deletionId ?? "",
      ),
    ).toEqual({ address: "alice-site" });
    // No account can hold, take over or delete the claim.
    for (const query of [
      "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES('alice-site','bob-portfolio','held',1)",
      "UPDATE subdomain_claim SET portfolio_id='bob-portfolio' WHERE name='alice-site'",
      "DELETE FROM subdomain_claim WHERE name='alice-site'",
    ])
      expect(() => db.sqlite.prepare(query).run()).toThrow();
  });

  it("changes nothing for an ended session or a repeated request", async () => {
    const db = sqliteD1();
    const identity = seed(db, "alice", { name: "alice-site", state: "held" });
    expect(
      await requestAccountDeletion(
        db,
        { ...identity, session: { id: "gone" } },
        NOW + 1,
      ),
    ).toBeNull();
    expect(one(db, "SELECT deleting_at FROM user WHERE id='alice'")).toEqual({
      deleting_at: null,
    });
    expect(one(db, "SELECT count(*) AS n FROM subdomain_claim")).toEqual({
      n: 1,
    });
    // A second device's session cannot start a second cleanup.
    expect(await requestAccountDeletion(db, identity, NOW + 1)).not.toBeNull();
    expect(
      await requestAccountDeletion(
        db,
        { ...identity, session: { id: "alice-laptop" } },
        NOW + 2,
      ),
    ).toBeNull();
    expect(one(db, "SELECT count(*) AS n FROM account_deletion")).toEqual({
      n: 1,
    });
  });
});
