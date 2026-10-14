# Phase 01 requirements

Establish the workspace described in architecture sections 5, 6, and 12. Use pnpm and Turborepo, strict TypeScript, exact dependency versions, Next.js App Router through OpenNext, and separate site and jobs Workers.

Create the eight planned shared packages. Set up local D1, three R2 buckets, Queues, Workflows, and service bindings with state persisted under `.wrangler/state`. Only web may bind the draft bucket. Keep local fixtures and secrets separate from production. Add baseline build, lint, typecheck, and runtime tests in GitHub Actions.

This phase supplies runtime probes and a plain development page. Authentication, product data models, rendering benchmarks, portfolio UI, and production resource provisioning belong to later phases. No Figma UI is implemented in this phase.

AGENTS.md branch conventions override the older roadmap branch example. Leave the phase unchecked until the owner approves completion after reviewing the implementation.

## Runtime compatibility decision

Next.js 16.4.0 with OpenNext 1.20.11 compiled successfully but returned HTTP 500 from `/api/health` in workerd with `Unexpected loadManifest(/.next/server/preview-props.json) call!`. Pin Next.js 16.3.8, the newest 16.3 patch accepted by the adapter, until the runtime fix ships and passes the smoke test. This preserves Next.js 16 and the agreed architecture. See [OpenNext issue 1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355).

Node.js 22.22.1 is the existing local LTS tooling runtime and is pinned for repeatable CI.
