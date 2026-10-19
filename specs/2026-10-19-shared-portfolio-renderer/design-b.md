# Candidate B. Structured React units with a bounded snapshot sink

Unselected exploration, retained as design evidence. The [selected design](design.md) supersedes the proposed APIs and implementation scope below.
## Usage

The editor host supplies authorized, schema-derived content and resolved assets. It mounts the same unit renderer that the snapshot host serializes.

```tsx
const model = portfolioModel({ content, assets, context: { kind: "preview" } });
root.render(<PortfolioPreview model={model} />);
const dispose = attachSiteInteractions(iframeDocument);
```

A local verification fixture compares the browser with a streamed snapshot. This is an offline convenience, never a hot publication handler.

```ts
const model = portfolioModel({ content, assets, context: { kind: "snapshot" } });
await writeFixtureSnapshot(model, outputStream);
```

Phase 24 resumes bounded prepared units for one immutable candidate revision. The publication owner persists cursors and private fragment objects.

```ts
const result = renderSnapshotBatch(preparedBatch, previousBoundary);
await candidate.putPart(result.partId, result.bytes);
await candidate.checkpoint(result.nextBoundary);
```

## Problem

Phase 16 needs real profile and optional component markup without activating publication or editor routing. `PublicContent` already excludes setup, recovery and samples. Asset IDs still require caller authorization. The component package currently only reexports schema definitions. S-1 rejects whole-page rendering and partitioning in one invocation. S-8 rejects unbatched dispatch. React streaming alone solves neither resumable preparation nor Free invocation CPU.

## Shape

Use structured render units. Each contains a bounded, balanced React leaf plus its ordered ancestor frames. A single shared component adapter constructs these units for both hosts. The browser joins units into React ancestors. The snapshot sink emits each ancestor once and serializes leaves through `renderToStaticMarkup`. Long text can continue inside the same paragraph, link and list item across fragment boundaries.

```ts
import type { PublicContent, ComponentType, ComponentOf } from "@hasaweb/schema";

type PortfolioContent = Pick<PublicContent,
	"schemaVersion" | "profile" | "links" | "components" | "appearance" | "seo">;
type AssetAvailability =
	| { kind: "ready"; url: SafeAssetUrl; width: number; height: number }
	| { kind: "missing" | "unavailable" };
interface PortfolioModel {
	readonly content: PortfolioContent;
	readonly assets: ReadonlyMap<string, AssetAvailability>;
	readonly context: { kind: "preview" | "snapshot" };
}
interface ReactFrame {
	readonly key: string;
	readonly shell: ReactElement;
}
interface RenderUnit {
	readonly key: string;
	readonly ancestors: readonly ReactFrame[];
	readonly leaf: ReactElement | string;
}
interface SnapshotBoundary {
	readonly rendererVersion: string;
	readonly openFrames: readonly EncodedFrame[];
	readonly nextOrdinal: number;
}
interface SnapshotBatchResult {
	readonly partId: string;
	readonly bytes: Uint8Array;
	readonly nextBoundary: SnapshotBoundary;
}
function portfolioModel(input: PortfolioModel): PortfolioModel;
function PortfolioPreview(props: { model: PortfolioModel }): ReactElement;
function renderSnapshotBatch(
	batch: PreparedUnitBatch, previous: SnapshotBoundary
): SnapshotBatchResult;
```

`SafeAssetUrl`, `PreparedUnitBatch`, `EncodedFrame` and boundary construction are opaque package types. The serializer accepts only a prepared batch created by the renderer boundary, never arbitrary React elements from messages. The batch carries renderer version, immutable content identity, ordinal and final-document status. Cursor and fragment replay must match these values. Each worker owns its own result.

`Render` adapters receive a bounded schema-derived selection, rather than copying component schemas. A selection identifies entry indices, rich-text paths and a Unicode-safe text range in the original content. Browser iteration may inspect the complete model. Publication preparation supplies bounded selections without rebuilding it.

```ts
type RenderAdapters = {
	[K in ComponentType]: {
		Render(input: ComponentSelection<ComponentOf<K>>, env: RenderEnvironment):
			readonly RenderUnit[];
	};
};
const adapters = { /* concrete implementations */ } satisfies RenderAdapters;
```

The schema registry remains the supported-type authority. The adapter map is exhaustive by mapped type. One internal dispatch function owns correlated union narrowing. Profile is fixed before adapters iterate saved component order. Social links read the shared link selection. No editor adapter is added prematurely.

### Bounded serialization

