import type { DraftDoc } from "@hasaweb/schema";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = () => ({
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  deletingAt: integer("deleting_at", { mode: "timestamp_ms" }),
  ...timestamps(),
});
export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);
export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (t) => [
    index("account_user_idx").on(t.userId),
    uniqueIndex("account_provider_identity").on(t.providerId, t.accountId),
  ],
);
export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const portfolio = sqliteTable(
  "portfolio",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    subdomain: text("subdomain").unique(),
    status: text("status", {
      enum: ["draft", "published", "unpublished", "suspended", "deleting"],
    })
      .notNull()
      .default("draft"),
    publishedVersion: integer("published_version"),
    draft: text("draft", { mode: "json" }).$type<DraftDoc>().notNull(),
    draftRev: integer("draft_rev").notNull().default(0),
    suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
    suspendedReason: text("suspended_reason"),
    ...timestamps(),
  },
  (t) => [
    check(
      "portfolio_status",
      sql`${t.status} in ('draft','published','unpublished','suspended','deleting')`,
    ),
    check(
      "draft_json",
      sql`json_valid(${t.draft}) and json_type(${t.draft}) = 'object'`,
    ),
    check("draft_bytes", sql`length(cast(${t.draft} as blob)) <= 1048576`),
    check("draft_revision", sql`${t.draftRev} >= 0`),
  ],
);
const portfolioId = () =>
  text("portfolio_id")
    .notNull()
    .references(() => portfolio.id, { onDelete: "cascade" });
export const asset = sqliteTable(
  "asset",
  {
    id: text("id").primaryKey(),
    portfolioId: portfolioId(),
    kind: text("kind", {
      enum: [
        "avatar",
        "banner",
        "face",
        "project",
        "case_study",
        "resume",
        "og",
      ],
    }).notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    status: text("status", { enum: ["pending", "ready", "failed"] })
      .notNull()
      .default("pending"),
    ...timestamps(),
  },
  (t) => [
    index("asset_portfolio_idx").on(t.portfolioId),
    check(
      "asset_kind",
      sql`${t.kind} in ('avatar','banner','face','project','case_study','resume','og')`,
    ),
    check("asset_status", sql`${t.status} in ('pending','ready','failed')`),
    check(
      "asset_dimensions",
      sql`${t.bytes} >= 0 and (${t.width} is null or ${t.width} > 0) and (${t.height} is null or ${t.height} > 0)`,
    ),
  ],
);
export const publishVersion = sqliteTable(
  "publish_version",
  {
    id: text("id").primaryKey(),
    portfolioId: portfolioId(),
    n: integer("n").notNull(),
    status: text("status", {
      enum: ["rendering", "live", "failed", "superseded"],
    })
      .notNull()
      .default("rendering"),
    rendererVersion: text("renderer_version").notNull(),
    manifest: text("manifest", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("publish_portfolio_number").on(t.portfolioId, t.n),
    check("publish_number", sql`${t.n} > 0`),
    check(
      "publish_status",
      sql`${t.status} in ('rendering','live','failed','superseded')`,
    ),
    check(
      "manifest_json",
      sql`${t.manifest} is null or json_valid(${t.manifest})`,
    ),
  ],
);
export const reservedSubdomain = sqliteTable("reserved_subdomain", {
  name: text("name").primaryKey(),
});
export const subdomainClaim = sqliteTable("subdomain_claim", {
  name: text("name").primaryKey(),
  portfolioId: text("portfolio_id")
    .unique()
    .references(() => portfolio.id, { onDelete: "set null" }),
});
export const githubConnection = sqliteTable(
  "github_connection",
  {
    portfolioId: portfolioId().primaryKey(),
    login: text("login").notNull(),
    githubUserId: text("github_user_id").notNull(),
    tokenEnc: text("token_enc"),
    scopes: text("scopes").notNull().default(""),
    privateEnabled: integer("private_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", {
      enum: ["ok", "needs_reconnect", "disconnected"],
    }).notNull(),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check(
      "github_status",
      sql`${t.status} in ('ok','needs_reconnect','disconnected')`,
    ),
  ],
);
export const githubActivity = sqliteTable(
  "github_activity",
  {
    portfolioId: portfolioId().primaryKey(),
    publicDays: text("public_days", { mode: "json" })
      .$type<unknown[]>()
      .notNull(),
    privateCounts: text("private_counts", { mode: "json" }).$type<unknown[]>(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    refreshRequestedAt: integer("refresh_requested_at", {
      mode: "timestamp_ms",
    }),
  },
  (t) => [
    check(
      "github_activity_json",
      sql`json_valid(${t.publicDays}) and (${t.privateCounts} is null or json_valid(${t.privateCounts}))`,
    ),
  ],
);
export const contactRecipient = sqliteTable("contact_recipient", {
  portfolioId: portfolioId().primaryKey(),
  email: text("email").notNull(),
  verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
  pendingTokenHash: text("pending_token_hash"),
  tokenExpiresAt: integer("token_expires_at", { mode: "timestamp_ms" }),
});
export const contactOutbox = sqliteTable(
  "contact_outbox",
  {
    id: text("id").primaryKey(),
    portfolioId: portfolioId(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", { enum: ["queued", "sending", "sent", "failed"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", {
      mode: "timestamp_ms",
    }).notNull(),
    lastError: text("last_error"),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }).notNull(),
    deadlineAt: integer("deadline_at", { mode: "timestamp_ms" }).notNull(),
    budgetWindowStart: integer("budget_window_start").notNull(),
  },
  (t) => [
    index("outbox_portfolio_idx").on(t.portfolioId),
    index("outbox_due_idx").on(t.status, t.nextAttemptAt),
    check(
      "outbox_status",
      sql`${t.status} in ('queued','sending','sent','failed')`,
    ),
    check("outbox_attempts", sql`${t.attempts} between 0 and 5`),
    check("outbox_deadline", sql`${t.deadlineAt} >= ${t.acceptedAt}`),
    check(
      "outbox_payload",
      sql`(${t.payload} is null or json_valid(${t.payload})) and (${t.status} not in ('sent','failed') or ${t.payload} is null)`,
    ),
  ],
);
export const counter = sqliteTable(
  "counter",
  {
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    check("counter_count", sql`${t.count} >= 0`),
  ],
);
export const operatorEmailAudit = sqliteTable(
  "operator_email_audit",
  {
    id: text("id").primaryKey(),
    operatorId: text("operator_id").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    caseReference: text("case_reference").notNull(),
    accessedAt: integer("accessed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("audit_account_idx").on(t.accountId),
    index("audit_retention_idx").on(t.accessedAt),
  ],
);

export const schema = {
  user,
  session,
  account,
  verification,
  portfolio,
  asset,
  publishVersion,
  reservedSubdomain,
  subdomainClaim,
  githubConnection,
  githubActivity,
  contactRecipient,
  contactOutbox,
  counter,
  operatorEmailAudit,
};
