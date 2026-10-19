# Selected renderer design

## Selection

Use candidate B's markup-only React components. The independent judge scored B 16/25 and A 14/25 on architecture adherence, privacy, scope, API size and evidence. Both candidates overbuilt Phase 24 preparation. Remove speculative marker-child extraction, continuation protocols and custom markup interpreters from this phase.

Graft candidate A's explicit public projection and smaller API. PublicContent is not a safe renderer transport because contact components can contain recipient configuration. Project only display fields and resolved asset states before iframe transport. The schema-derived component discriminant remains exhaustive.

## Contract

The named shape is `PortfolioModel`, derived from the canonical schema with explicit display-only component variants and asset availability. The model excludes contact recipient IDs, setup/progress/recovery data, samples, raw asset IDs and disabled second photos. Asset resolvers supply authorized ready locations. URL policy checks output at the boundary.

`packages/components` owns markup-only React functions, ordered registry adapters, rich text, owner-data avatar markup, default CSS and vanilla interactions. Shared markup has no hooks or event handlers. The browser mounts it client-side. An isolated fixture serializes that same tree with react-dom/server into static HTML and includes only platform CSS/JS.

`packages/render` owns document shell, strict preview/public response policies and bounded static fragment serialization. The production fragment boundary checks input strings, element count/depth and output size before returning a fragment. Oversized content requires future preparation, never silent truncation or a new owner content limit. A clearly separate offline fixture entry can render complete documents for parity checks. No whole-draft hot publication API is exposed.

The bridge pins parent window, exact origin and channel, validates incoming display data and rejects stale updates. It is not authentication. Product editor/Review integrations must authorize owner identity and assets before supplying content. Fixture-only routes exercise denied/other-owner access without entering production builds.

Only Leaf/DM Sans defaults, theme keyboard controls and stable image loading/error behavior activate here. Reusable cat/hands owner-data markup preserves source art/CSS and responsive geometry, exercised separately from saved decoration selection. Later phases activate appearance, Face Reveal, playback, graph/contact and additional-page services.

## Publication prerequisite

S-1 and S-8 remain controlling. Phase 24 must prepare bounded revision-bound input without whole-document hot parsing, split large Unicode text and nested rich-text wrappers without duplication, measure real components and asset descriptions, and validate Queue/D1 batching, CPU, quotas, transfer and assembly. A bounded fragment helper is not proof that every valid component fits one fragment or that the publication pipeline is feasible. Fixture parity does not waive these prerequisites.
