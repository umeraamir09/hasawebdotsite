# Recovery requests and quota boundary

Recovery adds browser orchestration around unchanged production draft/progress handlers. It introduces no D1 migration, whole-document save or new draft mutation action. Ordinary coalesced saves retain the Phase 14 protocol and costs.

A conflict review starts with pending metadata and one complete canonical read. Applying selections rechecks pending metadata and the complete canonical draft once more before any save. Checkbox changes and durable review/replacement records use browser storage only. Load newer version performs no canonical write. Selected changes use one patch or the existing bounded staging/commit/cleanup sequence, depending on shape. CAS protects a concurrent save after the recheck; another conflict requires another review.

Authentication recovery adds uncached owner status before local record access, plus the controller's canonical/pending initialization and explicit continuation checks. OAuth start/callback and persisted identity checks use the real auth handlers. Wrong accounts stop before opening the original record range or performing draft requests with that recovery. No fixed recovery-frequency assumption is inserted into the daily model.

## Measured local costs

The [final complete browser receipt](final-autosave/browser-results.json) records these complete scenarios. Counts include fixture provisioning, initial owner/draft/pending reads, deliberate competing saves or failures, and reload/review operations where exercised. They are scenario costs, not minimal per-conflict allowances.

| Scenario | Requests | D1 rows read | D1 rows written |
| --- | ---: | ---: | ---: |
| Selected review, unfinished input and reload | 21 | 357 | 6 |
| Changed revision, refreshed review and Load newer version | 16 | 148 | 4 |
| Selected setup content after permanent handoff | 13 | 200 | 5 |
| Separate sessions, same-field conflict and structural staging | 27 | 658 | 23 |
| Keyboard/axe review and confirmed newer load | 12 | 116 | 4 |
| Terminal receipt, lost cleanup reply and review reload | 33 | 495 | 14 |

The terminal receipt row uses a separate authenticated session in the final complete run. The earlier [focused cleanup receipt](terminal-browser/browser-results.json) retains its original same-session counts. The final row includes the competing staged save, failed stale patch, durable linked cleanup, reload and final selected patch. No uncertain command transfers sessions.

Using the observed complete-draft fixture action costs, an idle review followed by application adds two pending reads at four rows each and two canonical reads at twelve rows each. That is four requests, 32 D1 reads and no writes before the selected save. Confirmed Load newer version has no save write. A representative single patch adds 101 reads and one write, for a calculated five-request, 133-read, one-write review/application path. These calculations omit initial loading, competing writes, lost replies and staging. Larger/denser shapes retain the existing higher costs.

The [final auth/browser receipt](final-auth/evidence.json) records both provider recovery paths through real handlers. After each successful provider return, owner checking, controller draft/pending initialization, explicit continuation, direct receipt reconciliation and the confirmed patch cost six API requests, 81 rows read and one row written for the small auth fixture. The test's separate exact-value verification adds one read request and twelve rows, producing the observed seven-request, 93-read scenario. Callback reload with unfinished raw input costs three reads, 24 D1 rows and no writes; it does not repeat the patch. Wrong-account return stops after one uncached owner read, five observed rows and no writes, before any original-account draft access.

OAuth start itself costs one observed read and three written rows for persisted state. Successful original-account callbacks cost twenty reads and seven writes in this fixture. Cancelled/failed callbacks have different cleanup costs, recorded individually. Expired-session rejection also writes session cleanup. Do not treat those operations, the deliberate legacy fixture preparation, or test verification reads as free.

Fixture-only D1 instrumentation records rows read/written and queries without recording cookies or provider credentials. All values are local evidence, not production CPU measurements. Browser checkboxes, review checkpoints and continuation updates perform no D1 requests.

The Phase 14 [quota model](../2026-10-18-shared-autosave-recovery/quotas.md) and [CPU investigation](../2026-10-18-shared-autosave-recovery/performance.md) still apply. Maximum streamed reads cost 76 observed rows in the prior fixture; dense component scans and repeated large replacements can exceed Free capacity. Recovery fetches add that shape-dependent cost, so adapters must not poll full drafts or refetch after every ordinary acknowledgement.

No production draft-handler hot path changed. The server change is the fixed social sign-in destination allowlist. This phase makes no claim of equivalent deployed CPU performance. The initial KHI failure and intended-deployment/cold CPU prerequisite remain unresolved before owner-flow activation, as do shared publication dispatch and withdrawal budgets.
