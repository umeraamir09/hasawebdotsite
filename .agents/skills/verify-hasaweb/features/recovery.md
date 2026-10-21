# Draft saving and recovery

Owners keep edits across autosave, interruptions, reloads, conflicts and same-tab reauthentication, with explicit review before replacing current saved content.

## Sub-features

- `recovery-save` persists valid edits and restores the same values after reload.
- `recovery-input` preserves raw invalid input separately from the saved draft.
- `recovery-conflict` applies explicitly selected local changes against the current draft.
- `recovery-auth` continues through fixed success/error callback routes and rejects a different account.
- `recovery-staging` resumes a known interrupted save or explicitly discards unknown staging.

## How to get to it (user POV)

- Edit in the isolated autosave/editor fixture, wait for save status, then reload.
- Use `Restore input`, `Resume save`, `Discard staged save` and its `Confirm` action when offered.
- Choose changes in recovery review and select `Apply selected changes`.
- Sign in again from recovery; return in the same tab to `/auth/recovery` or `/auth/recovery/error`, then choose `Continue preserved edits` or `Reopen review` when offered.

## Driving it with Playwright and the auth suite

Preconditions: `pnpm verify --profile=drafts` builds and runs draft HTTP, autosave and editor fixtures, including their seeded owners and durable browser journals. For actual reauthentication callback/cancellation/wrong-account paths also run `pnpm verify --profile=auth` sequentially. That profile owns provider fixtures and runs the draft suites too.

- Use the existing `scripts/autosave-browser.mjs` recipe for `getByRole("button", { name: "Restore input" })`, `Resume save`, `Discard staged save` and exact `Confirm`. Assert reloaded field values and D1 revision/content, not only a Saved message.
- Use `scripts/editor-browser.mjs` for labeled `Name`, `Bio`, `Location` and `Email me` fields. Select the offered change checkboxes and click `getByRole("button", { name: "Apply selected changes", exact: true })`. Require selected values in the resulting controls and persisted draft, with unselected current values preserved.
- The `scripts/auth-ui-browser.mjs` recipe drives the real fixed callback routes. Require `Continue preserved edits`/`Reopen review` only for matching stored continuation state. Cancellation remains on `/auth/recovery/error` with retry; a different owner sees `different account or portfolio` and cannot load the original record.
- Read the selected profile's command logs, `editor-results.json`, `editor-failure.json` when present, auth browser report and the draft/autosave reports in suite evidence. Check each reported action against its assertion before claiming complete UI coverage; some low-level cases invoke controllers directly.

## Gotchas

- Directly opening `/auth/recovery` in the empty entry helper lacks a continuation and authenticated matching owner. It cannot prove preserved-edit restoration. Record that missing precondition if this is attempted.
- Fixtures create the journals, interrupted attempts and changed-base conditions. Never bypass explicit continuation/review by injecting the desired result into application state.
- Unknown staged content without its original journal requires explicit discard or the original browser. A successful ordinary save is not evidence for this case.
- Production guide integration remains pending; fixture recovery does not certify that future entry point.
