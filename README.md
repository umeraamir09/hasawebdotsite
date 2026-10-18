# hasaweb.site

Phases 01–13, including 11A–11E, are implemented and marked complete in the [roadmap](docs/roadmap.md). Phase 14, shared autosave and local recovery, is next. Start with [current implementation and decision changes](docs/implementation-status.md) before implementing a phase.

## Setup

Use Node.js 22.22.1 and pnpm 12.11.2. The package manager and direct dependencies have exact versions, and `pnpm-lock.yaml` pins transitive dependencies. Next.js is pinned to 16.3.8 because 16.4.0 fails the OpenNext workerd smoke test. See the [compatibility decision](specs/2026-10-14-local-runtime/requirements.md).

```sh
corepack enable
corepack prepare pnpm@12.11.2 --activate
pnpm install --frozen-lockfile
pnpm local:seed
pnpm dev
```

Open http://127.0.0.1:8787. `pnpm dev` builds the web Worker and starts web, site, and jobs together in workerd. Web is the public local entrypoint. Auxiliary Workers are available over service bindings. `pnpm dev:runtime` restarts an existing build without rebuilding. Worker source changes reload automatically; Next.js changes require rebuilding. `pnpm dev:web` provides Next.js hot reload on port 3000 for web-only work. Use the combined runtime to verify cross-Worker, Queue, and Workflow behavior.

Stop with Ctrl+C. D1 and R2 resources persist under `.wrangler/state/`. Delete that ignored directory only when you want to reset development data, then seed again. The seed applies the tracked local database migrations and adds runtime fixtures plus two development accounts with private empty drafts. It creates no usable sessions or provider credentials. Existing drafts survive repeat seeding.

## Checks

```sh
pnpm check
pnpm build
pnpm test:runtime
pnpm test:persistence
```

`check` runs Biome, strict TypeScript across all apps/packages, and unit tests. `build` runs Next.js through OpenNext and bundles site/jobs with Wrangler dry runs. `test:runtime` seeds local fixtures, starts all Workers on port 8799, exercises D1/R2/services/Queue/Workflow, and restarts to check persistence. It stops its processes on completion. `test:persistence` verifies migrations, fixtures, owner isolation, session revocation, deletion, and restart persistence in isolated workerd/D1. GitHub Actions runs these checks without Cloudflare credentials. See [database usage and boundaries](packages/db/README.md).

## Workspace

- `apps/web` holds Next.js App Router and OpenNext.
- `apps/site` is the thin public serving Worker.
- `apps/jobs` hosts the named Hono `OwnerApi` entry for initialization and bounded draft/progress APIs. Its Workflow, Queue and scheduled handlers are local probes.
- `packages/schema` and `db` implement versioned drafts, setup/progress, persistence, provisioning, bounded saves and legacy validation. `auth` implements shared Better Auth/session checks. `github` implements calendar/credential contracts and `theme` exports the approved catalog. `email` supplies tested provider adapters/templates. These packages still need their scheduled product integrations.
- `packages/components` currently re-exports the data registry; `packages/render/src` is empty. The shared portfolio renderer remains Phase 16.
- `packages/config` supplies shared strict TypeScript settings and runtime utilities.

Web has a minimal entry page, GitHub/Google sign-in, an authenticated welcome shell that provisions the private portfolio, and an avatar reference review. The full editor, autosave UI, onboarding and public portfolio serving remain pending. UI implementation must read the Figma reference described in [docs/ui-direction.md](docs/ui-direction.md).

## Local and production separation

The committed `wrangler.jsonc` files name only local resources. All commands here use local simulation or dry runs. `APP_ENV=local` and loopback hostname checks restrict development probe routes. The private draft bucket is bound only to web.

Do not deploy these local configurations. Production resource IDs, routes, secrets, and deployment approval are configured in Phase 52 with separate production config files. No production config is supplied until real resources exist. Runtime probe tables, fixtures, handlers, and the probe handlers for the contact/GitHub Queues and publish Workflow are development scaffolding, not publishing or delivery implementations.

Put local authentication secrets in ignored `apps/web/.dev.vars` and `apps/jobs/.dev.vars`, starting from their `.dev.vars.example` files. Both Workers must use the same `APP_ORIGIN`, Better Auth signing secret, and development OAuth credentials. The named jobs owner API verifies the original session cookie independently. Never commit credentials.

The configuration follows [OpenNext setup](https://opennext.js.org/cloudflare/get-started) and [Cloudflare multi-Worker development](https://developers.cloudflare.com/workers/local-development/multi-workers/).

If your WSL `pnpm` command resolves to a Windows executable, run commands through the Linux package runner, for example `npm exec --yes --package=pnpm@12.11.2 -- pnpm dev`.

## Publish rendering spike

Run `pnpm spike:render` to benchmark synthetic near-limit portfolio, case-study, and resume pages with production React in local workerd. It writes timing samples and CPU profiles under `.wrangler/render-spike/` without deploying. See the [S-1 findings and revised approach](specs/2026-10-15-publish-render/results.md) before implementing publication.

Run `pnpm spike:email` for the isolated S-7 provider and atomic D1 budget fixtures. See the [email delivery results](specs/2026-10-15-email-delivery/results.md) and [live setup](specs/2026-10-15-email-delivery/live-setup.md). `pnpm spike:email:live` reads domain/delivery status; `--send` is reserved for the three explicitly authorized tests and requires the ignored local env file.

Run `pnpm test:owner-runtime` after building to verify the thin owner API through the web Worker adapter and named jobs binding. See the [Phase 11A measurement protocol](specs/2026-10-16-owner-api-runtime/protocol.md) for the isolated deployed CPU experiment and cleanup.

After building, run `DRAFT_API_EVIDENCE=.wrangler/draft-api-review pnpm test:draft-api` to verify production draft/progress routes through the real Worker binding, including revisions, staged recovery, milestone protection and bounded legacy validation. The evidence override preserves the historical Phase 13 receipts; use a new phase-specific directory when retaining a later run. See the [Phase 13 API protocol](specs/2026-10-17-revision-aware-drafts/protocol.md). Autosave and recovery UI remain later phases.
