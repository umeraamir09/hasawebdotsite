import {
  type AssetPurpose,
  type ComponentType,
  PUBLICATION_ASSET_PAGE,
  PUBLICATION_ISSUE_LIMIT,
  type PublicationCommand,
  type PublicationIssue,
  type PublicationResult,
  publicationIssueSchema,
} from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { SaveError } from "./bounded-save";
import { activeSaveSession, ownerDrafts, saveSessionParams } from "./draft-api";
import type { SessionIdentity } from "./repositories";
import {
  setupNoAttempt,
  setupRequirements,
  setupValidDraft,
  setupWhitespace,
} from "./setup-entry";

const present = (value: string) =>
  `length(trim(coalesce(${value},''),${setupWhitespace}))>0`;
const field = (value: string, key: string) =>
  `json_extract(${value},'$.${key}')`;
const list = (items: { id: string }[]) =>
  items.map((item) => `'${item.id.replaceAll("'", "''")}'`).join(",");
const path = (...parts: (string | number)[]) =>
  `json_array(${parts.map((part) => (typeof part === "number" ? part : `'${part}'`)).join(",")})`;
const issue = (
  code: PublicationIssue["code"],
  target: string,
  from: string,
  condition: string,
) => ({ code, target, from, condition });
const cp = (suffix: string) =>
  `json_insert(json_array('components',c.idx,'data'),'$[#]',${suffix})`;
const ep = (key: string) =>
  `json_array('components',c.idx,'data','entries',e.key,'${key}')`;
const required = (key: "name" | "bio" | "avatar" | "banner") =>
  issue(
    "required",
    path("profile", key),
    "p AS portfolio",
    setupRequirements[key],
  );
const componentRows = `c, json_each(c.value,'$.data.entries') e`;
// The live version's indexed case studies for portfolio row `p`.
export const liveCaseStudies = `SELECT k.value FROM p AS live,publish_version v,publication_candidate_index x,json_each(x.value,'$.cases') k
  WHERE v.portfolio_id=live.id AND v.n=live.published_version AND x.candidate_id=v.candidate_id`;
