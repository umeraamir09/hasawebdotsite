import {
  appearanceSchema,
  createEmptyDraft,
  type DraftDoc,
  draftSchema,
  initialSetupProgress,
  readDraft,
  setupProgressSchema,
} from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { type AnyColumn, and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { boundedSaves, SaveError } from "./bounded-save";
import { ownerGithub } from "./github";
import * as tables from "./schema";

export type SessionIdentity = { user: { id: string }; session: { id: string } };
export class OwnerAccessError extends Error {
  constructor() {
    super("An active owner session is required");
  }
}

// Identity must come from the authentication library, never a request body/header ID.
// Recheck the persisted session even when Better Auth returns a cached identity.
export async function ownerRepositories(
  binding: D1Database,
  identity: SessionIdentity,
) {
  identity = {
    user: { id: identity.user.id },
    session: { id: identity.session.id },
  };
  const db = drizzle(binding);
  const activeSession = () => sql`exists (
    select 1 from ${tables.session} inner join ${tables.user}
      on ${tables.user.id} = ${tables.session.userId}
    where ${tables.session.id} = ${identity.session.id}
      and ${tables.session.userId} = ${identity.user.id}
      and ${tables.session.expiresAt} > ${Date.now()}
      and ${tables.user.deletingAt} is null
  )`;
  const activeOwner = () =>
    and(eq(tables.portfolio.userId, identity.user.id), activeSession());
  const ownedIds = () =>
    db
      .select({ id: tables.portfolio.id })
      .from(tables.portfolio)
      .where(activeOwner());
  const owned = (column: AnyColumn) => inArray(column, ownedIds());
  const ownPortfolioId = () => sql<string>`(${ownedIds()})`;
  const authorized = await db
    .select({ id: tables.user.id })
    .from(tables.user)
    .where(and(eq(tables.user.id, identity.user.id), activeSession()))
    .get();
  if (!authorized) throw new OwnerAccessError();
  const setupSaves = boundedSaves(binding, identity, {
    context: "setup",
    table: "portfolio",
    owner: "user_id",
    revision: "draft_rev",
    draft: "draft",
    progress: "setup_progress",
    setupMilestone: "first_editor_entered_at",
    validationVersion: "draft_validation_version",
    updatedAt: "updated_at",
  });
  const getPortfolio = async (id?: string) => {
    const row = await db
      .select()
      .from(tables.portfolio)
      .where(
        and(
          activeOwner(),
          id === undefined ? undefined : eq(tables.portfolio.id, id),
        ),
      )
      .get();
    return row ? { ...row, draft: readDraft(row.draft) } : undefined;
  };
  const portfolioSummary = () =>
    db
      .select({ id: tables.portfolio.id })
      .from(tables.portfolio)
      .where(activeOwner())
      .get();

  return {
    portfolio: {
      get: getPortfolio,
      summary: portfolioSummary,
      async provision() {
        // portfolio-v1 is the application's single fixed template. There is no
        // owner-selected layout field. Never copy account/provider identity here.
        const draft = createEmptyDraft(
          appearanceSchema.parse(appearanceCatalog.defaults.appearance),
        );
        const now = Date.now();
        await db.run(sql`
          insert into ${tables.portfolio}
            (id, user_id, draft, draft_validation_version, setup_progress, created_at, updated_at)
          select ${crypto.randomUUID()}, ${identity.user.id}, ${JSON.stringify(draft)},
            2, ${JSON.stringify(initialSetupProgress())}, ${now}, ${now}
          where ${activeSession()}
          on conflict(user_id) do nothing
        `);
        // Avoid reading, parsing or migrating existing content on this hot path.
        // A concurrent initializer returns the winning row. Revocation fails closed.
        const portfolio = await portfolioSummary();
        if (!portfolio) throw new OwnerAccessError();
        return portfolio;
      },
      async create(id: string, draft: DraftDoc) {
        const parsed = draftSchema.parse(draft);
        const now = new Date();
        await db
          .insert(tables.portfolio)
          .values({
            id,
            userId: identity.user.id,
            draft: parsed,
            draftValidationVersion: 2,
            createdAt: now,
            updatedAt: now,
            // A NULL expression makes a revoked-session insert fail the NOT NULL constraint.
            status: sql`case when ${activeSession()} then 'draft' else null end`,
          })
          .onConflictDoNothing();
        return getPortfolio();
      },
    },
    setup: {
      // Reference validator for offline migration/maintenance, not a hot HTTP
      // save path. Phase 13 must supply bounded validation/correction before
      // enabling legacy rows whose destinations predate the approved limits.
      async validateLegacyDraft() {
        const row = await getPortfolio(); // readDraft validates the full content.
        if (!row) throw new SaveError(409, "Unavailable draft");
        const result = await db
          .update(tables.portfolio)
          .set({ draftValidationVersion: 2 })
          .where(
            and(activeOwner(), eq(tables.portfolio.draftRev, row.draftRev)),
          )
          .returning({ revision: tables.portfolio.draftRev })
          .get();
        if (!result)
          throw new SaveError(409, "Draft changed during validation");
        return result;
      },
      // This state is private. A step is navigation, not a permission grant.
      get: () =>
        db
          .select({
            progress: tables.portfolio.setupProgress,
            revision: tables.portfolio.draftRev,
            firstEditorEnteredAt: tables.portfolio.firstEditorEnteredAt,
          })
          .from(tables.portfolio)
          .where(activeOwner())
          .get(),
      saves: setupSaves,
      saveProgress: (revision: number, progress: unknown) =>
        setupSaves.saveProgress(revision, setupProgressSchema.parse(progress)),
      // Internal persistence operation ONLY. The authoritative handoff service
      // must validate saved required content and ready owned assets at this
      // exact revision before calling it. Never map a client milestone flag here.
      async recordFirstEditorEntry(revision: number) {
        if (
          !Number.isSafeInteger(revision) ||
          revision < 0 ||
          revision >= Number.MAX_SAFE_INTEGER
        )
          throw new SaveError(422, "Invalid revision");
        const enteredAt = new Date();
        await db
          .update(tables.portfolio)
          .set({
            firstEditorEnteredAt: enteredAt,
            draftRev: sql`${tables.portfolio.draftRev} + 1`,
            updatedAt: enteredAt,
          })
          .where(
            and(
              activeOwner(),
              eq(tables.portfolio.draftRev, revision),
              eq(tables.portfolio.draftValidationVersion, 2),
              sql`${tables.portfolio.firstEditorEnteredAt} is null`,
            ),
          )
          .run();
        const result = await db
          .select({
            firstEditorEnteredAt: tables.portfolio.firstEditorEnteredAt,
            revision: tables.portfolio.draftRev,
          })
          .from(tables.portfolio)
          .where(activeOwner())
          .get();
        if (!result?.firstEditorEnteredAt)
          throw new SaveError(409, "Stale revision or unavailable handoff");
        return result;
      },
    },
    assets: {
      list: () =>
        db
          .select()
          .from(tables.asset)
          .where(owned(tables.asset.portfolioId))
          .all(),
      get: (id: string) =>
        db
          .select()
          .from(tables.asset)
          .where(and(eq(tables.asset.id, id), owned(tables.asset.portfolioId)))
          .get(),
      create: (
        input: Pick<
          typeof tables.asset.$inferInsert,
          "id" | "kind" | "contentType" | "bytes" | "width" | "height"
        >,
      ) =>
        db
          .insert(tables.asset)
          .values({
            id: input.id,
            kind: input.kind,
            contentType: input.contentType,
            bytes: input.bytes,
            width: input.width ?? null,
            height: input.height ?? null,
            portfolioId: ownPortfolioId(),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning()
          .get(),
      setStatus: (
        id: string,
        status: typeof tables.asset.$inferInsert.status,
      ) =>
        db
          .update(tables.asset)
          .set({ status: status ?? "pending", updatedAt: new Date() })
          .where(and(eq(tables.asset.id, id), owned(tables.asset.portfolioId)))
          .returning()
          .get(),
      remove: (id: string) =>
        db
          .delete(tables.asset)
          .where(and(eq(tables.asset.id, id), owned(tables.asset.portfolioId)))
          .returning({ id: tables.asset.id })
          .get(),
    },
    versions: {
      list: () =>
        db
          .select()
          .from(tables.publishVersion)
          .where(owned(tables.publishVersion.portfolioId))
          .all(),
      get: (id: string) =>
        db
          .select()
          .from(tables.publishVersion)
          .where(
            and(
              eq(tables.publishVersion.id, id),
              owned(tables.publishVersion.portfolioId),
            ),
          )
          .get(),
      create: (input: { id: string; n: number; rendererVersion: string }) =>
        db
          .insert(tables.publishVersion)
          .values({
            id: input.id,
            n: input.n,
            rendererVersion: input.rendererVersion,
            portfolioId: ownPortfolioId(),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning()
          .get(),
      fail: (id: string, error: string) =>
        db
          .update(tables.publishVersion)
          .set({ status: "failed", error, updatedAt: new Date() })
          .where(
            and(
              eq(tables.publishVersion.id, id),
              eq(tables.publishVersion.status, "rendering"),
              owned(tables.publishVersion.portfolioId),
            ),
          )
          .returning()
          .get(),
    },
    claims: {
      get: (name: string) =>
        db
          .select()
          .from(tables.subdomainClaim)
          .where(
            and(
              eq(tables.subdomainClaim.name, name),
              owned(tables.subdomainClaim.portfolioId),
            ),
          )
          .get(),
      current: () =>
        db
          .select()
          .from(tables.subdomainClaim)
          .where(owned(tables.subdomainClaim.portfolioId))
          .get(),
    },
    github: ownerGithub(binding, identity),
    recipient: {
      get: () =>
        db
          .select()
          .from(tables.contactRecipient)
          .where(owned(tables.contactRecipient.portfolioId))
          .get(),
      save(
        input: Omit<typeof tables.contactRecipient.$inferInsert, "portfolioId">,
      ) {
        const fields = {
          email: input.email,
          verifiedAt: input.verifiedAt ?? null,
          pendingTokenHash: input.pendingTokenHash ?? null,
          tokenExpiresAt: input.tokenExpiresAt ?? null,
        };
        return db
          .insert(tables.contactRecipient)
          .values({ ...fields, portfolioId: ownPortfolioId() })
          .onConflictDoUpdate({
            target: tables.contactRecipient.portfolioId,
            set: fields,
            setWhere: owned(tables.contactRecipient.portfolioId),
          })
          .returning()
          .get();
      },
    },
    outbox: {
      list: () =>
        db
          .select({
            id: tables.contactOutbox.id,
            status: tables.contactOutbox.status,
            attempts: tables.contactOutbox.attempts,
            lastError: tables.contactOutbox.lastError,
            isTest: tables.contactOutbox.isTest,
            acceptedAt: tables.contactOutbox.acceptedAt,
          })
          .from(tables.contactOutbox)
          .where(owned(tables.contactOutbox.portfolioId))
          .all(),
      get: (id: string) =>
        db
          .select()
          .from(tables.contactOutbox)
          .where(
            and(
              eq(tables.contactOutbox.id, id),
              owned(tables.contactOutbox.portfolioId),
            ),
          )
          .get(),
      // Internal persistence only. The contact service must atomically reserve budgets before acceptance.
      create: (
        input: Pick<
          typeof tables.contactOutbox.$inferInsert,
          | "id"
          | "payload"
          | "isTest"
          | "acceptedAt"
          | "deadlineAt"
          | "budgetWindowStart"
        >,
      ) =>
        db
          .insert(tables.contactOutbox)
          .values({
            id: input.id,
            payload: input.payload ?? null,
            isTest: input.isTest ?? false,
            acceptedAt: input.acceptedAt,
            deadlineAt: input.deadlineAt,
            budgetWindowStart: input.budgetWindowStart,
            nextAttemptAt: input.acceptedAt,
            portfolioId: ownPortfolioId(),
          })
          .onConflictDoNothing()
          .returning()
          .get(),
      finalize: (
        id: string,
        status: "sent" | "failed",
        error: string | null = null,
      ) =>
        db
          .update(tables.contactOutbox)
          .set({ status, payload: null, lastError: error })
          .where(
            and(
              eq(tables.contactOutbox.id, id),
              inArray(tables.contactOutbox.status, ["queued", "sending"]),
              owned(tables.contactOutbox.portfolioId),
            ),
          )
          .returning()
          .get(),
    },
    counters: {
      // An encoded namespace prevents owners from reading or changing shared budget keys.
      get: (key: string, windowStart: number) =>
        db
          .select()
          .from(tables.counter)
          .where(
            and(
              eq(
                tables.counter.key,
                JSON.stringify(["owner", identity.user.id, key]),
              ),
              eq(tables.counter.windowStart, windowStart),
              activeSession(),
            ),
          )
          .get(),
      increment: (key: string, windowStart: number) =>
        db
          .insert(tables.counter)
          .values({
            key: JSON.stringify(["owner", identity.user.id, key]),
            windowStart,
            userId: identity.user.id,
            count: sql`case when ${activeSession()} then 1 else null end`,
          })
          .onConflictDoUpdate({
            target: [tables.counter.key, tables.counter.windowStart],
            set: { count: sql`${tables.counter.count} + 1` },
            setWhere: activeSession(),
          })
          .returning()
          .get(),
    },
    providers: {
      list: () =>
        db
          .select({
            id: tables.account.id,
            providerId: tables.account.providerId,
            accountId: tables.account.accountId,
          })
          .from(tables.account)
          .where(
            and(eq(tables.account.userId, identity.user.id), activeSession()),
          )
          .all(),
    },
  };
}
export type OwnerRepositories = Awaited<ReturnType<typeof ownerRepositories>>;
