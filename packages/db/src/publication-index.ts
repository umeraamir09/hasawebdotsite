import type { Candidate } from "./publication-tasks";

// Index only typed reference/page collections. Dense text bodies never enter a
// json_tree scan. This is one row per candidate, not one row per component.
export async function preparePublicationIndex(db: D1Database, row: Candidate) {
  await db
    .prepare(`WITH p AS MATERIALIZED (SELECT id,source FROM publication_candidate WHERE id=? AND lease_token=? AND lease_until>? AND status='preparing'),
    c AS MATERIALIZED (SELECT j.key AS idx,j.value,json_extract(j.value,'$.type') AS kind FROM p,json_each(p.source,'$.components') j WHERE json_extract(j.value,'$.type') IN ('projects','resume')),
    projects AS MATERIALIZED (SELECT c.idx,e.key AS entry,e.value FROM c,json_each(c.value,'$.data.entries') e WHERE c.kind='projects'),
    cases AS MATERIALIZED (SELECT '$.components['||idx||'].data.entries['||entry||']' AS path,json_extract(value,'$.caseStudy.slug') AS slug FROM projects WHERE json_type(value,'$.caseStudy')='object' ORDER BY idx,entry),
    refs AS (SELECT * FROM (
      SELECT json_extract(source,'$.profile.avatar.assetId') AS id,'avatar' AS purpose FROM p
      UNION ALL SELECT json_extract(source,'$.profile.banner.assetId'),'banner' FROM p
      UNION ALL SELECT json_extract(source,'$.profile.faceReveal.image.assetId'),'face' FROM p
      UNION ALL SELECT json_extract(source,'$.seo.ogImage.assetId'),'og' FROM p
      ) UNION ALL SELECT * FROM (SELECT json_extract(value,'$.data.file.assetId'),'resume' FROM c WHERE kind='resume'
      UNION ALL SELECT json_extract(value,'$.image.assetId'),'project' FROM projects
      UNION ALL SELECT json_extract(n.value,'$.attrs.assetId'),'case_study' FROM projects,json_each(projects.value,'$.caseStudy.body.content') n WHERE json_extract(n.value,'$.type')='image'
    )) INSERT INTO publication_candidate_index(candidate_id,value)
    SELECT p.id,json_object(
      'assets',json((SELECT json_group_array(json_object('id',id,'purpose',purpose)) FROM (SELECT DISTINCT id,purpose FROM refs WHERE id IS NOT NULL ORDER BY id,purpose))),
      'cases',json((SELECT json_group_array(json_object('path',path,'slug',slug)) FROM cases)),
      'resume',json((SELECT json_object('path','$.components['||idx||']','ordinal',(SELECT count(*)+1 FROM cases)) FROM c WHERE kind='resume' ORDER BY idx LIMIT 1)))
    FROM p WHERE true ON CONFLICT DO NOTHING`)
    .bind(row.id, row.lease_token, Date.now())
    .run();
}

// A future draft collector must use this guard in addition to draft/live-version
// reachability. Before indexing, retain the portfolio's assets conservatively.
export async function publicationRetainsAsset(
  db: D1Database,
  portfolioId: string,
  assetId: string,
) {
  return !!(await db
    .prepare(`SELECT 1 AS retained FROM publication_candidate c
    WHERE c.portfolio_id=? AND (c.source IS NOT NULL OR EXISTS(SELECT 1 FROM publish_version v WHERE v.candidate_id=c.id)) AND (
      NOT EXISTS(SELECT 1 FROM publication_candidate_index x WHERE x.candidate_id=c.id)
      OR EXISTS(SELECT 1 FROM publication_candidate_index x,json_each(x.value,'$.assets') r
        WHERE x.candidate_id=c.id AND json_extract(r.value,'$.id')=?)) LIMIT 1`)
    .bind(portfolioId, assetId)
    .first());
}