const rules = [
  ...(["name", "bio", "avatar", "banner"] as const).map(required),
  issue("required", path("links"), "p AS portfolio", setupRequirements.links),
  issue(
    "address",
    path("requestedSubdomain"),
    "p",
    `EXISTS(SELECT 1 FROM subdomain_claim s WHERE s.portfolio_id=p.id AND
    ((p.subdomain IS NULL AND s.state='held' AND s.name=json_extract(p.draft,'$.requestedSubdomain')) OR
     (p.subdomain IS NOT NULL AND s.state='claimed' AND s.name=p.subdomain))
    AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=s.name))`,
  ),
  issue(
    "catalog",
    path("appearance", "themeId"),
    "p",
    `json_extract(draft,'$.appearance.themeId') IN (${list(appearanceCatalog.themes)})`,
  ),
  issue(
    "catalog",
    path("appearance", "fontId"),
    "p",
    `json_extract(draft,'$.appearance.fontId') IN (${list(appearanceCatalog.fonts)})`,
  ),
  issue(
    "catalog",
    path("profile", "decorationId"),
    "p",
    `json_extract(draft,'$.profile.decorationId') IS NULL OR json_extract(draft,'$.profile.decorationId') IN (${list(appearanceCatalog.decorations)})`,
  ),
  issue(
    "required",
    path("profile", "faceReveal", "image"),
    "p",
    `json_extract(draft,'$.profile.faceReveal.enabled')!=1 OR json_extract(draft,'$.profile.faceReveal.image.assetId') IS NOT NULL`,
  ),
  issue(
    "required",
    `json_array('links',l.key,'label')`,
    "p,json_each(draft,'$.links') l",
    `NOT (${field("l.value", "showInProfile")}=1 OR (${field("l.value", "showInSocialComponent")}=1 AND EXISTS(SELECT 1 FROM c WHERE type='social-links'))) OR ${present(field("l.value", "label"))}`,
  ),
  issue(
    "required",
    `json_array('links',l.key,'value')`,
    "p,json_each(draft,'$.links') l",
    `NOT (${field("l.value", "showInProfile")}=1 OR (${field("l.value", "showInSocialComponent")}=1 AND EXISTS(SELECT 1 FROM c WHERE type='social-links'))) OR ${present(field("l.value", "value"))}`,
  ),
  ...["projects", "skills", "work-experience"].map((type) =>
    issue(
      "required",
      cp("'entries'"),
      `c`,
      `c.type!='${type}' OR json_array_length(c.value,'$.data.entries')>0`,
    ),
  ),
  ...["title", "summary"].map((key) =>
    issue(
      "required",
      ep(key),
      componentRows,
      `c.type!='projects' OR ${present(field("e.value", key))}`,
    ),
  ),
  issue(
    "required",
    ep("name"),
    componentRows,
    `c.type!='skills' OR ${present(field("e.value", "name"))}`,
  ),
  issue(
    "required",
    `json_array('components',c.idx,'data','categories',e.key,'name')`,
    `c,json_each(c.value,'$.data.categories') e`,
    `c.type!='skills' OR ${present(field("e.value", "name"))}`,
  ),
  ...["role", "organization", "startDate", "description"].map((key) =>
    issue(
      "required",
      ep(key),
      componentRows,
      `c.type!='work-experience' OR ${present(field("e.value", key))}`,
    ),
  ),
  issue(
    "required",
    ep("endDate"),
    componentRows,
    `c.type!='work-experience' OR ${field("e.value", "current")}=1 OR ${present(field("e.value", "endDate"))}`,
  ),
  issue(
    "required",
    cp("'title'"),
    "c",
    `c.type!='text' OR ${present(field("c.value", "data.title"))}`,
  ),
  issue(
    "required",
    cp("'body'"),
    "c",
    `c.type!='text' OR EXISTS(SELECT 1 FROM json_tree(c.value,'$.data.body') t WHERE t.key='text' AND ${present("t.atom")})`,
  ),
  issue(
    "required",
    ep("caseStudy"),
    componentRows,
    `c.type!='projects' OR json_type(e.value,'$.caseStudy') IS NULL OR EXISTS(SELECT 1 FROM json_tree(e.value,'$.caseStudy.body') t WHERE (t.key='text' AND ${present("t.atom")}) OR (t.key='type' AND t.atom='image'))`,
  ),
  // Frozen URLs come from the live manifest index, so they change atomically
  // with the publication pointer. A published slug stays with its project, and
  // another project cannot take it until the owning project's removal is live.
  issue(
    "case_study_url",
    `json_array('components',c.idx,'data','entries',e.key,'caseStudy','slug')`,
    componentRows,
    `c.type!='projects' OR json_type(e.value,'$.caseStudy') IS NULL OR NOT EXISTS(${liveCaseStudies} AND (
      (json_extract(k.value,'$.id')=json_extract(e.value,'$.id') AND json_extract(k.value,'$.slug')!=json_extract(e.value,'$.caseStudy.slug'))
      OR (json_extract(k.value,'$.slug')=json_extract(e.value,'$.caseStudy.slug') AND json_extract(k.value,'$.id') IS NOT NULL AND json_extract(k.value,'$.id')!=json_extract(e.value,'$.id'))))`,
  ),
  issue(
    "required",
    cp("'file'"),
    "c",
    `c.type!='resume' OR ${field("c.value", "data.file.assetId")} IS NOT NULL`,
  ),
  issue(
    "required",
    `json_array('links')`,
    "c,p",
    `c.type!='social-links' OR EXISTS(SELECT 1 FROM json_each(p.draft,'$.links') l WHERE ${field("l.value", "showInSocialComponent")}=1 AND ${present(field("l.value", "value"))} AND ${present(field("l.value", "label"))})`,
  ),
  issue(
    "recipient",
    cp("'recipientId'"),
    "c,p",
    `c.type!='contact' OR EXISTS(SELECT 1 FROM contact_recipient r WHERE r.portfolio_id=p.id AND r.verified_at IS NOT NULL AND ${field("c.value", "data.recipientId")}=r.portfolio_id)`,
  ),
];
// Scan each related collection once, emitting only failing rules. Building a
// small SQL JSON array avoids revisiting all component rows for every field.
const bySource = new Map<string, typeof rules>();
for (const rule of rules) {
  const group = bySource.get(rule.from) ?? [];
  group.push(rule);
  bySource.set(rule.from, group);
}
const ruleQueries = [...bySource].map(
  ([from, group]) =>
    `SELECT json_extract(f.value,'$.code') AS code,json_extract(f.value,'$.path') AS path FROM ${from},json_each(json_array(${group.map(({ code, target, condition }) => `CASE WHEN NOT coalesce((${condition}),0) THEN json_object('code','${code}','path',json(${target})) END`).join(",")})) f WHERE f.type='object'`,
);
const componentCoverage = {
  projects: true,
  skills: true,
  "work-experience": true,
  text: true,
  github: true,
  contact: true,
  "social-links": true,
  resume: true,
} satisfies Record<ComponentType, true>;
const includedTypes = Object.keys(componentCoverage)
  .map((type) => `'${type}'`)
  .join(",");
