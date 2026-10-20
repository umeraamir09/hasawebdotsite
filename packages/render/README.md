# Portfolio rendering

`@hasaweb/render` supplies bounded fragment serialization, document policy and generic unavailable output. It uses the shared [portfolio components](../components/README.md). Published HTML contains no React hydration. The separate `@hasaweb/render/offline` entry supplies full-document snapshots for local parity evidence only.

## Fragment boundary

`renderFragment(input, {assetOrigins})` accepts either `{kind: "profile", profile}` or `{kind: "component", component}` from the display-only model. It returns one of these results:

- `{status: "ready", html}` contains controlled, escaped static markup.
- `{status: "needs_partitioning"}` means input failed the accounting envelope. It may be oversized, too deep, cyclic, accessor-bearing or otherwise unsuitable for bounded traversal. No partial HTML is returned.
- `{status: "invalid"}` means bounded input failed its strict display schema or asset-origin policy.

The current envelope allows 256 traversed values, depth 32, 4,096 UTF-16 units per string and a 12,288-byte accounting budget. Accounting adds UTF-8 string bytes, key lengths plus four, and eight per scalar. It is not an exact serialized JSON byte bound. Before React serialization, the walk also reserves six bytes per accounted input byte, 512 bytes per traversed value and 24,576 fixed markup bytes under a 262,144-byte output budget. Actual output bytes are checked again.

These conservative guards are not measured CPU guarantees. A whole valid profile, component or nested list may exceed them. Do not truncate owner content, drop a rejected fragment, repeat list wrappers, or call the offline helper from a hot publication handler. Phase 24 must implement immutable revision-bound resumable preparation, Unicode-safe splitting, wrapper-preserving assembly and measured Queue/D1 batching. It must retest the final renderer against all CPU, request, D1, R2 and Queue allowances. S-1/S-8 restrictions and the 1 MiB content allowance remain unchanged.

## Document and response policy

`documentShell({markup, title, context, assets})` accepts trusted renderer markup and escapes the title. `assets.cssUrl` and `assets.scriptUrl` must be `/platform/` paths containing a content hash. Optional `assets.origin` is an exact trusted HTTP(S) origin, such as `https://assets.hasaweb.site`. It cannot contain a path, credentials or unsafe characters. Only renderer-generated HTML may supply `markup`.

`portfolioHeaders("preview", {assetOrigins, parentOrigin})` applies noindex, private/no-store, nosniff, no-referrer and restrictive permissions/CSP. The preview parent must be an exact origin; without it, embedding is denied. The caller owns authorization. The child needs no network connection for model messages. An enclosing editor host may require its own authenticated fetch/frame policy.

`portfolioHeaders("public", {assetOrigins})` retains the existing `public, max-age=0, must-revalidate` policy. It allows platform scripts, styles, fonts and images only at self and explicitly configured trusted asset origins. Inline scripts/styles, arbitrary frames, objects, form submission, base URLs and connections remain blocked. Later graph/contact/PDF integration must add only the capabilities it needs. These headers do not prove CDN/browser withdrawal.

`unavailableResponse()` returns a generic 404 HTML response with no owner data, no-store and noindex. Phase 25 must apply the policy to actual thin serving without importing React into visitor requests. It must stream retained files and verify the S-9 cache/withdrawal boundary before activation.

## Reproduce parity evidence

Run `pnpm test:renderer`. The script builds an isolated local fixture, starts Chromium, checks private fixture gating and compares client iframe rendering with static snapshots. It stops its browser/server afterward. Set `RENDERER_EVIDENCE` to a fresh directory to retain another run. Each standalone run defaults to a unique ignored `.wrangler/evidence/renderer-*` directory. Use the [renderer profile](../../docs/agent-workflow.md#choose-local-checks) for the local completion gate and shared resource lock.

`node scripts/portfolio-renderer-browser.mjs --serve` keeps the fixture at [port 8794](http://127.0.0.1:8794/published). This is synthetic owner content, not a product preview or publication. The Phase 17 editor and dormant authorized preview adapters have their own handoff fixture. Product editor activation, upload authorization, publication and onboarding Review remain later integrations.

See the [Phase 16 protocol](../../specs/2026-10-19-shared-portfolio-renderer/protocol.md) and [results](../../specs/2026-10-19-shared-portfolio-renderer/results.md).
