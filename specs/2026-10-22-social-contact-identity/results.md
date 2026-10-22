# Phase 21 social and contact identity

## Scope and acceptance

Implement reusable link controls for [product section 4](../../docs/product.md#4-required-profile-images-and-social-identity), [acceptance criteria 4.3 through 4.7](../../docs/acceptance-criteria.md#4-required-profile-images-and-social-identity), and [the required onboarding Links step](../../docs/onboarding.md#screen-sequence-and-content-mapping).

Prerequisites 11, 13 through 15, and 17 are owner-approved and integrated in shared base `7debdbd`. Work uses branch `feat/21-social-identity` in `/home/umer/.codex/worktrees/phase21-social-identity/hasawebdotsite`. Phase 20 is not a prerequisite.

This worker owns `SocialLinksControl`, supporting link helpers, its tests and browser verification hook, minimal owner email suggestion handling, and this record. The coordinator owns editor field/session wiring, shared verification scripts, and shared current guidance. Phase 19 owns image controls and preview asset adapters. No schema changes were required.

Throughput checkpoint. The link collection and controller already exist. Link controls and crop controls have separate write boundaries. The coordinator integrates the component and browser hook sequentially, then runs the combined gate under the shared verification lock.

The coordinator integrated both workers sequentially on `feat/19-21-upload-links` in `/home/umer/hasawebdotsite`.

## Decisions

Use the existing `Draft.links` list. Each entry retains its stable ID and independent profile and social component placement. Invalid destination text remains in the controller's local input records. No second store or save queue is added.

A qualifying setup link needs a nonempty understandable label, a valid nonempty email or HTTP(S) destination, and profile placement. Contact component configuration does not count. The helper implements this subset for later authoritative setup validation without activating setup or publication.

## Results

An exact-limit reproduction exposed uncaught `Draft exceeds 1048576 UTF-8 bytes` errors for additions and valid paired kind/destination changes. Both regression tests failed before the fix; all seven focused tests pass afterward. Candidate links now pass the complete bounded draft schema before an update. Rejected edits remain in stable raw inputs with field-linked explanations, and rejected additions show a shorten-or-remove message. Placement controls also render raw booleans when a one-byte expansion cannot fit. Existing working content and IDs remain unchanged.

The integrated `pnpm verify --profile=full` passes at `5ccd750`, with the documentation working changes captured in its source record. All 12 commands pass, including 372 unit tests, all application builds, authentication/draft/recovery regressions, and 26 editor browser groups. Local evidence lives under `.wrangler/verification/2026-10-22T17-57-07.588Z-IKLWJf`, with `summary.json` and `suite-9/editor-results.json` recording the gate and browser checks.

All four link browser groups pass against the production component, signed sessions, real owner API, D1, and preview iframe. They check email suggestion authority, both placements, stable order and IDs, raw kind/destination recovery after reload, explicit email consent, no duplicate email or automatic component, removal confirmation, keyboard navigation, mobile width, and recoverable label/destination/placement edits at the exact draft byte ceiling. The coordinator inspected the mobile screenshot. The revoked-session case explicitly revokes the fixture session before asserting denial.

The connected read-only Figma reference [Add an email link](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=330-371) supplies the explicit public-visibility copy, private contact recipient distinction, lime consent action, and 48-pixel controls. The editor control adapts these to the existing panel; production onboarding screen integration remains later work.

The coordinator performed a separate self-review of authorization and privacy. Both owner entry paths authenticate without cookie caching and check persisted owner access before the shared summary helper. The default response omits email. Opt-in suggestions require a matching expected owner and retain private/no-store responses. Suggesting or dismissing an email changes no draft; acceptance uses the existing controller. The iframe receives display links only, excluding the account suggestion and private contact recipient configuration. The runtime checks cover missing/wrong owners, sign-out, expiry, deletion, and revocation. No unresolved implementation defects remain from this review.

Owner phase completion approval was pending at this verification checkpoint. Production editor/onboarding activation and authoritative required-setup/publication validation remain later work.

The owner approved PR #28 and completion of this phase on October 22, 2026. The roadmap now records that approval. This approval follow-up changes documentation only; the existing application verification remains applicable. Documentation checks reviewed the changed links and final diff and passed `git diff --check`.

## Documentation impact

Authentication and draft guidance now describe opt-in email suggestions, deliberate public acceptance, stable shared links, and raw-input recovery. The baseline, onboarding guidance, root README, and verification recipes describe handoff-only integration and remaining authoritative setup/publication prerequisites. The original implementation added roadmap links without phase checkoff. The October 22 owner approval follow-up checks off the phase and updates the baseline approval status; later integration prerequisites remain unchanged. Historical evidence and existing approvals remain intact.