const assetQueries = [
  ...[
    {
      kind: "avatar",
      jsonPath: "$.profile.avatar.assetId",
      target: path("profile", "avatar", "assetId"),
    },
    {
      kind: "banner",
      jsonPath: "$.profile.banner.assetId",
      target: path("profile", "banner", "assetId"),
    },
    {
      kind: "face",
      jsonPath: "$.profile.faceReveal.image.assetId",
      target: path("profile", "faceReveal", "image", "assetId"),
    },
    {
      kind: "og",
      jsonPath: "$.seo.ogImage.assetId",
      target: path("seo", "ogImage", "assetId"),
    },
  ].map(
    ({ kind, jsonPath, target }) =>
      `SELECT json_extract(draft,'${jsonPath}') AS assetId,'${kind}' AS kind,${target} AS path FROM p WHERE json_extract(draft,'${jsonPath}') IS NOT NULL ${kind === "face" ? "AND json_extract(draft,'$.profile.faceReveal.enabled')=1" : ""}`,
  ),
  `SELECT ${field("c.value", "data.file.assetId")},'resume',${cp("'file'")} FROM c WHERE type='resume' AND ${field("c.value", "data.file.assetId")} IS NOT NULL`,
  `SELECT ${field("e.value", "image.assetId")},'project',${ep("image")} FROM ${componentRows} WHERE c.type='projects' AND ${field("e.value", "image.assetId")} IS NOT NULL`,
  `SELECT ${field("n.value", "attrs.assetId")},'case_study',json_array('components',c.idx,'data','entries',e.key,'caseStudy','body','content',n.key) FROM ${componentRows},json_each(e.value,'$.caseStudy.body.content') n WHERE c.type='projects' AND ${field("n.value", "type")}='image'`,
];
const assets = [assetQueries.slice(0, 4), assetQueries.slice(4)]
  .map((group) => `SELECT * FROM (${group.join(" UNION ALL ")})`)
  .join(" UNION ALL ");

