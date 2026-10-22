# Private upload storage

Owners can upload private image or resume bytes and read ready assets during setup or editing. The upload and crop controls remain Phase 19.

## Entry points and prerequisites

Run `pnpm verify --profile=uploads` for checks, builds and `scripts/private-uploads.mjs`. The suite starts its own fixture at port 8834. It uses the production web Worker, real D1/R2 and signed session cookies. Serialize it with all other heavy suites through the verification runner.

The fixture's browser File fetch and XMLHttpRequest calls prove browser framing through the HTTP handler. They do not prove a product upload button, crop dialog, provider-photo import, editor image display or publication.

## Read the evidence

The suite prints its unique evidence directory. Read `results.json` and `browser-framing.json`, or `failure.json` after a failure. The wrapper's verification directory records the source revision, working changes and command logs. Compare saved ready metadata with R2 bytes and the authorized GET response.

Require JPEG, PNG and WebP at exactly 5,242,880 bytes and PDFs at exactly 10,485,760 bytes to pass. Require each limit plus one, disguised media and interrupted uploads to fail. Check owner/session isolation, purpose/readiness resolution, post-write revocation, uncertain finalization and cleanup behavior separately. An inaccessible leftover after uncertain cleanup does not prove successful deletion.

## Remaining boundaries

`DRAFT_BUCKET` stays web-only. Local upload evidence does not authorize jobs source transfer or establish deployed CPU limits. Required setup and publication must use authoritative owned-ready-purpose checks when those services are implemented.
