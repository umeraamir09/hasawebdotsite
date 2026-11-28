import type { Calendar } from "@hasaweb/github";
import type { DraftDoc, SetupProgress } from "@hasaweb/schema";
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
// A sign-in provider the owner disconnected (Phase 47). While a row exists,
// signing in with that provider never links it again by matching email; only
// an explicit Connect from settings does, and it removes the row.
export const disconnectedProvider = sqliteTable(
  "disconnected_provider",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.providerId] })],
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
    // Legacy envelopes predate the approved bounded URL/email rules. Version
    // alone is not proof that incremental validation is safe for their content.
    draftValidationVersion: integer("draft_validation_version")
      .notNull()
      .default(0),
    setupProgress: text("setup_progress", { mode: "json" })
      .$type<SetupProgress>()
      .notNull()
      .default({ schemaVersion: 1, step: "address" }),
    firstEditorEnteredAt: integer("first_editor_entered_at", {
      mode: "timestamp_ms",
    }),
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
    check("setup_progress_json", sql`json_valid(${t.setupProgress})`),
    check(
      "first_editor_entry",
      sql`${t.firstEditorEnteredAt} is null or ${t.firstEditorEnteredAt} > 0`,
    ),
  ],
);
// Private bounded-save preparation, shared with setup and later editor saving.
export const ownerSaveAttempt = sqliteTable(
  "owner_save_attempt",
  {
    id: text("id").primaryKey(),
    context: text("context", { enum: ["setup", "content", "validation"] })
      .notNull()
      .default("setup"),
    validationCursor: text("validation_cursor"),
    validationComplete: integer("validation_complete").notNull().default(0),
    validationIssue: text("validation_issue"),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    baseRevision: integer("base_revision").notNull(),
    sequence: integer("sequence").notNull().default(0),
    lastHash: text("last_hash"),
    state: text("state").notNull().default("open"),
    draft: text("draft"),
    progress: text("progress").notNull(),
    expiresAt: integer("expires_at").notNull(),
    stringPath: text("string_path"),
    stringMinimum: integer("string_minimum"),
    pieceCount: integer("piece_count").notNull().default(0),
    stringChars: integer("string_chars").notNull().default(0),
    stringBytes: integer("string_bytes").notNull().default(0),
    lastCodeUnit: integer("last_code_unit"),
  },
  (t) => [
    index("save_attempt_expiry").on(t.expiresAt),
    check(
      "save_attempt_state",
      sql`${t.state} in ('open','string','committed','aborted')`,
    ),
    check(
      "save_attempt_draft",
      sql`${t.draft} is null or (json_valid(${t.draft}) and length(cast(${t.draft} as blob)) <= 1048576)`,
    ),
    check("save_attempt_progress", sql`json_valid(${t.progress})`),
  ],
);
export const ownerSavePiece = sqliteTable(
  "owner_save_piece",
  {
    attemptId: text("attempt_id")
      .notNull()
      .references(() => ownerSaveAttempt.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    data: text("data").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.n] }),
    check(
      "save_piece_data",
      sql`json_valid(${t.data}) and json_type(${t.data}) = 'text' and length(cast(${t.data} as blob)) <= 4096`,
    ),
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
    // Phase 51 upload collection scans by state and age.
    index("asset_collection_idx").on(t.status, t.updatedAt),
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
    candidateId: text("candidate_id").references(
      () => publicationCandidate.id,
      { onDelete: "restrict" },
    ),
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
    uniqueIndex("publish_candidate_idx").on(t.candidateId),
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
  state: text("state", { enum: ["held", "claimed"] })
    .notNull()
    .default("claimed"),
  heldAt: integer("held_at"),
  claimedAt: integer("claimed_at"),
  name: text("name").primaryKey(),
  portfolioId: text("portfolio_id")
    .unique()
    .references(() => portfolio.id, { onDelete: "set null" }),
});
export const addressConfirmation = sqliteTable(
  "address_confirmation",
  {
    id: text("id").primaryKey(),
    portfolioId: text("portfolio_id")
      .notNull()
      .references(() => portfolio.id, { onDelete: "cascade" }),
    payloadHash: text("payload_hash").notNull(),
    name: text("name").notNull(),
    state: text("state", { enum: ["held", "claimed"] }).notNull(),
    revision: integer("revision").notNull(),
    createdAt: integer("created_at").notNull(),
    applied: integer("applied").notNull(),
  },
  (t) => [check("address_confirmation_applied", sql`${t.applied} = 1`)],
);
export const githubConnection = sqliteTable(
  "github_connection",
  {
    portfolioId: portfolioId().primaryKey(),
    login: text("login").notNull(),
    githubUserId: text("github_user_id").notNull(),
    generation: integer("generation").notNull().default(0),
    appId: text("app_id"),
    grantOperation: text("grant_operation"),
    tokenBinding: text("token_binding"),
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
    generation: integer("generation").notNull().default(0),
    publicCalendar: text("public_calendar", { mode: "json" }).$type<Calendar>(),
    authorizedCalendar: text("authorized_calendar", {
      mode: "json",
    }).$type<Calendar>(),
    publicError: text("public_error"),
    authorizedError: text("authorized_error"),
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
// Global app/account coordination intentionally outlives portfolio deletion.
// Cleanup credentials are never returned by owner reads or refresh acquisition.
export const githubGrant = sqliteTable(
  "github_grant",
  {
    appId: text("app_id").notNull(),
    githubUserId: text("github_user_id").notNull(),
    portfolioId: text("portfolio_id").references(() => portfolio.id, {
      onDelete: "set null",
    }),
    operationId: text("operation_id").notNull(),
    generation: integer("generation").notNull(),
    state: text("state", {
      enum: ["consent", "active", "pending", "inflight", "uncertain", "idle"],
    }).notNull(),
    tokenEnc: text("token_enc"),
    tokenBinding: text("token_binding"),
    attemptId: text("attempt_id"),
    attempts: integer("attempts").notNull().default(0),
    retryAt: integer("retry_at").notNull().default(0),
    lastError: text("last_error"),
    // GitHub refused this credential with 401 before it was queued. Only
    // then can a failed delete plus an invalid-token check release cleanup.
    providerRejected: integer("provider_rejected", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [
    primaryKey({ columns: [t.appId, t.githubUserId] }),
    check(
      "github_grant_state",
      sql`${t.state} in ('consent','active','pending','inflight','uncertain','idle')`,
    ),
    check(
      "github_grant_cleanup_token",
      sql`(${t.state} not in ('pending','inflight','uncertain')) or (${t.tokenEnc} is not null and ${t.tokenBinding} is not null)`,
    ),
  ],
);
// One-use private-activity consent attempts (Phase 41). Only a hash of the
// OAuth state is stored. Rows outlive owner deletion (references become null)
// so a reserved `github_grant` can still be reconciled from its attempt.
export const githubConsent = sqliteTable(
  "github_consent",
  {
    stateHash: text("state_hash").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id").notNull(),
    portfolioId: text("portfolio_id").references(() => portfolio.id, {
      onDelete: "set null",
    }),
    appId: text("app_id").notNull(),
    githubUserId: text("github_user_id").notNull(),
    login: text("login").notNull(),
    operationId: text("operation_id").notNull(),
    generation: integer("generation").notNull(),
    // The PKCE verifier, kept only while the attempt can still exchange.
    verifier: text("verifier").notNull(),
    // Where the callback returns: the editor, or the setup guide (Phase 42D).
    returnTo: text("return_to", { enum: ["editor", "setup"] }).notNull(),
    // `repair` must match the selected account. `switch` may replace it.
    intent: text("intent", { enum: ["repair", "switch"] })
      .notNull()
      .default("repair"),
    state: text("state", {
      enum: ["issued", "exchanging", "finished", "void"],
    }).notNull(),
    outcome: text("outcome"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    exchangeStartedAt: integer("exchange_started_at"),
  },
  (t) => [
    index("github_consent_portfolio").on(t.portfolioId, t.createdAt),
    check(
      "github_consent_state",
      sql`${t.state} in ('issued','exchanging','finished','void')`,
    ),
    check("github_consent_return", sql`${t.returnTo} in ('editor','setup')`),
    check("github_consent_intent", sql`${t.intent} in ('repair','switch')`),
    check(
      "github_consent_verifier",
      sql`(${t.state} in ('issued','exchanging')) = (length(${t.verifier}) = 43)`,
    ),
  ],
);
// Independent refresh requests (Phase 42). `requested_at` deduplicates visits,
// editor reads and the daily sweep within the request window and lets a lost
// message be requested again after it; `started_at` lets one delivery of a
// request claim the work. Rows hold no GitHub data.
export const githubRefresh = sqliteTable("github_refresh", {
  portfolioId: portfolioId().primaryKey(),
  requestedAt: integer("requested_at").notNull(),
  startedAt: integer("started_at"),
});
// The published account's public calendar while the draft selects another
// account (Phase 42). It is public data only, never an authorized calendar,
// and is served only when the active version's frozen graph names this
// account. It is replaced or removed by refresh once no longer needed.
export const githubPublishedActivity = sqliteTable(
  "github_published_activity",
  {
    portfolioId: portfolioId().primaryKey(),
    githubUserId: text("github_user_id").notNull(),
    login: text("login").notNull(),
    publicCalendar: text("public_calendar", { mode: "json" }).$type<Calendar>(),
    publicError: text("public_error"),
    checkedAt: integer("checked_at"),
  },
  (t) => [
    check(
      "github_published_activity_json",
      sql`${t.publicCalendar} is null or json_valid(${t.publicCalendar})`,
    ),
  ],
);
// Unknown pre-11D envelopes need operator reconciliation before graph rollout.
export const githubLegacyCredential = sqliteTable("github_legacy_credential", {
  portfolioId: portfolioId().primaryKey(),
  githubUserId: text("github_user_id").notNull(),
  tokenEnc: text("token_enc").notNull(),
  scopes: text("scopes").notNull(),
});
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
    // Phase 45: when the row reached sent or failed, and the owner's
    // final-failure notice (null when none is owed: sent rows and tests).
    finishedAt: integer("finished_at"),
    notice: text("notice", {
      enum: ["pending", "deferred", "sent", "failed"],
    }),
    noticeAttempts: integer("notice_attempts").notNull().default(0),
    noticeNextAt: integer("notice_next_at"),
    // The UTC acceptance time of the notice's email reservation, so a retry
    // on a later day replays the same reservation instead of charging again.
    noticeReservedAt: integer("notice_reserved_at"),
  },
  (t) => [
    index("outbox_portfolio_idx").on(t.portfolioId),
    index("outbox_due_idx").on(t.status, t.nextAttemptAt),
    index("outbox_notice_idx").on(t.notice, t.noticeNextAt),
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
// Shared email budgets (Phase 43). A reservation is one accepted email:
// contact messages and test messages (Phases 44–45) or owner notices
// (verification, final-failure). A dispatch is one provider attempt. Triggers
// in migration 0018 enforce the daily and monthly allowances atomically, so
// concurrent requests cannot exceed them. Rows hold no addresses or content.
export const emailReservation = sqliteTable(
  "email_reservation",
  {
    id: text("id").primaryKey(),
    // Not a foreign key: spent allowance survives portfolio deletion.
    portfolioId: text("portfolio_id").notNull(),
    kind: text("kind", {
      enum: ["contact", "verification", "failure-notice"],
    }).notNull(),
    isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
    day: text("day").notNull(),
  },
  (t) => [
    index("email_reservation_day_idx").on(t.day, t.kind, t.portfolioId),
    check(
      "email_reservation_kind",
      sql`${t.kind} in ('contact','verification','failure-notice')`,
    ),
    check(
      "email_reservation_test",
      sql`${t.isTest} in (0,1) and (${t.kind} = 'contact' or ${t.isTest} = 0)`,
    ),
  ],
);
export const emailDispatch = sqliteTable(
  "email_dispatch",
  {
    attempt: text("attempt").primaryKey(),
    reservation: text("reservation")
      .notNull()
      .references(() => emailReservation.id),
    notice: integer("notice", { mode: "boolean" }).notNull(),
    day: text("day").notNull(),
    month: text("month").notNull(),
  },
  (t) => [
    index("email_dispatch_day_idx").on(t.day, t.notice),
    index("email_dispatch_month_idx").on(t.month),
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

// Phase 51: resumable positions of bounded maintenance passes (the draft
// bucket orphan listing). Holds no owner data.
export const maintenanceCursor = sqliteTable("maintenance_cursor", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
  addressConfirmation,
  githubConnection,
  githubActivity,
  githubGrant,
  githubConsent,
  githubRefresh,
  githubPublishedActivity,
  githubLegacyCredential,
  contactRecipient,
  contactOutbox,
  counter,
  emailReservation,
  emailDispatch,
  operatorEmailAudit,
  maintenanceCursor,
};

// Candidate tombstones survive owner deletion until private object cleanup.
// No live publication pointer or address mutation belongs to this subsystem.
export const publicationCandidate = sqliteTable(
  "publication_candidate",
  {
    id: text("id").primaryKey(),
    portfolioId: text("portfolio_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    cleanedAt: integer("cleaned_at"),
    source: text("source"),
    facts: text("facts"),
    rendererVersion: text("renderer_version").notNull().default("s8-v1"),
    taskBatch: integer("task_batch").notNull().default(16),
    assetOrigin: text("asset_origin")
      .notNull()
      .default("https://s8-assets.invalid"),
    status: text("status").notNull(),
    cursor: text("cursor").notNull(),
    sequence: integer("sequence").notNull().default(0),
    outputCount: integer("output_count").notNull().default(0),
    pageIndex: integer("page_index").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    deadlineAt: integer("deadline_at").notNull(),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [
    index("publication_candidate_due_idx").on(t.status, t.nextAttemptAt),
    index("publication_candidate_owner_idx").on(t.portfolioId),
    check(
      "publication_candidate_status",
      sql`${t.status} in ('preparing','assembling','transferring','ready','failed','cleaning','cleaned')`,
    ),
    check(
      "publication_candidate_source",
      sql`${t.source} is null or json_valid(${t.source})`,
    ),
    check(
      "publication_candidate_cursor",
      sql`json_valid(${t.cursor}) and length(${t.cursor})<=32768`,
    ),
  ],
);
export const publicationCandidatePending = sqliteTable(
  "publication_candidate_pending",
  {
    candidateId: text("candidate_id")
      .primaryKey()
      .references(() => publicationCandidate.id, { onDelete: "cascade" }),
  },
);
export const publicationCandidateIndex = sqliteTable(
  "publication_candidate_index",
  {
    candidateId: text("candidate_id")
      .primaryKey()
      .references(() => publicationCandidate.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
  },
  (t) => [
    check("publication_candidate_index_json", sql`json_valid(${t.value})`),
  ],
);
export const publicationTransfer = sqliteTable(
  "publication_transfer",
  {
    candidateId: text("candidate_id")
      .notNull()
      .references(() => publicationCandidate.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    purpose: text("purpose").notNull(),
    bytes: integer("bytes").notNull(),
    contentType: text("content_type").notNull(),
    complete: integer("complete").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.candidateId, t.assetId, t.purpose] })],
);

export const publicationPage = sqliteTable(
  "publication_page",
  {
    candidateId: text("candidate_id")
      .notNull()
      .references(() => publicationCandidate.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    path: text("path").notNull(),
    parts: integer("parts").notNull().default(0),
    ready: integer("ready").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.candidateId, t.ordinal] })],
);

// Receipts outlive candidate cleanup so delayed retries cannot move the pointer.
export const publicationCommit = sqliteTable(
  "publication_commit",
  {
    candidateId: text("candidate_id").primaryKey(),
    portfolioId: text("portfolio_id")
      .notNull()
      .references(() => portfolio.id, { onDelete: "cascade" }),
    payloadHash: text("payload_hash").notNull(),
    version: integer("version").notNull(),
    address: text("address").notNull(),
    committedAt: integer("committed_at").notNull(),
    applied: integer("applied").notNull(),
  },
  (t) => [
    check("publication_commit_applied", sql`${t.applied} = 1`),
    check("publication_commit_version", sql`${t.version} > 0`),
  ],
);

export const publicationOperation = sqliteTable(
  "publication_operation",
  {
    id: text("id").primaryKey(),
    portfolioId: portfolioId(),
    ownerId: text("owner_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    expectedVersion: integer("expected_version"),
    expectedStatus: text("expected_status", {
      enum: ["draft", "published", "unpublished"],
    }).notNull(),
    failedCode: text("failed_code"),
    cleanupCursor: text("cleanup_cursor").notNull().default(""),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("publication_operation_active")
      .on(t.portfolioId)
      .where(sql`${t.completedAt} is null and ${t.failedCode} is null`),
    index("publication_operation_due").on(t.completedAt, t.nextAttemptAt),
    check(
      "publication_operation_status",
      sql`${t.expectedStatus} in ('draft','published','unpublished')`,
    ),
  ],
);

// Phase 48. One durable cleanup per unpublish: deletes every public object of
// versions up to `version`, purges, then verifies absence (S-9).
export const publicationWithdrawal = sqliteTable(
  "publication_withdrawal",
  {
    id: text("id").primaryKey(),
    portfolioId: portfolioId(),
    address: text("address").notNull(),
    version: integer("version").notNull(),
    cursor: text("cursor").notNull().default(""),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("publication_withdrawal_portfolio").on(t.portfolioId, t.createdAt),
    index("publication_withdrawal_due").on(t.completedAt, t.nextAttemptAt),
    check("publication_withdrawal_version", sql`${t.version} > 0`),
  ],
);

// Phase 49. One durable cleanup per deleted account. It has no foreign keys:
// it outlives the owner's rows and is removed only after output absence is
// confirmed. `address` is the published claim to purge and verify, if any.
export const accountDeletion = sqliteTable(
  "account_deletion",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    portfolioId: text("portfolio_id"),
    address: text("address"),
    stage: text("stage", {
      enum: [
        "public",
        "purge",
        "verify",
        "candidates",
        "draft",
        "rows",
        "final",
      ],
    })
      .notNull()
      .default("public"),
    cursor: text("cursor").notNull().default(""),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("account_deletion_user").on(t.userId),
    index("account_deletion_due").on(t.nextAttemptAt),
    check(
      "account_deletion_stage",
      sql`${t.stage} in ('public','purge','verify','candidates','draft','rows','final')`,
    ),
  ],
);
