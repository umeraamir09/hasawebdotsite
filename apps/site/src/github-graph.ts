import { githubJobs } from "@hasaweb/db/github";
import {
  type PublishedGraph,
  parseIdentity,
  projectPublishedActivity,
} from "@hasaweb/github";

// Live GitHub activity for a published portfolio. The graph configuration is
// the immutable one frozen into the active published version when it was
// sealed. The draft, the query string and the visitor choose nothing. Counts
// are never part of a snapshot, so a refresh or a withdrawal changes this
// response without a Publish.

const headers = () =>
  new Headers({
    "Content-Type": "application/json; charset=utf-8",
    // Withdrawable data. Phase 25's no-store policy applies until S-9.
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  });

type ActiveGraph = { portfolio_id: string; graph: string | null };

/** The frozen graph configuration of the active version, or null. */
export async function publishedGraph(
  db: D1Database,
  name: string,
): Promise<{ portfolioId: string; graph: PublishedGraph } | null> {
  const row = await db
    .prepare(
      `SELECT p.id AS portfolio_id, json_extract(x.value,'$.graph') AS graph
       FROM portfolio p
       JOIN subdomain_claim claim ON claim.portfolio_id=p.id AND claim.name=? AND claim.state='claimed'
       JOIN publish_version current ON current.portfolio_id=p.id AND current.n=p.published_version AND current.status='live'
       JOIN publication_candidate c ON c.id=current.candidate_id AND c.status='ready'
       JOIN publication_candidate_index x ON x.candidate_id=c.id
       WHERE p.status='published' AND p.subdomain=claim.name
         AND NOT EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=claim.name)`,
    )
    .bind(name)
    .first<ActiveGraph>();
  if (!row?.graph) return null;
  try {
    const value = JSON.parse(row.graph) as Record<string, unknown>;
    // A missing identity must never be coerced into the text "undefined".
    if (typeof value.id !== "string" || typeof value.login !== "string")
      return null;
    const identity = parseIdentity({ id: value.id, login: value.login });
    return {
      portfolioId: row.portfolio_id,
      graph: { ...identity, includePrivate: value.includePrivate === 1 },
    };
  } catch {
    return null;
  }
}

export async function serveGitHubGraph(
  request: Request,
  db: D1Database,
  name: string,
) {
  const active = await publishedGraph(db, name);
  // No graph in the active version: the page has nothing to ask for.
  if (!active) return new Response(null, { status: 404, headers: headers() });
  const state = await githubJobs(db).servingState(active.portfolioId);
  // The allowlisted projection: username, profile link, dates and counts only.
  const body = projectPublishedActivity(active.graph, state);
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    headers: headers(),
  });
}
