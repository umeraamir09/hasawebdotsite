# Acceptance criteria

- A frozen install resolves the exact pinned workspace dependencies.
- All apps and shared packages pass strict TypeScript and Biome checks.
- Next.js and OpenNext build successfully. Both thin Workers bundle without deployment.
- One documented command starts all three Workers in workerd with local bindings.
- Runtime checks exercise all three Workers, D1 reads, isolated R2 buckets, service calls, Queue consumption, and Workflow execution.
- A stop/start cycle preserves seeded D1 and R2 resources on disk.
- Development fixtures have no production mutation path, and production configuration contains no fake resource IDs or secrets.
- CI runs the install, checks, builds, and local runtime smoke test without Cloudflare credentials.

## Evidence

Verified locally on October 14, 2026 with Node.js 22.22.1 and pnpm 12.11.2.

| Check | Evidence |
| --- | --- |
| Frozen installation | `pnpm install --frozen-lockfile` succeeds with the committed lockfile and explicit native build permissions. |
| Lint and strict types | `pnpm check` passes Biome and all 11 app/package TypeScript checks. The two unit tests reject nonlocal development probes. |
| Worker builds | `pnpm build` passes Next.js 16.3.8 through OpenNext 1.20.11 and Wrangler dry-run bundles for site and jobs. |
| Combined runtime | `pnpm test:runtime` passes on the compiled web Worker and both auxiliary Workers in workerd. The home page and all three health responses succeed. |
| Shared resources | Web reads the private draft R2 fixture. Site and jobs read sites/assets fixtures. All read the same D1 fixture. Only web has the draft bucket binding. |
| Background jobs | Web sends messages to both contact and GitHub Queues and creates a Workflow in jobs. Jobs records all three completions in D1, which the test polls through a service binding. |
| Persistence | The smoke test stops and restarts workerd without reseeding, then verifies the D1 job results and draft/site/asset R2 fixtures. |
| Environment separation | Seed commands hard-code `--local`. Builds use dry runs. Local resource names and IDs are confined to local Wrangler configs. Secrets and state are ignored. No production deployment configuration or credentials were added. |
| CI | `.github/workflows/ci.yml` runs frozen install, checks, build, and the same runtime smoke test without provider credentials. These commands pass locally; a hosted GitHub Actions run has not been performed in this task. |

Next.js 16.4.0 failed the workerd health check despite compiling. The compatible 16.3.8 pin and upstream issue are recorded in requirements.md. This verification establishes local execution only. CPU measurements, production routing, authentication, and publish behavior remain in their later phases.

The owner approved Phase 01 completion on October 14, 2026. Its roadmap checkbox is checked.
