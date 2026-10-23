# Phase 20 required profile and provider suggestions

## Scope and acceptance

Implement [Phase 20](../../docs/roadmap.md#phase-20-edit-the-required-profile-and-accept-provider-suggestions), [profile requirements](../../docs/product.md#4-required-profile-images-and-social-identity), [acceptance section 4](../../docs/acceptance-criteria.md#4-required-profile-images-and-social-identity), and reusable [Profile controls](../../docs/onboarding.md#screen-sequence-and-content-mapping).

Prerequisites 11, 17, 18 and 19 are owner-approved and integrated into shared base `0652e4d`. Phase 19 approval is recorded in PR #28. Work uses `feat/20-required-profile` in `/home/umer/.codex/worktrees/phase20-profile/hasawebdotsite`. No agents are delegated. Write boundaries include owner suggestions, private provider-photo retrieval, shared profile controls, tests and affected guidance. Production guide/editor activation and publication remain separate phases.

Workflow. Trace contracts, define boundaries, implement, self-review, drive the controls, run the full local gate, and update current guidance. PR creation and shipping are not requested.

Throughput checkpoint. All prerequisites are integrated. Authentication suggestions, photo retrieval and UI integration run sequentially in this session. The existing controller owns draft state and the shared crop control owns transient image state. No schema migration or second save queue is needed. Shared authentication changes require the full verification profile.

## Decisions

Keep `Draft.profile` and its sample markers. Provider suggestions are private, owner-scoped transient data. Acceptance uses the existing controller and clears the affected sample marker. Email continues to require Phase 21's separate public-link consent.

Retrieve only the authenticated account's stored photo URL through a bounded server request. Allow only HTTPS provider image hosts, refuse redirects, and forward no credentials. Return validated source bytes privately to the existing crop dialog. Only the finished crop enters immutable private upload storage after Apply crop. A URL or fetched source never becomes an accepted asset.

Read-only Figma context for Name field `326:262` supplies the visible label, helper text, 48-pixel input, DM Sans type and warm control colors. Existing editor and crop components supply layout and tokens. Provider images remain dynamic. No Figma edits are authorized.

## Results

The focused locked editor run passes six new profile/provider browser groups and two existing production API groups. Evidence is in `.wrangler/verification/2026-10-22T19-15-28.492Z-OZFEfF/summary.json` and `suite-1/editor-results.json`. The controls exercise actual user input and crop acceptance against production authorization, D1 and R2. Only external provider image HTTP is replaced by the isolated fixture gateway.

The browser checks cover deliberate name acceptance and dismissal, unchanged drafts before consent, saved text and image descriptions, preview/reload parity, crop cancellation with no new asset, immutable removal, malformed/unsupported/redirected/oversized/undecodable sources, manual upload fallback, Google and GitHub image hosts, mobile width, a provider that never responds, and revocation after retrieval starts. Unit checks cover the exact image byte ceiling, streamed overflow and signature framing. Legacy sample markers, whitespace-only fields and an unaccepted avatar do not satisfy local required-field feedback. Authoritative asset readiness remains a later setup/publication check.

The first editor run reached the new mobile check and exposed a test-script error, calling `setViewportSize` on a context instead of the page. The corrected focused run passes. Routine evidence remains under the ignored verification directory. The first full run passed checks but was interrupted by SIGTERM during web bundling. Its summary is `.wrangler/verification/2026-10-22T19-17-57.880Z-DCbkSl/summary.json`; it is not a passing gate.

`pnpm verify --profile=full` passes for the final implementation working changes on `0652e4d`. All 12 commands pass, covering lint, type checks, 394 unit tests, all application builds, 27 renderer browser groups, authentication, persistence, uploads, draft APIs, autosave/recovery, 34 editor browser groups, runtime smoke and routing. The gate is `.wrangler/verification/2026-10-22T19-21-39.575Z-UITzTM/summary.json`. The complete editor proof is `suite-9/editor-results.json`; `suite-9/profile-provider-crop.png` shows the imported crop in both controls and the loaded iframe, and `suite-9/profile-mobile.png` records the mobile controls. The final tests also require keyboard name acceptance and the reference's 48-pixel minimum field height and 16-pixel input text. All changed local documentation targets and `git diff --check` pass. Subsequent edits only finalize documentation and do not invalidate this application gate.

The self-review checked the outbound URL policy, no-credential/no-redirect fetch, bounded bytes and timeout, post-download persisted authorization, default summary response shape, source retention, stale callbacks and controller lifetime, sample acceptance and reuse of the existing save/crop/readiness path. No unresolved implementation defects remain from that self-review. Desktop/mobile screenshots were inspected against the read-only field reference and existing editor controls.

The owner approved Phase 20 completion on October 23, 2026 in chat after integration into `main` through PR #29 at `212256d`. The roadmap now records that approval and marks Phase 20 complete. The required separate authorization/privacy boundary review remains pending; owner completion approval does not record that review as performed. No reviewer was delegated because the original task authorizes only this session. Production editor/onboarding activation, live provider availability, deployed CPU limits and publication remain outside this local implementation evidence.

## Documentation impact

Provider suggestions and import are now implemented in the handoff fixture. Authentication, asset/client and database guidance, implementation status, onboarding, the roadmap record, root README and verification recipes describe that change and its private source/crop/ready-asset boundary. Reimport fetches the current provider image anew; it promises no retained original. Required setup routing, authoritative setup/publication validation and deployment remain unresolved later-phase prerequisites. Historical evidence and existing owner approvals are preserved. The October 23, 2026 approval follow-up updates this record, the roadmap checkbox and approval note, and the implementation baseline. The separate authorization/privacy boundary review remains outstanding. Documentation-only verification uses the `docs` profile: changed local links and guidance were checked, and `git diff --check HEAD` passed; the existing application gate remains applicable.
