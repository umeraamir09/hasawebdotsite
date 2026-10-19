# Portfolio components

`@hasaweb/components` contains markup-only React components shared by client preview and static snapshot output. Schema contracts remain in `@hasaweb/schema`. The fixed profile precedes optional components in their saved order. Stable component IDs remain in `data-component-id` for later editor selection.

`projectPortfolio(draft, options)` accepts an already validated `DraftDoc`. Its `resolveAsset({assetId, purpose})` callback returns an authorized ready absolute URL or `{state: "unavailable"}`. `assetOrigins` contains exact trusted origins. The caller must check owner, asset purpose, readiness and applicable access before resolving. Missing references remain missing; untrusted URLs become unavailable. IDs never become guessed storage paths.

The resulting `PortfolioModel` includes display fields only. Display strings normalize CRLF/CR to LF and replace NUL/unpaired surrogates with the replacement character. This makes browser DOM and HTML parsing agree while leaving the saved draft unchanged. The bridge parser and bounded static entry apply the same normalization. It omits recipient configuration, private graph consent, raw asset IDs, disabled second photos, setup/address/recovery data and untouched samples. It preserves the selected GitHub username while reporting its graph unavailable. Projects, skills, experience, text and shared link placements render their entered content. Additional pages, service contact/graphs, saved appearance/decorations and Face Reveal activate in their later roadmap phases. Projection does not establish publication readiness.

`Portfolio`, `PortfolioProfile`, `PortfolioSection` and `RichText` render controlled markup without hooks or event handlers. Links use the schema's safe-destination rules. Owner text stays literal. Missing required fields and unavailable services have visible messages. Optional absent project images do not create image slots. The source text heading levels remain relative to the component heading.

## Browser adapter

`@hasaweb/components/browser` exports `mountPreview(element, model, {assetOrigins})`, returning `update(unknown): boolean` and `dispose()`. Invalid updates return false without replacing the displayed content. Dispose releases React, image and theme listeners.

`attachPreviewBridge({target, parentWindow, parentOrigin, channel, assetOrigins})` returns a detach function. It accepts `{channel, revision, model}` messages only from that window and exact origin, with a matching channel and increasing safe-integer revision. This revision is a per-mount render sequence, not the saved draft CAS revision; local edits need new sequence values before autosave completes. It validates strict display schemas and asset origins. Detach the listener and dispose the mount when its owner changes. The bridge provides no authentication. The host must authorize owner access before serving private routes/models/assets and preserve noindex/no-store policies.

The current message envelope permits 250,000 traversed values, depth 64, strings up to 1,048,576 UTF-16 units and a 2,097,152-byte accounting budget. Accounting includes UTF-8 string bytes, key lengths and fixed scalar overhead. It is not an exact JSON byte measurement. Projection can expand small asset references into longer URLs. Phase 17 must handle rejected updates honestly and add bounded chunking/cancellation before supporting model expansion beyond this envelope. These transport bounds do not change the 1 MiB owner draft allowance.

## Platform files

`@hasaweb/components/styles.css` imports source-equivalent avatar CSS and generated default Leaf tokens. It uses the catalog's original DM Sans font, system mode and explicit visitor choice. `@hasaweb/components/site-entry` bundles the standalone vanilla script for snapshots. Browser mounts install the same behavior for native theme controls and reserved image loading/error slots. The theme button names its next action, `Dark mode` or `Light mode`, without a pressed state. Storage failure preserves the current-page toggle. No visitor cookies or tracking are added.

`static/manifest.json` maps the approved clean cat loop/still and original font files to content-hashed URLs. Keep the SIL OFL notice with font distribution. Bundle CSS imports into a content-hashed stylesheet, bundle the public script separately, and retain their old bytes with each renderer version. Actual asset promotion and retention remain Phase 24.

`PortfolioAvatar({asset, decoration})` supports explicit `none`, `cat` and `hands` specimens with owner-data images. Portfolio projection currently uses `none`; later appearance phases activate saved selections. The original source React component is unchanged. Run `pnpm generate:renderer-assets` to derive the shared SVG markup, namespaced CSS, token file and manifest from those sources. This copies the source clean cat bytes and does not rerun or weaken its failed regeneration guard. The wrapper maps renderer palette variables into source avatar variables so dark mode uses the correct surfaces. The source portrait wrapper owns the border and corner clipping. Its nested image slot adds neither, preserving actual image bounds and offsets during loading, success and failure.

See the [renderer contract](../render/README.md) and [Phase 16 evidence](../../specs/2026-10-19-shared-portfolio-renderer/results.md).
