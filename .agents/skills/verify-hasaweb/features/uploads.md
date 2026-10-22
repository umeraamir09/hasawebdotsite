# Private upload storage

Owners can upload private image or resume bytes and read ready assets during setup or editing. Shared avatar/banner upload and crop controls are exercised through the editor handoff fixture.

## Entry points and prerequisites

Run `pnpm verify --profile=uploads` for checks, builds and `scripts/private-uploads.mjs`. The suite starts its own fixture at port 8834. It uses the production web Worker, real D1/R2 and signed session cookies. Serialize it with all other heavy suites through the verification runner.

The upload suite's browser File fetch and XMLHttpRequest calls prove browser framing through the HTTP handler. The editor profile additionally drives shared image controls, crop dialogs, and private image preview. Provider-photo import and publication remain separate.

The editor suite also fails a private image load temporarily, then uses `Retry avatar preview` to load the same saved asset. Text-only name edits must update the iframe without repeating authenticated asset probes. Crop cancellation checks wait for the scheduled focus restoration before asserting the invoking control is focused.

Run `pnpm verify --profile=editor` to drive [the crop-control checks](../../../../scripts/crop-controls-browser.mjs) through the handoff fixture. Select a file with `Upload avatar` or `Replace avatar`, then use dialog `Adjust avatar`. Focus `Reposition image` and use arrow keys, adjust `Zoom`, and exercise `Reset`, `Apply crop`, and `Cancel`. The banner uses the same controls in `Adjust banner`. Require a ready upload, the persisted draft reference, the private image bytes, and the matching preview image. Cancellation and retry must preserve earlier ready bytes.

## Read the evidence

The suite prints its unique evidence directory. Read `results.json` and `browser-framing.json`, or `failure.json` after a failure. The wrapper's verification directory records the source revision, working changes and command logs. Compare saved ready metadata with R2 bytes and the authorized GET response.

Require JPEG, PNG and WebP at exactly 5,242,880 bytes and PDFs at exactly 10,485,760 bytes to pass. Require each limit plus one, disguised media and interrupted uploads to fail. Check owner/session isolation, purpose/readiness resolution, post-write revocation, uncertain finalization and cleanup behavior separately. An inaccessible leftover after uncertain cleanup does not prove successful deletion.

## Remaining boundaries

`DRAFT_BUCKET` stays web-only. Local upload evidence does not authorize jobs source transfer or establish deployed CPU limits. Required setup and publication must use authoritative owned-ready-purpose checks when those services are implemented.
