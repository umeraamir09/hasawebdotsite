import { createComponent, createEmptyDraft } from "@hasaweb/schema";
import { ownerPublication } from "../src/publication";
import { ownerCaseStudyAddresses } from "../src/publication-operation";
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
  const caseProject = (id: string, title: string, slug: string) => ({
    id,
    title,
    summary: "Summary",
    technologies: [],
    contribution: "",
    caseStudy: {
      slug,
      body: {
        type: "doc" as const,
        content: [
          {
            type: "paragraph" as const,
            content: [{ type: "text" as const, text: "Body" }],
          },
        ],
      },
    },
  });
  async function live(cases: { id: string | null; slug: string }[]) {
    const candidate = crypto.randomUUID();
    await db.batch([
      db
        .prepare("DELETE FROM publish_version WHERE portfolio_id=?")
        .bind(portfolioId),
      db
        .prepare(
          "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) VALUES(?,?,?,0,'ready','[]',0,0,1,1)",
        )
        .bind(candidate, portfolioId, user),
      db
        .prepare(
          "INSERT INTO publication_candidate_index(candidate_id,value) VALUES(?,json_object('cases',json(?)))",
        )
        .bind(
          candidate,
          JSON.stringify(
            cases.map((item, index) => ({
              path: `$.components[0].data.entries[${index}]`,
              ...item,
            })),
          ),
        ),
      db
        .prepare(
          "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES(?,?,1,'live','publication-v2',?,1,1)",
        )
        .bind(candidate, portfolioId, candidate),
      db
        .prepare("UPDATE portfolio SET published_version=1 WHERE id=?")
        .bind(portfolioId),
    ]);
  }
  async function slugIssues(entries: ReturnType<typeof caseProject>[]) {
    const projects = createComponent("projects", "case-projects");
    projects.data.entries = entries;
    await db
      .prepare("UPDATE portfolio SET draft=? WHERE id=?")
      .bind(JSON.stringify({ ...draft, components: [projects] }), portfolioId)
      .run();
    const result = await ownerPublication(db, identity, async () => true).check(
      command,
    );
    return result.issues
      .filter((issue) => issue.code === "case_study_url")
      .map((issue) => issue.path.join("."));
  }
  const slugPath = (index: number) =>
    `components.0.data.entries.${index}.caseStudy.slug`;
  await check(
    "publication: a published case-study URL stays frozen after a title edit",
    async () => {
      await live([{ id: "first", slug: "original-title" }]);
      assert(
        (await slugIssues([caseProject("first", "Renamed", "original-title")]))
          .length === 0,
        "Frozen slug with a new title was rejected",
      );
      const changed = await slugIssues([
        caseProject("first", "Renamed", "renamed"),
      ]);
      assert(
        changed.join() === slugPath(0),
        `Changed frozen slug was accepted: ${changed.join()}`,
      );
    },
  );
  await check(
    "publication: a deleted project's live slug is not reassigned before its removal publishes",
    async () => {
      await live([{ id: "deleted", slug: "shared" }]);
      const taken = await slugIssues([
        caseProject("newer", "Shared", "shared"),
      ]);
      assert(
        taken.join() === slugPath(0),
        `Live slug was silently reassigned: ${taken.join()}`,
      );
      assert(
        (await slugIssues([caseProject("newer", "Shared", "shared-2")]))
          .length === 0,
        "Suffixed slug was rejected",
      );
      // After the deletion publishes, the live index no longer has the slug.
      await live([]);
      assert(
        (await slugIssues([caseProject("newer", "Shared", "shared")]))
          .length === 0,
        "Slug freed by a published deletion stayed blocked",
      );
    },
  );
  await check(
    "publication: unpublished portfolios freeze no case-study URLs",
    async () => {
      await db
        .prepare("UPDATE portfolio SET published_version=NULL WHERE id=?")
        .bind(portfolioId)
        .run();
      assert(
        (await slugIssues([caseProject("first", "Any", "any")])).length === 0,
        "Draft-only slug was frozen",
      );
      const addresses = await ownerCaseStudyAddresses(
        db,
        identity,
        portfolioId,
      );
      assert(
        addresses.version === null && addresses.addresses.length === 0,
        "Unpublished portfolio returned addresses",
      );
      await live([
        { id: "first", slug: "first" },
        { id: null, slug: "legacy" },
      ]);
      const published = await ownerCaseStudyAddresses(
        db,
        identity,
        portfolioId,
      );
      assert(
        published.version === 1 &&
          JSON.stringify(published.addresses) ===
            JSON.stringify([
              { projectId: "first", slug: "first" },
              { projectId: null, slug: "legacy" },
            ]),
        `Live addresses differ: ${JSON.stringify(published)}`,
      );
      let denied = false;
      await ownerCaseStudyAddresses(
        db,
        { user: { id: "someone-else" }, session: { id: session } },
        portfolioId,
      ).catch(() => {
        denied = true;
      });
      assert(denied, "Another owner read the case-study addresses");
      await db.batch([
        db
          .prepare(
            "UPDATE portfolio SET published_version=NULL,draft=? WHERE id=?",
          )
          .bind(JSON.stringify(draft), portfolioId),
        db
          .prepare("DELETE FROM publish_version WHERE portfolio_id=?")
          .bind(portfolioId),
        db
          .prepare("DELETE FROM publication_candidate WHERE portfolio_id=?")
          .bind(portfolioId),
      ]);
    },
  );
  await db.prepare("DELETE FROM user WHERE id=?").bind(user).run();
}
