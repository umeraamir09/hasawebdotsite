# D1 persistence

`src/schema.ts` defines the Drizzle/SQLite tables, including the Better Auth adapter tables. The `portfolio.user_id` unique constraint enforces one portfolio per account. Draft bodies use the Phase 09 contract and a database limit of 1,048,576 UTF-8 bytes. Publication bodies stay in R2; D1 holds version metadata and the live pointer.

## Local migrations and fixtures

From the repository root:

```sh
pnpm db:generate
pnpm db:migrate:local
pnpm local:seed
pnpm test:persistence
```

`db:generate` runs drizzle-kit against the checked-in schema and snapshots. Review every generated SQL file before applying it. `0002_counter_owner.sql` explicitly retains `ON DELETE CASCADE`, which drizzle-kit's generated ADD COLUMN omitted. Keep future changes compatible with the previous deployed application. The three local Wrangler configurations share `packages/db/migrations`; migration application uses Wrangler's `d1_migrations` tracking. Production configuration and migration deployment arrive in Phase 52.

The seed creates two deterministic development users and private empty drafts. It adds no sessions, credentials, or public claims. It preserves existing drafts on reruns. Template and sample provisioning belongs to Phase 12. The fixture appearance IDs are private placeholders until the approved catalog exists.

## Owner access

Use `ownerApi` at the request boundary and pass Better Auth's session reader:

```ts
const handler = ownerApi(
  {
    db: env.DB,
    origin: applicationOrigin,
    readSession: (headers) => auth.api.getSession({ headers }),
  },
  async (_request, repositories) => {
    const portfolio = await repositories.portfolio.get();
    return privateJson(portfolio ?? null, portfolio ? 200 : 404);
  },
);
```

The guard checks the request URL against the exact application origin. POST, PUT, PATCH, DELETE, and any other unsafe method also require that exact Origin header and the application/json media type. It resolves the session on every request, then verifies the session ID, user ID, expiry, and account deletion state against D1. Authentication or D1 failures deny access. Responses always use private/no-store and noindex headers.

`ownerRepositories` accepts only an identity resolved by the authentication library. Never construct it from a request body, path, query, or owner-ID header. Each operation includes its own persisted session and owner predicates. A previously created repository therefore cannot keep accessing data after session revocation or deletion. Inserts derive the portfolio ID from the active session; supplied extra ownership fields cannot redirect inserts or upserts. Missing and cross-owner record IDs both return no record. Map those results to 404 in future handlers.

The repositories provide portfolio creation/reads, asset metadata, candidate publication versions, current claims, connected GitHub records, contact recipients and outbox, owner counters, and provider identity listings. Provider listings exclude grants. GitHub disconnect clears the grant ciphertext and private counts in one D1 batch. Outbox finalization clears visitor payloads, also enforced by a database constraint. These persistence helpers are internal methods; handlers must select permitted fields and run the relevant feature validation before calling them.

Owner counters use an encoded namespace and a cascading user reference. Owners cannot access shared email budget keys through this repository. Shared budgets and operator audits require trusted service repositories when their flows arrive. The schema exports support those services; raw queries do not belong in request handlers.

Existing claims are read-only through the owner repository. Database triggers prevent name changes, transfer, deletion, and insertion of platform-reserved names. Deleting a portfolio clears its claim's owner while retaining the name permanently. First publication must create a claim and change the live pointer in the same transaction in Phase 25. No standalone owner claim mutation is exposed here. Draft revision APIs, public contact acceptance with atomic budgets, delivery retries, encryption and provider grant verification remain in their scheduled phases.

## Verification

`test:persistence` starts an isolated local Worker, applies the checked-in SQL migrations twice, seeds twice, and exercises the repositories in workerd/D1 with two owners and controlled session states. It uses the real Better Auth adapter and signed cookies, including an actual cached session cookie after D1 revocation. It also checks draft byte boundaries, concurrent inserts/counters, relational constraints, account-deletion cascades, permanent claims, failed dependencies, and restart persistence. It removes only its own ignored test state on the next run and writes evidence to `.wrangler/persistence-integration/evidence.json`. CI runs it alongside the existing three-Worker smoke test. The test Worker is separate from application entrypoints and accepts only local loopback requests.
