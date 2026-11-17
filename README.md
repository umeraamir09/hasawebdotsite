# hasaweb.site

A free, component-based portfolio builder: owners fill a guided setup and an editor, then publish to `username.hasaweb.site`. Next.js on OpenNext plus three Cloudflare Workers, D1, R2 and Better Auth.

Start with [AGENTS.md](AGENTS.md) for how work is done here, and [docs/roadmap.md](docs/roadmap.md) for what is left.

## Setup

Node.js 22.22.1 and pnpm 12.11.2. Direct dependencies use exact versions and the lockfile pins the rest. Next.js is pinned to 16.3.8 because 16.4.0 fails the OpenNext workerd smoke test.

```sh
corepack enable
corepack prepare pnpm@12.11.2 --activate
pnpm install --frozen-lockfile
pnpm local:seed
pnpm dev
```

Open http://127.0.0.1:8787. `pnpm dev` builds and starts web, site and jobs together in workerd; web is the entry point and the others are reached over service bindings. `pnpm dev:runtime` restarts without rebuilding (Worker source reloads; Next.js changes need a rebuild). `pnpm dev:web` gives Next.js hot reload on port 3000 but cannot reach the jobs owner API.

Local D1/R2 state lives in `.wrangler/state/`. Delete it to reset, then seed again. The seed applies migrations and adds runtime fixtures and two development accounts with empty private drafts (no sessions or credentials).

If `pnpm` in WSL resolves to a Windows executable, use `npm exec --yes --package=pnpm@12.11.2 -- pnpm <command>`.

### Local setup

1. Copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` and `apps/jobs/.dev.vars.example` to `apps/jobs/.dev.vars`. Both Workers need the same `APP_ORIGIN`, `BETTER_AUTH_SECRET` (32+ characters) and development OAuth credentials, because the jobs owner API verifies sessions independently.
2. Set `APP_ORIGIN` to the exact browser origin without a trailing slash: `http://127.0.0.1:8787` for `pnpm dev`, `http://127.0.0.1:3000` for `pnpm dev:web`. Never a LAN address, portfolio host or path.
3. Register development OAuth apps with callbacks `{APP_ORIGIN}/api/auth/callback/github` and `{APP_ORIGIN}/api/auth/callback/google`.
4. To use the real guide and editor, add `OWNER_ENTRY_ACTIVATION=active` to `apps/web/.dev.vars`. Without it `/auth/entry` and `/editor` show the welcome shell.
5. Email (contact recipient confirmation) prints to the jobs console unless `RESEND_API_KEY` and `EMAIL_FROM` are set in `apps/jobs/.dev.vars`.

### Production configuration (Phase 52)

The committed `wrangler.jsonc` files name only local resources; do not deploy them. Production configs, resource IDs, routes and secrets arrive in Phase 52. Production needs `APP_ORIGIN=https://hasaweb.site` in web and jobs; matching `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_*` and `GOOGLE_CLIENT_*`; OAuth callbacks `https://hasaweb.site/api/auth/callback/{github,google}`; and, for private GitHub activity, a second GitHub OAuth app with callback `https://hasaweb.site/api/owner/github/consent/callback` and jobs secrets `GITHUB_ACTIVITY_CLIENT_ID`, `GITHUB_ACTIVITY_CLIENT_SECRET`, `GITHUB_ACTIVITY_KEY` (base64 of 32 random bytes; rotation is not supported). Public graphs need `GITHUB_SERVICE_TOKEN`, a zero-scope token, on jobs. Email needs jobs secret `RESEND_API_KEY` and variable `EMAIL_FROM` on the verified `mail.hasaweb.site` domain; without them recipient confirmation reports email unavailable.

## Checks

```sh
pnpm check            # Biome, typecheck, Vitest (~1 min)
pnpm verify           # check, then build and the e2e projects your diff affects
pnpm verify --all     # check, build and every e2e project
pnpm verify --dry-run # show what verify would run
pnpm e2e --project=editor -g "resume download"   # one journey, against the last build
```

End-to-end suites live in [`e2e/`](e2e/README.md) and run on Playwright Test against the built Workers in workerd. They need Chromium at `/opt/google/chrome/chrome` (or set `AUTH_SPIKE_CHROMIUM`). Each worker gets its own runtime on free ports, so separate worktrees can run suites at the same time.

A pre-commit hook (installed by `pnpm install`) runs Biome on staged files.

CI runs `pnpm check`, the build and all e2e projects on every pull request and push to `main` that changes code. Documentation-only changes skip CI.

## Workspace

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js app, auth, editor, guide, previews; pre-OpenNext handlers in `worker.ts` |
| `apps/site` | Thin public serving Worker |
| `apps/jobs` | Hono owner API, publication dispatcher, Queue consumers, cron |
| `apps/*/integration` | Fixture Worker entries used only by e2e suites |
| `packages/schema` | Versioned draft schema and validation |
| `packages/db` | Drizzle migrations and owner-scoped repositories |
| `packages/auth` | Better Auth configuration and session checks |
| `packages/components` | Markup-only portfolio components, display projection, preview bridge, `site.js` |
| `packages/render` | Bounded fragment rendering and document/security policy |
| `packages/theme` | Appearance catalog and palette generator |
| `packages/github` | GitHub calendars, OAuth, refresh |
| `packages/email` | Email provider adapters and templates |
| `packages/config` | Shared TypeScript config and runtime helpers |
| `e2e` | Playwright Test suites and fixtures |
| `scripts` | `verify`, seed and build helpers |