React frames are platform-authored shells containing exactly one trusted marker child. The sink renders a shell with `renderToStaticMarkup` and separates its opening and closing bytes at that marker. Owner strings never supply shell markup. Marker generation and extraction belong to the sink, with tests against the pinned React version. This avoids maintaining a second HTML escaping implementation.

The sink compares ancestor keys with the previous boundary, closes unmatched frames, opens new frames and serializes the bounded leaf. Serialized frame attributes are part of the work budget. An individual fragment may contain unclosed ancestors. Ordered byte assembly, rather than standalone parsing of fragments, forms the valid document. The last batch closes every frame. Boundaries retain bounded encoded frames, never owner-sized text.

Owner labels and image descriptions are text leaves. Image descriptions use `aria-labelledby` with a shared hidden text node, preventing an unlimited `alt` string from becoming an indivisible attribute. Native image alt is empty when the explicit accessible name is supplied. Destinations already have schema byte bounds and receive output-boundary validation. Platform-generated IDs, classes and labels are bounded. No arbitrary style, event-handler or raw HTML props are accepted.

Split text before React serialization at code-point boundaries, preserving surrogate pairs. Count UTF-8 input, escaped output, descendants, depth and frame bytes. Escaping expansion can require another split. Nested rich-text ancestors and link marks remain open across text pieces. Do not insert repeated paragraphs or duplicate list items. React adjacent-text separators are tested for semantic equivalence with browser output.

Phase 16 implements deterministic bounded unit serialization and fixtures. Phase 24 must implement resumable source scanning or revision-transactional normalized records, including large strings and deeply nested lists. A complete in-memory `PublicContent` parse remains an offline/browser convenience. Initial experimental limits follow S-1's 8 KiB and 64-node starting points, extended to descendants and output. These are test bounds, not production measurements.

### Hosts, assets and behavior

`packages/components/src/portfolio/` owns adapters, shared rich text, profile, asset markup and owner-data decoration markup. Its public subpath exports the model and preview. `packages/render/src/snapshot.ts` owns static serialization and boundary validation. `packages/render/src/preview.ts` owns the message parser and policy headers. `packages/render/src/site.ts` owns idempotent vanilla behavior. Package exports hide internal frame helpers.

The preview host authenticates before iframe creation. Its bridge pins origin, `event.source`, a per-mount nonce and increasing revision. It accepts bounded, size-checked messages after runtime validation and public-field projection. Larger updates use authenticated-host-driven bounded chunks with capped assembly and cancellation. Neither a nonce nor headers substitutes for authorization. Preview responses require no-store, noindex, restrictive CSP and a configured frame-ancestor origin. No product preview route is activated.

Asset resolution remains outside rendering. Ready URLs must pass a configured asset-origin/path policy. No URL is guessed from an ID. Reserved aspect boxes and delegated load/error behavior preserve geometry and announce failures. Snapshot fragments never contain private recipient configuration or recovery records. Unavailable public output accepts no owner model.

Leaf and DM Sans remain defaults. Versioned CSS, fonts and vanilla `site.js` are shared. Theme mode and native keyboard controls work in both hosts. Source-equivalent cat/hands CSS, trusted artwork and inline SVG use owner assets and neutral labels in new components. Original imported source remains unchanged. Reduced motion works now. Catalog controls, Face Reveal activation, independent playback, service contact/graph behavior and case-study/resume activation remain later work.

## Tradeoffs and alternatives

We accept structured ancestry bookkeeping and marker tests to retain React escaping and a single markup implementation. Model the Domain shaped the unit and boundary types. Boundary Discipline places message and URL checks at host/output entry points.

A token/event generator makes streaming straightforward but exposes tag sequencing to every renderer and duplicates React markup behavior. This candidate keeps tag nesting in structured ancestry. Whole-page React SSR has a smaller API but fails S-1. Independent balanced fragments duplicate wrappers and alter nested-list semantics. A custom intrinsic-element serializer hides more machinery but must independently match React escaping, void elements and attributes.

## Synthesis decision

Pending comparison with the other candidate.

## Risks and next step

Can the marker/frame path reproduce accessible names and nested lists across arbitrary boundaries under the pinned React version? Prove that with hostile Unicode and maximum-text fixtures first. Then implement the typed adapter map and shared preview. Phase 24 still gates CPU, Queue/D1 batching, transfer authorization, R2 operation costs and withdrawal. This candidate neither changes quotas nor proves that publication fits Free.

Documentation impact is limited to this candidate file. Selection must update architecture 9.2 and dependent phase protocols to describe structured units and bounded preparation accurately. Phase 16 remains unchecked until owner approval.
