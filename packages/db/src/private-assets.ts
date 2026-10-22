import type { AssetPurpose } from "@hasaweb/schema";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SessionIdentity } from "./repositories";
import { asset, portfolio, session, user } from "./schema";

export type PrivateAsset = typeof asset.$inferSelect;

// Only a library-verified identity may construct this repository.
export function privateAssets(binding: D1Database, identity: SessionIdentity) {
  const db = drizzle(binding);
  const ownerId = identity.user.id;
  const sessionId = identity.session.id;
  const active = () => sql`exists (
    select 1 from ${session} inner join ${user} on ${user.id}=${session.userId}
    where ${session.id}=${sessionId} and ${session.userId}=${ownerId}
    and ${session.expiresAt}>${Date.now()} and ${user.deletingAt} is null
  )`;
  const ownedPortfolio = () =>
    db
      .select({ id: portfolio.id })
      .from(portfolio)
      .where(
        and(
          eq(portfolio.userId, ownerId),
          sql`${portfolio.status} != 'deleting'`,
          active(),
        ),
      );
  const owned = () => sql`${asset.portfolioId} in (${ownedPortfolio()})`;
  return {
    async createPending(
      input: Pick<PrivateAsset, "id" | "kind" | "contentType" | "bytes">,
    ) {
      const rows = await db
        .insert(asset)
        .values({
          ...input,
          portfolioId: sql`(${ownedPortfolio()})`,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      return rows[0];
    },
    async ready(id: string, purpose?: AssetPurpose) {
      return db
        .select()
        .from(asset)
        .where(
          and(
            eq(asset.id, id),
            eq(asset.status, "ready"),
            owned(),
            ...(purpose ? [eq(asset.kind, purpose)] : []),
          ),
        )
        .get();
    },
    async finalize(id: string, bytes: number) {
      return db
        .update(asset)
        .set({ status: "ready", bytes, updatedAt: new Date() })
        .where(and(eq(asset.id, id), eq(asset.status, "pending"), owned()))
        .returning()
        .get();
    },
  };
}

// Server-generated immutable IDs and their portfolio are cleanup capabilities.
// This transition also resolves an uncertain finalization before R2 deletion.
export async function failPrivateAsset(binding: D1Database, row: PrivateAsset) {
  const db = drizzle(binding);
  await db
    .update(asset)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(asset.id, row.id),
        eq(asset.portfolioId, row.portfolioId),
        eq(asset.status, "pending"),
      ),
    );
  return db
    .select({ status: asset.status })
    .from(asset)
    .where(and(eq(asset.id, row.id), eq(asset.portfolioId, row.portfolioId)))
    .get();
}
