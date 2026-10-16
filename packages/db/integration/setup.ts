import {
  createEmptyDraft,
  DRAFT_MAX_BYTES,
  initialSetupProgress,
  readDraft,
} from "@hasaweb/schema";
import { ownerRepositories, type SessionIdentity } from "../src/repositories";

function equal(actual: unknown, expected: unknown) {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, stable(child)]),
      );
    return value;
  };
  if (JSON.stringify(stable(actual)) !== JSON.stringify(stable(expected)))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
async function rejects(action: () => PromiseLike<unknown>) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("Expected operation to fail");
}
export async function runSetupChecks(
  db: D1Database,
  check: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  const ids = [
    "setup-a",
    "setup-b",
    "setup-revoked",
    "setup-deleting",
    "setup-expired",
    "setup-large",
  ];
  const identity = (id: string): SessionIdentity => ({
    user: { id },
    session: { id: `${id}-session` },
  });
  const draft = createEmptyDraft({
    themeId: "fixture-theme",
    fontId: "fixture-font",
    colorMode: "system",
  });
  draft.profile.name = "Keep my content";
  draft.samples = { "profile.name": true };
  const legacy = JSON.stringify({ ...draft, schemaVersion: 1 });
  for (const id of ids) {
    await db
      .prepare(
        "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .bind(id, id, `${id}@hasaweb.invalid`, 1, 1)
      .run();
    await db
      .prepare(
        "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(`${id}-session`, `${id}-token`, id, Date.now() + 3600000, 1, 1)
      .run();
    await db
      .prepare(
        "INSERT INTO portfolio(id,user_id,draft,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .bind(`${id}-portfolio`, id, legacy, 1, 1)
      .run();
  }
  const a = await ownerRepositories(db, identity("setup-a"));
  const b = await ownerRepositories(db, identity("setup-b"));
  const profile = { schemaVersion: 1, step: "profile" };
  const review = { schemaVersion: 1, step: "review" };
  const candidate = {
    op: "set",
    path: ["requestedSubdomain"],
    value: "same-candidate",
  } as const;
  await check(
    "setup: full-size legacy upgrades and progress saves preserve the 1 MiB ceiling",
    async () => {
      const large = {
        ...draft,
        schemaVersion: 1,
        profile: { ...draft.profile },
      };
      large.profile.bio = "x".repeat(
        DRAFT_MAX_BYTES -
          new TextEncoder().encode(JSON.stringify(large)).length,
      );
      await db
        .prepare("UPDATE portfolio SET draft=? WHERE user_id='setup-large'")
        .bind(JSON.stringify(large))
        .run();
      const repo = await ownerRepositories(db, identity("setup-large"));
      await repo.setup.validateLegacyDraft();
      await repo.setup.saveProgress(0, profile);
      equal(
        (
          await db
            .prepare(
              "SELECT length(cast(draft as blob)) bytes FROM portfolio WHERE user_id='setup-large'",
            )
            .first<{ bytes: number }>()
        )?.bytes,
        DRAFT_MAX_BYTES,
      );
      equal((await repo.portfolio.get())?.draft.profile.bio, large.profile.bio);
      await rejects(() =>
        repo.setup.saves.change(
          { ...candidate, path: [...candidate.path] },
          1,
          profile,
        ),
      );
      equal((await repo.setup.get())?.revision, 1);
    },
  );
  await check(
    "setup: legacy reads upgrade in memory and saves preserve samples/content",
    async () => {
      equal((await a.portfolio.get())?.draft, readDraft(JSON.parse(legacy)));
      await rejects(() => a.setup.saveProgress(0, profile));
      await rejects(() => a.setup.saves.begin(0, profile));
      equal((await a.portfolio.get())?.draftValidationVersion, 0);
      equal(
        (
          await db
            .prepare("SELECT draft FROM portfolio WHERE user_id='setup-a'")
            .first<{ draft: string }>()
        )?.draft,
        legacy,
      );
      await a.setup.validateLegacyDraft();
      await a.setup.saves.change(
        { ...candidate, path: [...candidate.path] },
        0,
        profile,
      );
      const saved = await a.portfolio.get();
      equal(saved?.draft, { ...draft, requestedSubdomain: "same-candidate" });
      equal(saved?.draftRev, 1);
      equal(saved?.setupProgress, profile);
    },
  );
  await check(
    "setup: legacy validation rejects unsafe destinations without blessing their version",
    async () => {
      const repo = await ownerRepositories(db, identity("setup-expired"));
      const invalid = JSON.parse(legacy);
      invalid.links = [
        {
          id: "legacy-link",
          label: "Legacy",
          kind: "website",
          value: `https://example.test/${"x".repeat(2048)}`,
          showInProfile: true,
          showInSocialComponent: false,
        },
      ];
      await db
        .prepare("UPDATE portfolio SET draft=? WHERE user_id='setup-expired'")
        .bind(JSON.stringify(invalid))
        .run();
      await rejects(() => repo.setup.validateLegacyDraft());
      await rejects(() => repo.setup.saves.begin(0, profile));
      equal(
        (
          await db
            .prepare(
              "SELECT draft_validation_version v FROM portfolio WHERE user_id='setup-expired'",
            )
            .first<{ v: number }>()
        )?.v,
        0,
      );
      await db
        .prepare("UPDATE portfolio SET draft=? WHERE user_id='setup-expired'")
        .bind(legacy)
        .run();
    },
  );
  await check(
    "setup: two owners retain the same candidate without a claim",
    async () => {
      await b.setup.validateLegacyDraft();
      await b.setup.saves.change(
        { ...candidate, path: [...candidate.path] },
        0,
        profile,
      );
      equal(
        (await a.portfolio.get())?.draft.requestedSubdomain,
        (await b.portfolio.get())?.draft.requestedSubdomain,
      );
      equal((await a.portfolio.get())?.subdomain, null);
      equal((await b.portfolio.get())?.subdomain, null);
      equal(await a.claims.current(), undefined);
      equal(await b.claims.current(), undefined);
    },
  );
  await check(
    "setup: repeated and concurrent creation retain the saved state",
    async () => {
      const before = await a.portfolio.get();
      await Promise.all([
        a.portfolio.create("setup-retry-1", draft),
        a.portfolio.create("setup-retry-2", draft),
      ]);
      equal(await a.portfolio.get(), before);
    },
  );
  await check(
    "setup: stale content/progress and handoff fail without partial changes",
    async () => {
      const before = await a.portfolio.get();
      await rejects(() => a.setup.saveProgress(0, review));
      await rejects(() =>
        a.setup.saves.change(
          { op: "set", path: ["profile", "name"], value: "Lost edit" },
          0,
          review,
        ),
      );
      await rejects(() => a.setup.recordFirstEditorEntry(0));
      equal(await a.portfolio.get(), before);
    },
  );
  await check(
    "setup: racing content and progress share one revision",
    async () => {
      const results = await Promise.allSettled([
        a.setup.saveProgress(1, review),
        a.setup.saves.change(
          { op: "set", path: ["profile", "bio"], value: "Another tab" },
          1,
          profile,
        ),
      ]);
      equal(results.filter((r) => r.status === "fulfilled").length, 1);
      equal((await a.setup.get())?.revision, 2);
    },
  );
  await check(
    "setup: flags, unknown progress, invalid candidates/revisions cannot mutate state",
    async () => {
      const before = await a.portfolio.get();
      await rejects(() =>
        a.setup.saveProgress(2, { ...review, enteredEditor: true }),
      );
      await rejects(() =>
        a.setup.saves.begin(2, { ...review, firstEditorEnteredAt: 1 }),
      );
      await rejects(() =>
        a.setup.saves.change(
          { op: "set", path: ["firstEditorEnteredAt"], value: 1 },
          2,
          review,
        ),
      );
      await rejects(() =>
        a.setup.saves.change(
          { op: "set", path: ["requestedSubdomain"], value: "Bad-" },
          2,
          review,
        ),
      );
      for (const rev of [-1, 1.5, Number.MAX_SAFE_INTEGER])
        await rejects(() => a.setup.saveProgress(rev, review));
      equal(await a.portfolio.get(), before);
    },
  );
  const attempt = await a.setup.saves.begin(2, review);
  await check(
    "setup: another owner cannot access or mutate staged content or progress",
    async () => {
      const before = await a.portfolio.get();
      equal(await b.portfolio.get("setup-a-portfolio"), undefined);
      for (const action of [
        () => b.setup.saves.status(attempt.id),
        () => b.setup.saves.resume(attempt.id),
        () => b.setup.saves.commit(attempt.id, 0),
        () => b.setup.saves.abort(attempt.id),
        () =>
          b.setup.saves.change(
            { op: "set", path: ["profile", "name"], value: "Other owner" },
            0,
            {},
            attempt.id,
            0,
          ),
      ])
        await rejects(action);
      equal(await a.portfolio.get(), before);
    },
  );
  await check(
    "setup: bounded content/progress commits atomically and retries are idempotent",
    async () => {
      await a.setup.saves.change(
        { op: "set", path: ["profile", "bio"], value: "Prepared content" },
        0,
        {},
        attempt.id,
        0,
      );
      equal(
        (await a.portfolio.get())?.draft.profile.bio === "Prepared content",
        false,
      );
      equal(await a.setup.saves.commit(attempt.id, 1), { revision: 3 });
      equal(await a.setup.saves.commit(attempt.id, 1), {
        revision: 3,
        replayed: true,
      });
      equal((await a.portfolio.get())?.draft.profile.bio, "Prepared content");
      equal((await a.setup.get())?.progress, review);
      await a.setup.saves.cleanup();
    },
  );
  const pending = await a.setup.saves.begin(3, profile);
  await a.setup.saves.change(
    { op: "set", path: ["profile", "bio"], value: "Stale prepared value" },
    0,
    {},
    pending.id,
    0,
  );
  await check(
    "setup: permanent entry rejects old setup writes and is idempotent",
    async () => {
      const entered = await a.setup.recordFirstEditorEntry(3);
      equal(entered.revision, 4);
      equal(await a.setup.recordFirstEditorEntry(3), entered);
      const before = await a.portfolio.get();
      await rejects(() => a.setup.saves.commit(pending.id, 1));
      await rejects(() => a.setup.saveProgress(4, profile));
      await rejects(() =>
        a.setup.saves.change(
          { op: "set", path: ["profile", "bio"], value: "Old tab" },
          4,
          review,
        ),
      );
      await rejects(() => a.setup.saves.begin(4, review));
      equal(await a.portfolio.get(), before);
      await a.portfolio.create("after-entry-retry", draft);
      equal(await a.portfolio.get(), before);
    },
  );
  await check(
    "setup: database protects entry and progress while later editor edits retain entry",
    async () => {
      const before = await a.setup.get();
      await rejects(() =>
        db
          .prepare(
            "UPDATE portfolio SET first_editor_entered_at=NULL,draft_rev=draft_rev+1 WHERE user_id='setup-a'",
          )
          .run(),
      );
      await rejects(() =>
        db
          .prepare(
            "UPDATE portfolio SET first_editor_entered_at=first_editor_entered_at+1,draft_rev=draft_rev+1 WHERE user_id='setup-a'",
          )
          .run(),
      );
      await rejects(() =>
        db
          .prepare(
            "UPDATE portfolio SET setup_progress=?,draft_rev=draft_rev+1 WHERE user_id='setup-a'",
          )
          .bind(JSON.stringify(profile))
          .run(),
      );
      await rejects(() =>
        db
          .prepare(
            "UPDATE portfolio SET setup_progress=? WHERE user_id='setup-b'",
          )
          .bind(JSON.stringify(review))
          .run(),
      );
      await db
        .prepare(
          "UPDATE portfolio SET draft=json_set(draft,'$.profile.name','Editor update'),draft_rev=draft_rev+1 WHERE user_id='setup-a' AND draft_rev=4",
        )
        .run();
      equal(
        (await a.setup.get())?.firstEditorEnteredAt,
        before?.firstEditorEnteredAt,
      );
      equal((await a.setup.get())?.progress, before?.progress);
    },
  );
  await check(
    "setup: held repositories lose access after revocation, expiry or account deletion starts",
    async () => {
      for (const id of ids.slice(2, 5)) {
        const repo = await ownerRepositories(db, identity(id));
        await repo.setup.validateLegacyDraft();
        const staged = await repo.setup.saves.begin(0, initialSetupProgress());
        if (id.endsWith("revoked"))
          await db
            .prepare("DELETE FROM session WHERE user_id=?")
            .bind(id)
            .run();
        else if (id.endsWith("expired"))
          await db
            .prepare("UPDATE session SET expires_at=1 WHERE user_id=?")
            .bind(id)
            .run();
        else
          await db
            .prepare("UPDATE user SET deleting_at=1 WHERE id=?")
            .bind(id)
            .run();
        equal(await repo.setup.get(), undefined);
        await rejects(() => repo.setup.saveProgress(0, profile));
        await rejects(() => repo.setup.recordFirstEditorEntry(0));
        await rejects(() => repo.setup.saves.commit(staged.id, 0));
        await rejects(() => repo.setup.saves.status(staged.id));
      }
    },
  );
  await check(
    "setup: account deletion removes progress, milestones and staging without reserving candidates",
    async () => {
      const s = await b.setup.saves.begin(1, review);
      await b.setup.saves.stringStart(s.id, 0, ["profile", "bio"]);
      await b.setup.saves.stringPiece(s.id, 1, "Private unfinished text");
      for (const id of ids)
        await db.prepare("DELETE FROM user WHERE id=?").bind(id).run();
      equal(
        (
          await db
            .prepare(
              "SELECT count(*) n FROM portfolio WHERE user_id LIKE 'setup-%'",
            )
            .first<{ n: number }>()
        )?.n,
        0,
      );
      equal(
        (
          await db
            .prepare("SELECT count(*) n FROM owner_save_attempt")
            .first<{ n: number }>()
        )?.n,
        0,
      );
      equal(
        (
          await db
            .prepare("SELECT count(*) n FROM owner_save_piece")
            .first<{ n: number }>()
        )?.n,
        0,
      );
      equal(
        await db
          .prepare(
            "SELECT name FROM subdomain_claim WHERE name='same-candidate'",
          )
          .first(),
        null,
      );
    },
  );
}
