# Historical receipt recovery regression

The independent address boundary review reproduced a false Saved state on October 21, 2026. The reviewed controller source had SHA256 `6d69879dddd56ac26743a733b9482a07ebe5c7135f6183605f16101fb2dbc18b`. A confirmation committed revision 1, but its reply was lost. Another device then replaced the hold at revision 2. Same-tab Retry accepted the exact historical receipt for revision 1 without reading the current draft.

The observed failing output was:

```json
{"canonicalRevision":2,"canonicalName":"second-device-name","controllerRevision":1,"controllerName":"first-device-name","status":"saved","error":null,"reads":1,"addressCalls":2,"batch":null}
```

The receipt proves the original command committed. It does not prove that its name remains the current reservation. The controller now reads the current draft before accepting a replayed receipt. A mismatching revision or draft enters the existing revision-conflict state and preserves the immutable journal and raw input. String equality alone never establishes a reservation.

Run the [controller reproduction](receipt-recovery-repro.mjs) from the repository root:

```sh
node specs/2026-10-21-address-reservations/receipt-recovery-repro.mjs
```

The reproduction bundles the real controller and scripts only transport/storage. It prints the observed state before checking the conflict and retained input. It fails against the reviewed implementation. This is controller evidence, not database or browser proof.

The same-tab and reload cases in [the autosave browser suite](../../scripts/autosave-browser.mjs) use the real owner API and persisted D1 receipts. They inject one lost response, confirm a second name through HTTP, retry the original journal, and require the newer canonical name and hold to survive. [The editor suite](../../scripts/editor-browser.mjs) separately drives local typing and explicit Save address through accessible controls, reload, keyboard submission, and a mobile viewport. Production editor activation and publication remain deferred.

## Address reads during prepared recovery

The October 22 editor run at `.wrangler/verification/2026-10-22T03-16-16.017Z-m8aKeD` passed the address, preview, editing, and ordinary restoration cases, then failed prepared restoration. Its `editor-failure.json` recorded `errors: ["recovery_required"]`, and the restoration result was `failure` where `success` was required. The new address registry effect ran while the replacement controller was paused. `addressState()` synchronously threw before returning the promise on which the effect had installed its rejection handler, so the error escaped into React.

The controller's address-read methods now use async adapters. Guarded paused/disposed failures reject their promised result, which the existing effect catches. The controller regression requires paused state and availability reads to reject with `recovery_required`, and the browser's prepared-restoration cases verify that the editor survives recovery and remains usable.
