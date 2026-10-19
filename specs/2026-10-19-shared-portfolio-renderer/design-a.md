# Candidate A. One markup event stream

Unselected exploration, retained as design evidence. The [selected design](design.md) supersedes the proposed APIs and implementation scope below.
## Usage

```ts
// An authenticated browser host owns the iframe and its asset authorization.
const content = portfolioContent(validDraft, resolvedAssets);
preview.update({ revision: savedRevision, content });

// Phase 16 local static fixture. No product publication endpoint.
const html = renderFixtureDocument(content);

// Proposed Phase 24 integration. Prepared slices never contain a whole draft.
const result = renderSnapshotSlice(preparedSlice);
await candidateStore.put(result.sequence, result.bytes);
```

`portfolioContent` projects the validated draft into renderer data. Both hosts consume the same events. The browser builds DOM nodes. The snapshot host encodes HTML bytes. No React enters either output.

## Problem

The component package currently reexports schema definitions. The render package has no implementation. [Architecture 9.2](../../docs/architecture.md#92-rendering-model) plans React components, while [S-1](../2026-10-15-publish-render/results.md) rejects whole-page rendering at the existing content ceiling. This candidate proposes typed markup components instead of React components. That is an explicit architecture change requiring current guidance updates if selected. It preserves browser rendering and equivalent static output without making oversized React subtrees a publication unit.

## Shape

The named data shape is `PortfolioContent`. Its owner text and ordering derive from the schema. Asset and service availability are explicit inputs. The renderer never receives the draft, provisioning progress, recipient IDs, publication credentials or recovery records.

```ts
import type { PublicContent, ComponentType, ComponentOf } from '@hasaweb/schema';

type ImageState =
	| { state: 'ready'; src: SafeAssetUrl; width: number; height: number; alt: string }
	| { state: 'missing' | 'unavailable'; alt: string };

type DisplayProfile = Pick<PublicContent['profile'], 'name' | 'bio' | 'location'> & {
	avatar: ImageState;
	banner: ImageState;
	decoration: 'none' | 'cat' | 'hands';
};

type DisplayComponent<K extends ComponentType> = {
	[T in K]: { id: string; type: T; data: PublicData<T> }
}[K];

type PortfolioContent = {
	profile: DisplayProfile;
	links: readonly DisplayLink[];
	components: readonly DisplayComponent<ComponentType>[];
	appearance: PublicContent['appearance'];
};

type AdapterMap = {
	[K in ComponentType]: {
		project(data: ComponentOf<K>['data'], assets: ResolvedAssets): PublicData<K>;
		markup(data: PublicData<K>, context: MarkupContext): Iterable<MarkupEvent>;
	};
};
```

`PublicData` is a mapped discriminated union. Ordinary fields use schema indexed types. Projects replace image references with `ImageState` and omit case-study bodies. Resume exposes an unavailable status until its later integration. Contact exposes an unavailable status and omits its entire data object. GitHub exposes username and unavailable status, without authorization or cached graph data. `DisplayLink` preserves schema label and placement flags but replaces destination with an optional checked `SafeHref`. No raw destinations remain.

`adapters satisfies AdapterMap` requires every schema registry key. The registry remains the sole list of component types. It provides fixed profile markup first, followed by saved optional-component order. Empty values produce short honest missing states. It never inserts samples or treats missing service data as successful availability.

The public package exports only projection and host entry points. The following events and continuation types remain private.

```ts
type MarkupEvent =
	| { kind: 'open'; tag: AllowedTag; attrs: SafeAttributes }
	| { kind: 'text'; value: string }
	| { kind: 'close'; tag: AllowedTag }
	| { kind: 'void'; tag: 'img' | 'source' | 'meta' | 'link'; attrs: SafeAttributes };

type SnapshotSlice = {
	version: 1;
	sequence: number;
	events: readonly MarkupEvent[];
	before: StackDigest;
	after: StackDigest;
	final: boolean;
};

declare function portfolioContent(
	draft: ValidatedDraft,
	assets: ResolvedAssets,
): PortfolioContent;

declare function snapshotSlices(content: PortfolioContent): Iterable<PreparedSlice>;
declare function renderSnapshotSlice(slice: PreparedSlice): RenderedSlice;
declare function mountPreview(root: HTMLElement): PreviewHandle;
declare function renderFixtureDocument(content: PortfolioContent): string;
```

`ValidatedDraft` represents the existing validated revision boundary, not another whole-document parse inside rendering. `snapshotSlices` lazily walks already-resident browser or offline fixture content and yields opaque bounded units. `renderSnapshotSlice` accepts only those units. Both functions are feasible in Phase 16. Static fixture rendering joins their output. Production use stays gated until Phase 24 supplies resumable preparation tied to an immutable revision. A whole-document input already in memory does not prove bounded preparation. Persisted-unit decoding remains a Phase 24 integration requirement.

## Modules and ownership

- `packages/components/src/portfolio.ts` owns `PortfolioContent`, projection, schema-keyed adapters and markup events. `rich-text.ts` owns an iterative walker with a stack and text offset. `avatar.ts` owns reusable owner-data decoration markup.
- `packages/render/src/snapshot.ts` owns bounded slice creation, escaping, HTML encoding, continuation checks and document shell constants.
- `packages/render/src/browser.ts` owns DOM creation, replacement cancellation and the preview bridge. It consumes the same markup components without a second template implementation.
- `packages/render/src/site.ts` owns the public theme and image-state behavior. `styles.css` owns responsive layout, focus and decoration rules. Export maps expose supported entry points only.

Model the Domain motivates the event union and registry completeness check. Boundary Discipline places URL checking, slice construction and message validation at entry points. Adapters trust the resulting values.

## Snapshot and preview contracts

The event walker suspends inside text or nested lists. Its private continuation records schema path, traversal stack, scalar-safe string offset and renderer version. It never repeats section wrappers. A slice may end inside a paragraph, link or nested list. Fragments are ordered byte segments, never independently parsed HTML documents. Streaming concatenation reconstructs one valid document with balanced wrappers.

Bound slices by input bytes, total events, stack depth and encoded output bytes together. Split oversized text by Unicode scalar boundaries before escaping. Never split an HTML entity or UTF-8 scalar between rendered slices. Fixed attributes must also obey output limits. Rejected destinations become plain text; long valid owner labels remain content.

Phase 24 must implement resumable JSON scanning with decoder carry and bounded parser state, or transactional revision-bound prepared records. It cannot obtain slices by parsing or walking the full draft in a hot invocation. Persist deterministic sequence keys and verify continuation digests on retry. Assembly streams ordered objects with bounded fan-in. Initial S-1 bounds remain experimental. Queue/D1 batching, CPU, quotas, source-asset transfer and withdrawal remain unproven prerequisites.

The iframe receives bounded `begin`, sequenced `chunk` and `commit` messages with protocol version, revision and channel nonce. Enforce exact parent origin, `event.source`, bounded schema and aggregate bytes. Replace an unfinished revision when a newer revision begins. Build into a detached fragment, then commit atomically. Ignore stale acknowledgments. The parent owns authentication, expected origin, iframe URL and teardown. No product draft route appears in this phase.

## Safety and defaults

`SafeHref` accepts checked HTTP(S) and explicit email destinations. Reject credentials, control characters, protocol-relative, script and data URLs. `SafeAssetUrl` accepts only caller-authorized asset origins and paths; it never constructs URLs from IDs. Asset projection checks availability supplied by the authorized resolver. HTML encoding escapes text and attributes separately. Browser rendering uses `createElement`, `textContent` and checked attributes, never `innerHTML`.

Preview documents use no-store, noindex, nosniff, a restrictive CSP and a configured `frame-ancestors` parent. Public unavailable documents carry no owner content. External CSS, script and fonts use immutable content hashes. Theme initialization uses a fixed hashed bootstrap. Leaf and DM Sans are the defaults, with system mode, visible focus and reduced motion.

Owner-data avatar markup reuses the original SVG paths, clean cat assets, keyframes, loading geometry and 124/104 pixel envelope. Source React files remain byte-identical. Decoration markup has no fixed source identity or reveal button. Face Reveal, catalog controls, independent playback, contact sending, graphs and resume/case-study pages retain their later gates.

## Tradeoffs and alternatives

We accept a small typed HTML encoder and DOM adapter to gain resumable wrapper-preserving output. Whole-component React rendering hides serialization but exposes oversized subtree partitioning to publication callers. Converting schema data separately into browser and server templates duplicates policy and loses parity.

Synthesis remains the lead's decision. Before implementation, compare this explicit departure from planned React against the other candidate. Verification must compare complete assembled DOM, escaping, nested Unicode fixtures, bridge rejections and source decoration geometry. The first implementation unit is one nested text fixture rendered through both hosts.

## Documentation impact

If selected, update architecture 9.2's React assumption, component package guidance, renderer baseline and Phase 24 preparation prerequisites. Preserve S-1/S-8 evidence and the unchecked Phase 16 approval gate. No CPU or publication feasibility claim follows from this design.