// JSON stays inside SQLite. Only bounded paths, IDs and issue codes cross into
// the Worker. Structural generation 2 proves nonempty destinations are safe.
export function ownerPublication(
  db: D1Database,
  identity: SessionIdentity,
  assetReady: (id: string, purpose: AssetPurpose) => Promise<boolean>,
) {
  const drafts = ownerDrafts(db, identity);
  async function guard(command: PublicationCommand) {
    const meta = await drafts.metadata();
    if (meta.portfolioId !== command.portfolioId)
      throw new SaveError(409, "Portfolio changed", "owner_changed");
    if (meta.revision !== command.revision)
      throw new SaveError(409, "Draft changed", "revision_conflict");
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM portfolio WHERE id=? AND user_id=? AND draft_rev=? AND status!='deleting' AND ${setupValidDraft} AND ${setupNoAttempt} AND ${activeSaveSession}`,
      )
      .bind(
        command.portfolioId,
        identity.user.id,
        command.revision,
        Date.now(),
        ...saveSessionParams(identity),
      )
      .first();
    if (!row) {
      await drafts.saves("content").rejectSave(command.revision);
      throw new SaveError(409, "Draft unavailable", "save_rejected");
    }
  }
  return {
    async check(command: PublicationCommand): Promise<PublicationResult> {
      await guard(command);
      const cte = `WITH p AS (SELECT * FROM portfolio WHERE id=? AND user_id=? AND draft_rev=? AND status!='deleting' AND ${activeSaveSession}),
        c AS (SELECT j.key AS idx,j.value,json_extract(j.value,'$.type') AS type FROM p,json_each(p.draft,'$.components') j
          WHERE json_extract(j.value,'$.type') IN (${includedTypes}) AND coalesce(json_extract(p.draft,'$.samples.' || json_quote('components.' || json_extract(j.value,'$.id'))),0)!=1)`;
      const bind = () => [
        command.portfolioId,
        identity.user.id,
        command.revision,
        ...saveSessionParams(identity),
      ];
      const rows: { code: string; path: string }[] = [];
      // The real D1 runtime rejects the original large compound SELECT.
      // Keep each query small and stop only after proving issue truncation.
      for (let offset = 0; offset < ruleQueries.length; offset += 4) {
        const group = ruleQueries.slice(offset, offset + 4);
        const result = await db
          .prepare(
            `${cte} SELECT * FROM (${group.join(" UNION ALL ")}) LIMIT ${PUBLICATION_ISSUE_LIMIT + 1 - rows.length}`,
          )
          .bind(...bind())
          .all<{ code: string; path: string }>();
        rows.push(...result.results);
        if (rows.length > PUBLICATION_ISSUE_LIMIT) break;
      }
      const issues = rows
        .slice(0, PUBLICATION_ISSUE_LIMIT)
        .map((row) =>
          publicationIssueSchema.parse({ ...row, path: JSON.parse(row.path) }),
        );
      const references = await db
        .prepare(
          `${cte} SELECT refs.*, EXISTS(SELECT 1 FROM asset a,p WHERE a.id=refs.assetId AND a.portfolio_id=p.id AND a.kind=refs.kind AND a.status='ready' AND a.bytes>0 AND ((refs.kind='resume' AND a.content_type='application/pdf' AND a.bytes<=10485760) OR (refs.kind!='resume' AND a.content_type IN ('image/jpeg','image/png','image/webp') AND a.bytes<=5242880))) AS metadataReady FROM (${assets}) refs ORDER BY refs.path, refs.kind, refs.assetId LIMIT ${PUBLICATION_ASSET_PAGE + 1} OFFSET ?`,
        )
        .bind(...bind(), command.assetOffset)
        .all<{
          assetId: string;
          kind: AssetPurpose;
          path: string;
          metadataReady: number;
        }>();
      for (const ref of references.results.slice(0, PUBLICATION_ASSET_PAGE)) {
        if (!ref.metadataReady || !(await assetReady(ref.assetId, ref.kind)))
          issues.push(
            publicationIssueSchema.parse({
              code: "asset",
              path: JSON.parse(ref.path),
            }),
          );
      }
      // GitHub's provider/setup implementation arrives later. The persisted
      // consent and generation resolver below is the current authoritative contract.
      const graphs = await db
        .prepare(
          `${cte} SELECT idx,json_extract(value,'$.data.username') AS username,json_extract(value,'$.data.includePrivate') AS private FROM c WHERE type='github'`,
        )
        .bind(...bind())
        .all<{ idx: number; username: string; private: number }>();
      if (graphs.results.length) {
        const { githubJobs } = await import("./github");
        const { parseCalendar } = await import("@hasaweb/github");
        const graph = await githubJobs(db).servingState(command.portfolioId);
        for (const config of graphs.results) {
          let valid =
            !!graph &&
            graph.identity.login.toLowerCase() ===
              config.username.toLowerCase() &&
            graph.activity?.generation === graph.generation;
          if (config.private && !graph?.privateAuthorized) valid = false;
          try {
            parseCalendar(
              config.private
                ? graph?.activity?.authorizedCalendar
                : graph?.activity?.publicCalendar,
            );
          } catch {
            valid = false;
          }
          if (!valid)
            issues.push({
              code: "github",
              path: ["components", config.idx, "data", "username"],
            });
        }
      }
      await guard(command);
      return {
        portfolioId: command.portfolioId,
        revision: command.revision,
        issues,
        hasMoreIssues: rows.length > PUBLICATION_ISSUE_LIMIT,
        nextAssetOffset:
          references.results.length > PUBLICATION_ASSET_PAGE
            ? command.assetOffset + PUBLICATION_ASSET_PAGE
            : null,
      };
    },
  };
}
