# Phase 12 implementation and verification

Implemented October 17, 2026 on `feat/private-portfolio`. Implementation is verified locally. The owner approved Phase 12 completion on October 17, 2026.

## Result

Authenticated account entry now calls `POST /api/owner/portfolio` through the web Worker adapter and the named jobs `OwnerApi` binding. The endpoint accepts only `{}`, with a 1,024-byte streamed-body limit, and returns the authenticated user's ID/name and portfolio ID. Session probes remain read-only.

`repositories.portfolio.provision()` inserts an empty private draft using the approved Leaf/DM Sans/system appearance, no decoration and Face Reveal off. The application has the single fixed `portfolio-v1` template; there is no template choice or new draft layout field. Initial progress is Address, the revision is zero, and the permanent editor milestone is unset. Provider name, email and remote photo remain account identity. No profile/project samples, image references, optional components, links, public claims, publications or GitHub connections are inserted.

The account's unique portfolio constraint resolves concurrent initialization. The insert checks the current persisted session and account deletion state in the same statement. Conflicts leave the existing row untouched. A separate owner-scoped identifier read avoids parsing existing content, including legacy drafts outside current URL limits. Repeated calls preserve content, appearance, revision, progress, milestones, validation markers and publication state.

The account shell waits for initialization before displaying signed-in success. Its existing Retry action recovers from a lost successful response, and expired sessions return to sign-in. Functional entry uses `pnpm dev`, the three-Worker runtime. A standalone `pnpm dev:web` does not host the Worker adapter or jobs binding.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm check` | Pass. Lint, all 12 package typechecks, 221 tests across 21 files. | Command completed successfully. Includes client initialization/session/retry tests. |
| `pnpm build` | Pass. All 12 build tasks, including Next.js/OpenNext and jobs/site Worker dry runs. | Command completed successfully. |
| `pnpm test:persistence` | Pass. 73 workerd/D1 groups, tracked migration reapplication, repeated seeds and restart recovery. | [Persistence evidence](persistence-evidence.json). |
| `pnpm test:auth:browser --evidence-dir=specs/2026-10-17-private-portfolio` | Pass. 29 auth/provisioning groups, Chromium cookie isolation and 10 browser journey checks. No browser exceptions. | [Auth and browser evidence](evidence.json), [account entry screenshot](editor-entry.png). |
| `BOUNDED_SAVE_EVIDENCE=specs/2026-10-17-private-portfolio/bounded pnpm test:bounded-saves` | Pass. All 17 groups, including exact 1 MiB drafts, conflicts, session recovery and failure handling. | [Bounded-save regression evidence](bounded/local-results.json). |
| `pnpm test:runtime` | Pass. Three Workers, D1, three R2 buckets, service bindings, Queue, Workflow and restart persistence. | Command completed successfully. |
| `git diff --check` | Pass. | Final workspace check. |

The persistence checks cover simultaneous first creation, byte-identical preservation of a legacy draft, a published fixture with a permanent editor milestone, and revocation/expiry/deletion after repository construction. A partially completed profile retains its accepted name, revision one and Profile progress across an actual Worker restart; another initialization preserves the entire recovered row.

Real Better Auth provider adapters with controlled GitHub/Google responses supply nonempty provider identities and photos. Both produce an empty portfolio. Repeated requests, another session/device, verified provider linking and eight concurrent first requests retain one ID. Forged owner headers/query IDs cannot target another owner. Body overrides, malformed/oversized bodies, unsupported methods, wrong origins, copied revoked cookies and deleting accounts fail without replacing content.

The browser suite also signs an isolated local fixture session and exercises authenticated initialization through the actual built web Worker, named jobs binding and shared D1. The rendered account shell separately retries a deliberately lost successful initialization response, then opens the same portfolio. Sign-out and Google reauthentication preserve its identity.

## Acceptance coverage and limits

All seven phase acceptance criteria pass. [Authentication documentation](../../docs/authentication.md) and [repository documentation](../../packages/db/README.md) describe the implemented boundary.

Provider HTTP responses and consent are fixtures. No production deployment, new production CPU measurement or live OAuth consent was performed in this phase. The bounded-save run is a regression check, not a new CPU benchmark. Prior phase feasibility evidence retains its documented limits.

Guided setup screens/routing, production draft reads/saves, provider suggestions/import/cropping and authoritative first-editor handoff remain in their scheduled phases. Initialization grants no handoff milestone or publication readiness. No layout/style change or Figma edit was made.

## Completion approval

The owner explicitly approved checking off Phase 12 on October 17, 2026 and requested a pull request. The roadmap now records the phase as complete.
