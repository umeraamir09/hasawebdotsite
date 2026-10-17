import { ownerRepositories, type SessionIdentity } from "../src/repositories";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
async function rejects(action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error("Expected provisioning to fail");
}

export async function runProvisionChecks(
  db: D1Database,
  check: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  const identity = (id: string): SessionIdentity => ({
    user: { id },
    session: { id: `${id}-session` },
  });
  const raw = (id: string) =>
    db.prepare("SELECT * FROM portfolio WHERE user_id=?").bind(id).first();
  for (const id of [
    "provision-new",
    "provision-revoked",
    "provision-deleting",
    "provision-expired",
    "provision-milestone",
    "provision-legacy",
    "provision-restart",
  ]) {
    await db
      .prepare(
        "INSERT INTO user(id,name,email,image,created_at,updated_at) VALUES(?,?,?,?,1,1)",
      )
      .bind(
        id,
        "Provider name",
        `${id}@example.invalid`,
        "https://example.invalid/provider.jpg",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,1,1)",
      )
      .bind(`${id}-session`, `${id}-token`, id, Date.now() + 3600000)
      .run();
  }
  await check(
    "provision: concurrent fresh initialization creates one empty private draft",
    async () => {
      const repos = await Promise.all(
        Array.from({ length: 8 }, () =>
          ownerRepositories(db, identity("provision-new")),
        ),
      );
      const results = await Promise.all(
        repos.map((repo) => repo.portfolio.provision()),
      );
      for (const result of results) equal(result, results[0]);
      const repo = repos[0];
      if (!repo) throw new Error("Missing repository");
      const row = await repo.portfolio.get();
      equal(row?.draft, {
        schemaVersion: 2,
        profile: { name: "", bio: "", faceReveal: { enabled: false } },
        links: [],
        components: [],
        appearance: { themeId: "leaf", fontId: "dm-sans", colorMode: "system" },
        seo: {},
        samples: {},
      });
      equal(row?.setupProgress, { schemaVersion: 1, step: "address" });
      equal(row?.draftRev, 0);
      equal(row?.draftValidationVersion, 2);
      equal(row?.firstEditorEnteredAt, null);
      equal(row?.status, "draft");
      equal(row?.subdomain, null);
      equal(row?.publishedVersion, null);
      const before = await raw("provision-new");
      await repo.portfolio.provision();
      equal(await raw("provision-new"), before);
    },
  );
  await check(
    "provision: existing publication, content, progress and permanent entry are untouched",
    async () => {
      const repo = await ownerRepositories(db, identity("provision-milestone"));
      await repo.portfolio.provision();
      await repo.setup.saves.change(
        {
          op: "set",
          path: ["profile", "name"],
          value: "Owner's accepted name",
        },
        0,
        { schemaVersion: 1, step: "review" },
      );
      // Internal milestone fixture only. No HTTP handoff is enabled by Phase 12.
      await repo.setup.recordFirstEditorEntry(1);
      await db
        .prepare(
          "UPDATE portfolio SET status='published',subdomain='provision-claimed',published_version=4 WHERE user_id=?",
        )
        .bind("provision-milestone")
        .run();
      const before = await raw("provision-milestone");
      await Promise.all(
        Array.from({ length: 4 }, () => repo.portfolio.provision()),
      );
      equal(await raw("provision-milestone"), before);
    },
  );
  await check(
    "provision: legacy draft outside current URL limits remains byte-identical and unvalidated",
    async () => {
      const repo = await ownerRepositories(db, identity("provision-legacy"));
      const legacy = {
        schemaVersion: 1,
        profile: {
          name: "Existing legacy owner",
          bio: "",
          faceReveal: { enabled: false },
        },
        links: [
          {
            id: "legacy",
            kind: "website",
            label: "Keep",
            value: `https://example.invalid/${"x".repeat(3000)}`,
            showInProfile: true,
            showInSocialComponent: false,
          },
        ],
        components: [],
        appearance: {
          themeId: "old-theme",
          fontId: "old-font",
          colorMode: "dark",
        },
        seo: {},
        samples: { "profile.name": true },
      };
      await db
        .prepare(
          "INSERT INTO portfolio(id,user_id,draft,draft_validation_version,draft_rev,setup_progress,created_at,updated_at) VALUES('provision-legacy-portfolio','provision-legacy',?,0,17,?,1,1)",
        )
        .bind(
          JSON.stringify(legacy),
          JSON.stringify({ schemaVersion: 1, step: "projects" }),
        )
        .run();
      const before = await raw("provision-legacy");
      await repo.portfolio.provision();
      equal(await raw("provision-legacy"), before);
    },
  );
  for (const state of ["revoked", "deleting", "expired"]) {
    await check(
      `provision: ${state} session after repository construction cannot insert`,
      async () => {
        const id = `provision-${state}`;
        const repo = await ownerRepositories(db, identity(id));
        if (state === "revoked")
          await db
            .prepare("DELETE FROM session WHERE user_id=?")
            .bind(id)
            .run();
        else if (state === "expired")
          await db
            .prepare("UPDATE session SET expires_at=0 WHERE user_id=?")
            .bind(id)
            .run();
        else
          await db
            .prepare("UPDATE user SET deleting_at=1 WHERE id=?")
            .bind(id)
            .run();
        await rejects(() => repo.portfolio.provision());
        equal(await raw(id), null);
      },
    );
  }
  await check(
    "provision: deleted session cannot recover an existing portfolio through a held repository",
    async () => {
      const repo = await ownerRepositories(db, identity("provision-new"));
      const before = await raw("provision-new");
      await db
        .prepare("DELETE FROM session WHERE user_id='provision-new'")
        .run();
      await rejects(() => repo.portfolio.provision());
      equal(await raw("provision-new"), before);
    },
  );
  await check(
    "provision: partial setup is saved for recovery after restart",
    async () => {
      const repo = await ownerRepositories(db, identity("provision-restart"));
      await repo.portfolio.provision();
      await repo.setup.saves.change(
        { op: "set", path: ["profile", "name"], value: "Resume after restart" },
        0,
        { schemaVersion: 1, step: "profile" },
      );
    },
  );
}

export async function verifyProvisionRestart(db: D1Database) {
  const repo = await ownerRepositories(db, {
    user: { id: "provision-restart" },
    session: { id: "provision-restart-session" },
  });
  const before = await repo.portfolio.get();
  await repo.portfolio.provision();
  const after = await repo.portfolio.get();
  equal(after, before);
  if (!after) throw new Error("Missing recovered portfolio");
  return {
    status: after.status,
    revision: after.draftRev,
    step: after.setupProgress.step,
    name: after.draft.profile.name,
    firstEditorEnteredAt: after.firstEditorEnteredAt,
    noClaim: (await repo.claims.current()) === undefined,
  };
}
