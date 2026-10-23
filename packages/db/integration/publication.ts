import { createComponent, createEmptyDraft } from "@hasaweb/schema";
import { ownerPublication } from "../src/publication";
import type { SessionIdentity } from "../src/repositories";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function runPublicationChecks(
  db: D1Database,
  check: (name: string, action: () => Promise<void>) => Promise<void>,
) {
  const user = "pub-boundary",
    portfolioId = "pub-boundary-portfolio",
    session = "pub-boundary-session";
  const identity: SessionIdentity = {
    user: { id: user },
    session: { id: session },
  };
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  draft.profile = {
    name: "My name",
    bio: "My biography",
    avatar: { assetId: "pub-avatar", accepted: true },
    banner: { assetId: "pub-banner" },
    faceReveal: { enabled: false },
  };
  draft.links = [
    {
      id: "link",
      label: "Website",
      kind: "website",
      value: "https://example.com",
      showInProfile: true,
      showInSocialComponent: false,
    },
  ];
  draft.requestedSubdomain = "publication-boundary";
  await db
    .prepare(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,1,1)",
    )
    .bind(user, user, "pub@hasaweb.invalid")
    .run();
  async function sessionRow() {
    await db
      .prepare(
        "INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,1,1)",
      )
      .bind(session, session, user, Date.now() + 3600000)
      .run();
  }
  await sessionRow();
  await db
    .prepare(
      "INSERT INTO portfolio(id,user_id,draft,draft_validation_version,first_editor_entered_at,created_at,updated_at) VALUES(?,?,?,2,1,1,1)",
    )
    .bind(portfolioId, user, JSON.stringify(draft))
    .run();
  await db
    .prepare(
      "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES(?,?,'held',1)",
    )
    .bind(draft.requestedSubdomain, portfolioId)
    .run();
  for (const kind of ["avatar", "banner"])
    await db
      .prepare(
        "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES(?,?,?,'image/png',1,'ready',1,1)",
      )
      .bind(`pub-${kind}`, portfolioId, kind)
      .run();
  const command = { portfolioId, revision: 0, assetOffset: 0 };
  await check(
    "publication: editor milestone cannot bypass missing required content",
    async () => {
      await db
        .prepare(
          "UPDATE portfolio SET draft=json_set(draft,'$.profile.name','') WHERE id=?",
        )
        .bind(portfolioId)
        .run();
      const result = await ownerPublication(
        db,
        identity,
        async () => true,
      ).check(command);
      assert(
        result.issues.some((issue) => issue.path.join(".") === "profile.name"),
        "Milestone bypassed required profile",
      );
      await db
        .prepare("UPDATE portfolio SET draft=? WHERE id=?")
        .bind(JSON.stringify(draft), portfolioId)
        .run();
    },
  );
  await check(
    "publication: bounded issues never turn dense incomplete content into readiness",
    async () => {
      const projects = createComponent("projects", "dense");
      projects.data.entries = Array.from({ length: 100 }, (_, index) => ({
        id: `entry${index}`,
        title: "",
        summary: "",
        technologies: [],
        contribution: "",
      }));
      await db
        .prepare("UPDATE portfolio SET draft=? WHERE id=?")
        .bind(JSON.stringify({ ...draft, components: [projects] }), portfolioId)
        .run();
      const result = await ownerPublication(
        db,
        identity,
        async () => true,
      ).check(command);
      assert(
        result.issues.length === 50 && result.hasMoreIssues,
        "Issue truncation became readiness",
      );
      await db
        .prepare("UPDATE portfolio SET draft=? WHERE id=?")
        .bind(JSON.stringify(draft), portfolioId)
        .run();
    },
  );
  for (const failure of ["revision", "revoke", "deleting"] as const) {
    await check(
      `publication: ${failure} during object reads invalidates the result`,
      async () => {
        let changed = false;
        try {
          await ownerPublication(db, identity, async () => {
            if (!changed) {
              changed = true;
              if (failure === "revision")
                await db
                  .prepare("UPDATE portfolio SET draft_rev=1 WHERE id=?")
                  .bind(portfolioId)
                  .run();
              if (failure === "revoke")
                await db
                  .prepare("DELETE FROM session WHERE id=?")
                  .bind(session)
                  .run();
              if (failure === "deleting")
                await db
                  .prepare("UPDATE user SET deleting_at=1 WHERE id=?")
                  .bind(user)
                  .run();
            }
            return true;
          }).check(command);
          throw new Error("Changed authority returned readiness");
        } catch (error) {
          assert(
            error instanceof Error &&
              "code" in error &&
              ["revision_conflict", "unauthorized"].includes(
                String(error.code),
              ),
            "Wrong authority failure",
          );
        } finally {
          await db
            .prepare("UPDATE user SET deleting_at=NULL WHERE id=?")
            .bind(user)
            .run();
          await db
            .prepare("UPDATE portfolio SET draft_rev=0 WHERE id=?")
            .bind(portfolioId)
            .run();
          await sessionRow();
        }
      },
    );
  }
  await db.prepare("DELETE FROM user WHERE id=?").bind(user).run();
}
