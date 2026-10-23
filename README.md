# hasaweb.site

Use the [roadmap](docs/roadmap.md) for owner-approved phase status, [implementation status](docs/implementation-status.md) for current code and constraints, and the [agent workflow](docs/agent-workflow.md) for parallel work, concise phase records and local checks. Shared saving/recovery, renderer and editor adapters are implemented. Editor activation, publication and guided setup remain pending.

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
pnpm verify --profile=full
pnpm verify --profile=renderer --dry-run
```

Named profiles run the applicable local checks under a shared worktree lock and retain routine output in ignored run directories. See the [profile table](docs/agent-workflow.md#choose-local-checks) for affected application builds, high-risk review and evidence policy. `pnpm check`, `pnpm build` and individual test commands remain available during development. CI retains all foundation correctness suites; `pnpm test:runtime:smoke` runs runtime assertions without benchmark profiling. `pnpm spike:runtime` remains the explicit measurement command. See [database boundaries](packages/db/README.md).

The project-local [verification skill](.agents/skills/verify-hasaweb/SKILL.md) and [feature map](.agents/skills/verify-hasaweb/features/README.md) describe user journeys, selectors and current fixture boundaries. The skill lives in `.agents/skills` for Codex and other compatible tools; `.cursor/skills/verify-hasaweb` links to the same files. Run `./.agents/skills/verify-hasaweb/scripts/verify.mjs` for a built-app signed-out entry proof with isolated storage, browser evidence and automatic cleanup under the shared verification lock.

## Workspace

- `apps/web` holds Next.js App Router and OpenNext.
- `apps/site` is the thin public serving Worker.
- `apps/jobs` hosts the named Hono `OwnerApi` entry for initialization and bounded draft/progress APIs. Its Workflow, Queue and scheduled handlers are local probes.
- `packages/schema` and `db` implement versioned drafts, setup/progress, persistence, provisioning, bounded saves and legacy validation. `auth` implements shared Better Auth/session checks. `github` implements calendar/credential contracts and `theme` exports the approved catalog. `email` supplies tested provider adapters/templates. These packages still need their scheduled product integrations.
- `packages/components` provides shared markup-only portfolio components, display-only projection, browser preview, Leaf/DM Sans styles and a vanilla interaction script. `packages/render` provides bounded fragment serialization, document/security policy and a separate offline snapshot fixture helper. See the [renderer contract](packages/render/README.md) and [Phase 16 evidence](specs/2026-10-19-shared-portfolio-renderer/results.md). The Phase 17 editor adapter reuses these components through an authenticated handoff fixture. Publication remains pending.
- `packages/config` supplies shared strict TypeScript settings and runtime utilities.

Web has a minimal entry page, GitHub/Google sign-in, an authenticated welcome shell that provisions the private portfolio, and an avatar reference review. Shared autosave/status/conflict-review controls and `/auth/recovery` are integrated into a reusable editor with private live preview. Its production entry stays dormant until the complete setup flow is activated in Phase 42E. Onboarding and public portfolio serving remain pending. UI implementation must read the Figma reference described in [docs/ui-direction.md](docs/ui-direction.md).

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

After building, run `DRAFT_API_EVIDENCE=.wrangler/draft-api-review pnpm test:draft-api` to verify production draft/progress routes through the real Worker binding, including revisions, staged recovery, milestone protection and bounded legacy validation. Local runs now default to unique ignored evidence directories. Use an explicit new phase-specific directory only when retaining selected proof. See the [Phase 13 API protocol](specs/2026-10-17-revision-aware-drafts/protocol.md). The [shared client](apps/web/lib/draft/README.md) implements Phase 14 autosave/recovery and Phase 15 selected conflict review without activating editor or onboarding routes. Recovery reauthentication uses fixed `/auth/recovery` and `/auth/recovery/error` destinations, preserving the normal `/editor` callback. Every draft/progress request requires `X-Expected-Owner-Id`, checked against the authenticated identity. Run `DRAFT_API_EVIDENCE=.wrangler/autosave-review pnpm test:autosave` for the isolated Playwright browser/API suite, including IndexedDB recovery, dropped replies, account isolation and accessibility. It uses installed Chrome, overridable with `AUTH_SPIKE_CHROMIUM`, and never exposes fixture routes in product builds.

## Editor and live preview checks

Run `pnpm verify --profile=editor` for checks, web/jobs builds and the real owner-API editor fixture. `pnpm test:editor` runs only that browser suite after the applications have been built. It covers immediate valid edits, raw stable-path input, both preview widths, selected recovery, private iframe transport, explicit Address confirmation, shared crop/upload controls, social/contact links, and explicit provider name/photo acceptance. See [Phase 20 results](specs/2026-10-23-required-profile/results.md), [Phase 17 results](specs/2026-10-20-editor-live-preview/results.md), [Phase 19 results](specs/2026-10-22-upload-crop-controls/results.md), [Phase 21 results](specs/2026-10-22-social-contact-identity/results.md), [Phase 22 results](specs/2026-10-21-address-reservations/results.md), and the [draft client contract](apps/web/lib/draft/README.md#editor-integration). These fixtures do not activate `/editor`, setup routing or publication. External provider image HTTP is controlled fixture data; authentication, crop/upload and persistence are real.

## Private upload checks

Run `pnpm verify --profile=uploads` for checks, builds and the real D1/R2 upload suite. The [private asset protocol](apps/web/lib/assets/README.md) describes binary `PUT /api/assets`, owner-only reads, framing headers and lifecycle failures. The editor profile additionally drives crop controls and private image display. [Phase 18 results](specs/2026-10-21-private-uploads/results.md) retain the original transport evidence. Jobs source transfer and deployed CPU requirements remain separate.
