import {
  type AddressCommand,
  createEmptyDraft,
  initialSetupProgress,
} from "@hasaweb/schema";
import { ownerAddresses } from "../src/addresses";
import { SaveError } from "../src/bounded-save";
import { ownerDrafts } from "../src/draft-api";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(task: () => PromiseLike<unknown>, code?: string) {
  try {
    await task();
  } catch (error) {
    if (code)
      assert(
        error instanceof SaveError && error.code === code,
        `Expected ${code}, received ${String(error)}`,
      );
    return;
  }
  throw new Error(`Expected failure ${code ?? ""}`);
}
export async function runAddressChecks(
  db: D1Database,
  check: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  const identity = (id: string) => ({
    user: { id: `address-${id}` },
    session: { id: `address-${id}-session` },
  });
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  draft.requestedSubdomain = "old-candidate";
  for (const id of ["a", "b", "legacy", "claimed", "delete"]) {
    const owner = identity(id);
    await db.batch([
      db
        .prepare(
          "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,1,1)",
        )
        .bind(owner.user.id, id, `${id}@address.invalid`),
      db
        .prepare(
          "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,1,1)",
        )
        .bind(
          owner.session.id,
          owner.session.id,
          owner.user.id,
          Date.now() + 3600000,
        ),
      db
        .prepare(
          "INSERT INTO portfolio(id,user_id,draft,draft_validation_version,created_at,updated_at) VALUES(?,?,?,2,1,1)",
        )
        .bind(`address-${id}-portfolio`, owner.user.id, JSON.stringify(draft)),
    ]);
  }
  const repo = (id: string) => ownerAddresses(db, identity(id));
  const command = (id: string, name: string, revision = 0): AddressCommand => ({
    id: crypto.randomUUID(),
    portfolioId: `address-${id}-portfolio`,
    revision,
    context: "content",
    name,
  });
  await check(
    "address: a zero-row CAS rolls back delete and insert in real D1",
    async () => {
      await repo("a").confirm(command("a", "first-held"));
      await rejects(
        () => repo("a").confirm(command("a", "failed-swap", 0)),
        "revision_conflict",
      );
      assert(
        (await repo("a").state())?.name === "first-held",
        "Stale CAS lost the original hold",
      );
      assert(
        (await repo("b").availability("failed-swap")).status === "available",
        "Failed CAS leaked a new hold",
      );
      assert(
        (await ownerDrafts(db, identity("a")).metadata()).revision === 1,
        "Failed CAS changed revision",
      );
    },
  );
  await check(
    "address: pending staging and foreign portfolio commands cannot release a hold",
    async () => {
      const attempt = await ownerDrafts(db, identity("a"))
        .saves("content")
        .begin(1, undefined);
      await rejects(
        () => repo("a").confirm(command("a", "pending-bypass", 1)),
        "save_rejected",
      );
      assert(
        (await repo("a").state())?.name === "first-held",
        "Pending attempt lost hold",
      );
      await ownerDrafts(db, identity("a")).saves("content").abort(attempt.id);
      const before = await db
        .prepare(
          "SELECT name,portfolio_id,state FROM subdomain_claim ORDER BY name",
        )
        .all();
      await rejects(
        () =>
          repo("b").confirm({
            ...command("b", "foreign-delete", 1),
            portfolioId: "address-a-portfolio",
          }),
        "owner_changed",
      );
      const after = await db
        .prepare(
          "SELECT name,portfolio_id,state FROM subdomain_claim ORDER BY name",
        )
        .all();
      assert(
        JSON.stringify(before.results) === JSON.stringify(after.results),
        "Foreign command changed namespace",
      );
      const held = await db
        .prepare(
          "SELECT held_at,claimed_at FROM subdomain_claim WHERE name='first-held'",
        )
        .first<{ held_at: number; claimed_at: number | null }>();
      assert(
        held?.held_at && held.held_at > 0 && held.claimed_at === null,
        "Hold timestamp/state mismatch",
      );
    },
  );
  await check(
    "address: duplicate command races replay one immutable receipt",
    async () => {
      const cmd = command("a", "race-held", 1);
      const receipts = await Promise.all([
        repo("a").confirm(cmd),
        repo("a").confirm(cmd),
      ]);
      assert(
        receipts.every((r) => r.revision === 2),
        "Duplicate command incremented revision twice",
      );
      assert(
        (await repo("a").confirm(cmd)).replayed,
        "Lost response did not replay",
      );
      await rejects(
        () => repo("a").confirm({ ...cmd, name: "changed-payload" }),
        "command_conflict",
      );
      await rejects(
        () => repo("a").confirm({ ...cmd, revision: 2 }),
        "command_conflict",
      );
      assert(
        (await repo("a").state())?.name === "race-held",
        "Changed payload changed hold",
      );
    },
  );
  await check(
    "address: namespace contention and dynamic blocklist preserve prior holds",
    async () => {
      const [a, b] = await Promise.allSettled([
        repo("a").confirm(command("a", "contested", 2)),
        repo("b").confirm(command("b", "contested")),
      ]);
      assert(
        [a, b].filter((r) => r.status === "fulfilled").length === 1,
        "Namespace admitted two owners",
      );
      const before = await repo("a").state();
      await db
        .prepare(
          "INSERT INTO reserved_subdomain(name) VALUES('dynamic-reserved')",
        )
        .run();
      const revision = (await ownerDrafts(db, identity("a")).metadata())
        .revision;
      await rejects(
        () => repo("a").confirm(command("a", "dynamic-reserved", revision)),
        "address_reserved",
      );
      assert(
        JSON.stringify(await repo("a").state()) === JSON.stringify(before),
        "Reserved swap lost hold",
      );
      await db
        .prepare("DELETE FROM reserved_subdomain WHERE name='dynamic-reserved'")
        .run();
    },
  );
  await check(
    "address: same legacy candidate requires an explicit hold and creates no public URL",
    async () => {
      assert(
        (await repo("legacy").state()) === null,
        "Migration promoted a candidate",
      );
      await repo("legacy").confirm(command("legacy", "old-candidate"));
      assert(
        (await repo("legacy").state())?.state === "held",
        "Same-name confirmation did not reserve",
      );
      const row = await db
        .prepare(
          "SELECT subdomain FROM portfolio WHERE id='address-legacy-portfolio'",
        )
        .first<{ subdomain: string | null }>();
      assert(row?.subdomain === null, "Hold created public pointer");
    },
  );
  await check(
    "address: generic root, leaf, staging and historical mismatches obey mirror guard",
    async () => {
      const saves = ownerDrafts(db, identity("legacy")).saves("content");
      await rejects(() =>
        saves.change(
          { op: "set", path: ["requestedSubdomain"], value: "bypass" },
          1,
          undefined,
        ),
      );
      await rejects(() =>
        saves.change(
          {
            op: "set",
            path: [],
            value: { ...draft, requestedSubdomain: "bypass" },
          },
          1,
          undefined,
        ),
      );
      const attempt = await saves.begin(1, undefined);
      await saves.change(
        { op: "set", path: ["requestedSubdomain"], value: "staged-bypass" },
        0,
        undefined,
        attempt.id,
        0,
      );
      await rejects(() => saves.commit(attempt.id, 1));
      assert(
        (await repo("legacy").state())?.name === "old-candidate",
        "Staging changed hold",
      );
      await saves.abort(attempt.id);
      await db
        .prepare(
          "INSERT INTO subdomain_claim(name,portfolio_id,claimed_at) VALUES('permanent','address-claimed-portfolio',123)",
        )
        .run();
      const claimed = ownerDrafts(db, identity("claimed")).saves("content");
      await claimed.change(
        { op: "set", path: ["profile", "name"], value: "Unchanged mismatch" },
        0,
        undefined,
      );
      await claimed.change(
        { op: "set", path: ["requestedSubdomain"], value: "permanent" },
        1,
        undefined,
      );
      await repo("claimed").confirm(command("claimed", "permanent", 2));
      assert(
        (await repo("claimed").state())?.state === "claimed",
        "Confirmation downgraded permanent claim",
      );
      await rejects(
        () => repo("claimed").confirm(command("claimed", "rename", 3)),
        "address_locked",
      );
      await rejects(() =>
        db
          .prepare(
            "UPDATE subdomain_claim SET state='held' WHERE name='permanent'",
          )
          .run(),
      );
      await rejects(() =>
        db.prepare("DELETE FROM subdomain_claim WHERE name='permanent'").run(),
      );
    },
  );
  await check(
    "address: closed setup and revoked sessions keep the current hold",
    async () => {
      await repo("delete").confirm(command("delete", "delete-held"));
      await db
        .prepare(
          "UPDATE portfolio SET first_editor_entered_at=42,draft_rev=draft_rev+1 WHERE id='address-delete-portfolio'",
        )
        .run();
      await rejects(
        () =>
          repo("delete").confirm({
            ...command("delete", "closed-held", 1),
            context: "setup",
            progress: initialSetupProgress(),
          }),
        "setup_closed",
      );
      assert(
        (await repo("delete").state())?.name === "delete-held",
        "Closed setup lost hold",
      );
      await db
        .prepare(
          "UPDATE session SET expires_at=1 WHERE id='address-delete-session'",
        )
        .run();
      await rejects(
        () => repo("delete").confirm(command("delete", "revoked-held", 1)),
        "unauthorized",
      );
      const hold = await db
        .prepare(
          "SELECT name FROM subdomain_claim WHERE portfolio_id='address-delete-portfolio'",
        )
        .first<{ name: string }>();
      assert(hold?.name === "delete-held", "Revocation lost hold");
      await db.prepare("DELETE FROM user WHERE id='address-delete'").run();
      assert(
        !(await db
          .prepare("SELECT 1 FROM subdomain_claim WHERE name='delete-held'")
          .first()),
        "Account deletion retained never-published hold",
      );
      await db.prepare("DELETE FROM user WHERE id='address-claimed'").run();
      const permanent = await db
        .prepare(
          "SELECT portfolio_id,state FROM subdomain_claim WHERE name='permanent'",
        )
        .first<{ portfolio_id: string | null; state: string }>();
      assert(
        permanent?.state === "claimed" && permanent.portfolio_id === null,
        "Account deletion lost permanent orphan",
      );
    },
  );
}
