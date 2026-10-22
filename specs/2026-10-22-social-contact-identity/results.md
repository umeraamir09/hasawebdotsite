# Phase 21 social and contact identity

## Scope and acceptance

Implement reusable link controls for [product section 4](../../docs/product.md#4-required-profile-images-and-social-identity), [acceptance criteria 4.3 through 4.7](../../docs/acceptance-criteria.md#4-required-profile-images-and-social-identity), and [the required onboarding Links step](../../docs/onboarding.md#3-step-sequence-and-mapping).

Prerequisites 11, 13 through 15, and 17 are owner-approved and integrated in shared base `7debdbd`. Work uses branch `feat/21-social-identity` in `/home/umer/.codex/worktrees/phase21-social-identity/hasawebdotsite`. Phase 20 is not a prerequisite.

This worker owns `SocialLinksControl`, supporting link helpers, its tests and browser verification hook, minimal owner email suggestion handling, and this record. The coordinator owns editor field/session wiring, shared verification scripts, and shared current guidance. Phase 19 owns image controls and preview asset adapters. Shared schema changes require coordination. No schema change is planned.

Throughput checkpoint. The link collection and controller already exist. Link controls and crop controls have separate write boundaries. The coordinator integrates the component and browser hook sequentially, then runs the combined gate under the shared verification lock.

## Decisions

Use the existing `Draft.links` list. Each entry retains its stable ID and independent profile and social component placement. Invalid destination text remains in the controller's local input records. No second store or save queue is added.

A qualifying setup link needs a nonempty understandable label, a valid nonempty email or HTTP(S) destination, and profile placement. Contact component configuration does not count. The helper implements this subset for later authoritative setup validation without activating setup or publication.

## Results

Focused checks pass on the implementation working tree. `vitest run apps/web/lib/editor/social-links.test.ts` passes four behavior tests. Web and jobs TypeScript checks pass, changed source passes Biome, and `git diff --check HEAD` passes.

The real browser hook is `scripts/social-links-browser.mjs` exported as `checkSocialLinks`. The coordinator will wire and run it against the production component, signed sessions, real owner API, D1, and preview iframe. It checks email suggestion authority, both placements, stable order and IDs, raw kind/destination recovery after reload, explicit email consent, no duplicate email or automatic component, removal confirmation, keyboard navigation, and mobile width. This hook is not yet executed in this worker record.

The connected read-only Figma reference [Add an email link](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=330-371) supplies the explicit public-visibility copy, private contact recipient distinction, lime consent action, and 48-pixel controls. The editor control adapts these to the existing panel; production onboarding screen integration remains later work.

Owner phase completion approval remains pending. The coordinator owns combined browser verification, full-profile verification, separate authorization/privacy review, and integration. Production editor and onboarding activation remain later work.

## Documentation impact

The new opt-in account email suggestion and reusable link controls change the owner identity and editor contracts. The coordinator will update current authentication and draft guidance during integration. No historical evidence or roadmap approval is changed.
