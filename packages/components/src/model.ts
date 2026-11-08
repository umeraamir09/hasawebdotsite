import {
  type AssetPurpose,
  type CaseStudyDocument,
  type ComponentOf,
  type ComponentType,
  caseStudyPath,
  caseStudyRichTextContentSchema,
  componentRegistry,
  DRAFT_MAX_BYTES,
  type DraftDoc,
  draftWebUrlSchema,
  idSchema,
  isSafeLink,
  isWebUrl,
  profileSchema,
  richTextContentSchema,
  URL_MAX_BYTES,
} from "@hasaweb/schema";
import { z } from "zod";
import {
  appearanceModelSchema,
  decorationModelSchema,
  displayAppearance,
  displayDecoration,
} from "./appearance";
import { pagePathSchema } from "./frames";
import { GRAPH_MAX_DAYS, validGraphDays } from "./graph";
import { yieldPreviewTask } from "./preview-task";

export const assetSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("missing") }),
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({
    state: z.literal("ready"),
    url: z.string().refine(isWebUrl),
    alt: z.string(),
  }),
]);
export type DisplayAsset = z.infer<typeof assetSchema>;
// A published or privately previewed resume PDF. `url` downloads the file;
// `viewUrl` serves the same bytes for embedded viewing on /resume.
export const fileSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("missing") }),
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({
    state: z.literal("ready"),
    url: z.string().refine(isWebUrl),
    viewUrl: z.string().refine(isWebUrl),
  }),
]);
export type DisplayFile = z.infer<typeof fileSchema>;
const linkSchema = z.strictObject({
  label: z.string(),
  href: z.string().refine(isSafeLink),
});
type ProjectDisplay = Omit<
  ComponentOf<"projects">["data"]["entries"][number],
  "id" | "image" | "caseStudy"
> & { image: DisplayAsset; caseStudyPath?: string | undefined };
export const projectModelSchema = z.strictObject({
  title: z.string(),
  summary: z.string(),
  technologies: z.array(z.string()),
  contribution: z.string(),
  codeUrl: draftWebUrlSchema.optional(),
  demoUrl: draftWebUrlSchema.optional(),
  image: assetSchema,
  caseStudyPath: pagePathSchema.optional(),
}) satisfies z.ZodType<ProjectDisplay>;
const { id: _workId, ...workFields } =
  componentRegistry["work-experience"].schema.shape.entries.element.shape;
const workSchema = z.strictObject(workFields);
const identity = { id: idSchema };
// The graph a section can show. `ready` carries preview data the owner
// already fetched. `live` is the published placeholder that the visitor's
// browser fills from the graph endpoint. Anything else is unavailable.
const graphModelSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({ state: z.literal("live") }),
  z.strictObject({
    state: z.literal("ready"),
    fetchedAt: z.string().max(64),
    days: z
      .array(z.strictObject({ date: z.string().max(10), count: z.number() }))
      .min(1)
      .max(GRAPH_MAX_DAYS),
  }),
]);
export type GraphModel = z.infer<typeof graphModelSchema>;
const schemas = {
  projects: z.strictObject({
    ...identity,
    type: z.literal("projects"),
    data: z.strictObject({ entries: z.array(projectModelSchema) }),
  }),
  skills: z.strictObject({
    ...identity,
    type: z.literal("skills"),
    data: z.strictObject({
      groups: z.array(
        z.strictObject({ name: z.string(), skills: z.array(z.string()) }),
      ),
    }),
  }),
  "work-experience": z.strictObject({
    ...identity,
    type: z.literal("work-experience"),
    data: z.strictObject({ entries: z.array(workSchema) }),
  }),
  text: z.strictObject({
    ...identity,
    type: z.literal("text"),
    data: componentRegistry.text.schema.extend({ body: richTextContentSchema }),
  }),
  "social-links": z.strictObject({
    ...identity,
    type: z.literal("social-links"),
    data: z.strictObject({ links: z.array(linkSchema) }),
  }),
  github: z.strictObject({
    ...identity,
    type: z.literal("github"),
    data: z.strictObject({
      username: componentRegistry.github.schema.shape.username,
      graph: graphModelSchema,
    }),
  }),
  contact: z.strictObject({
    ...identity,
    type: z.literal("contact"),
    data: z.strictObject({ available: z.literal(false) }),
  }),
  resume: z.strictObject({
    ...identity,
    type: z.literal("resume"),
    data: z.strictObject({ file: fileSchema }),
  }),
} satisfies Record<ComponentType, z.ZodType>;
export const componentModelSchema = z.discriminatedUnion("type", [
  schemas.projects,
  schemas.skills,
  schemas["work-experience"],
  schemas.text,
  schemas["social-links"],
  schemas.github,
  schemas.contact,
  schemas.resume,
]);
export const profileModelSchema = profileSchema
  .pick({ name: true, bio: true, location: true })
  .extend({
    avatar: assetSchema,
    banner: assetSchema,
    // Absent means no decoration, the draft default.
    decoration: decorationModelSchema.default("none"),
    // Present only while Face Reveal is enabled. A disabled second photo
    // stays private in the draft and never reaches the display model.
    faceReveal: z.strictObject({ image: assetSchema }).optional(),
    links: z.array(linkSchema),
  });
export const portfolioModelSchema = z.strictObject({
  profile: profileModelSchema,
  components: z.array(componentModelSchema),
  // Absent means the approved defaults (Leaf, DM Sans, system).
  appearance: appearanceModelSchema.optional(),
});
export type PortfolioModel = z.infer<typeof portfolioModelSchema>;
export type ProfileModel = PortfolioModel["profile"];
export type ComponentModel = PortfolioModel["components"][number];
export type ProjectionOptions = {
  resolveAsset: (asset: {
    assetId: string;
    purpose: AssetPurpose;
  }) =>
    | { state: "ready"; url: string; viewUrl?: string | undefined }
    | { state: "unavailable" };
  assetOrigins: readonly string[];
  // Absent: no graph data. `live`: the published placeholder. Otherwise the
  // owner-authorized fetch for one username, shown only when it matches.
  graph?: "live" | GraphPreview | null | undefined;
};
export type GraphPreview = {
  username: string;
  fetchedAt: string;
  days: { date: string; count: number }[];
};

function trustedUrl(value: string | undefined, options: ProjectionOptions) {
  return (
    value !== undefined &&
    isWebUrl(value) &&
    options.assetOrigins.includes(new URL(value).origin)
  );
}
function resolveFile(
  reference: { assetId: string } | undefined,
  options: ProjectionOptions,
): DisplayFile {
  if (!reference) return { state: "missing" };
  const resolved = options.resolveAsset({
    assetId: reference.assetId,
    purpose: "resume",
  });
  if (resolved.state !== "ready") return { state: "unavailable" };
  const viewUrl = resolved.viewUrl ?? resolved.url;
  if (!trustedUrl(resolved.url, options) || !trustedUrl(viewUrl, options))
    return { state: "unavailable" };
  return { state: "ready", url: resolved.url, viewUrl };
}
/** Owner-supplied asset URLs in a display model, for origin rechecks. */
export function modelAssetUrls(
  components: readonly ComponentModel[],
): string[] {
  return components.flatMap((component) =>
    component.type === "projects"
      ? component.data.entries.flatMap((entry) =>
          entry.image.state === "ready" ? [entry.image.url] : [],
        )
      : component.type === "resume" && component.data.file.state === "ready"
        ? [component.data.file.url, component.data.file.viewUrl]
        : [],
  );
}

// Every ready profile image URL, including the enabled Face Reveal photo.
export function profileAssetUrls(profile: ProfileModel): string[] {
  return [profile.avatar, profile.banner, profile.faceReveal?.image].flatMap(
    (image) => (image?.state === "ready" ? [image.url] : []),
  );
}

function resolveImage(
  reference: { assetId: string; alt?: string | undefined } | undefined,
  purpose: AssetPurpose,
  options: ProjectionOptions,
): DisplayAsset {
  if (!reference) return { state: "missing" };
  const resolved = options.resolveAsset({
    assetId: reference.assetId,
    purpose,
  });
  if (
    resolved.state !== "ready" ||
    !isWebUrl(resolved.url) ||
    !options.assetOrigins.includes(new URL(resolved.url).origin)
  )
    return { state: "unavailable" };
  return { state: "ready", url: resolved.url, alt: reference.alt ?? "" };
}

type Adapters = {
  [K in ComponentType]: (
    component: ComponentOf<K>,
    draft: DraftDoc,
    options: ProjectionOptions,
  ) => Generator<void, Extract<ComponentModel, { type: K }>>;
};
function* mapRows<T, U>(
  rows: readonly T[],
  map: (row: T) => U,
): Generator<void, U[]> {
  const result: U[] = [];
  for (const row of rows) {
    yield;
    result.push(map(row));
  }
  return result;
}
const adapters = {
  *projects({ id, data }, _draft, options) {
    const entries = yield* mapRows(
      data.entries,
      ({
        title,
        summary,
        technologies,
        contribution,
        codeUrl,
        demoUrl,
        image,
        caseStudy,
      }) => ({
        title,
        summary,
        technologies,
        contribution,
        ...(codeUrl ? { codeUrl } : {}),
        ...(demoUrl ? { demoUrl } : {}),
        image: resolveImage(image, "project", options),
        ...(caseStudy ? { caseStudyPath: caseStudyPath(caseStudy.slug) } : {}),
      }),
    );
    return { id, type: "projects", data: { entries } };
  },
  *skills({ id, data }) {
    const groups = yield* mapRows(data.categories, (category) => ({
      name: category.name,
      skills: [] as string[],
    }));
    const byId = new Map<string, { name: string; skills: string[] }>();
    for (let i = 0; i < data.categories.length; i++) {
      yield;
      const category = data.categories[i];
      const group = groups[i];
      if (category && group) byId.set(category.id, group);
    }
    const ungrouped = { name: "", skills: [] as string[] };
    groups.push(ungrouped);
    for (const entry of data.entries) {
      yield;
      const group = entry.categoryId ? byId.get(entry.categoryId) : ungrouped;
      group?.skills.push(entry.name);
    }
    const visible = [];
    for (const group of groups) {
      yield;
      if (group.skills.length) visible.push(group);
    }
    return { id, type: "skills", data: { groups: visible } };
  },
  *"work-experience"({ id, data }) {
    const entries = yield* mapRows(
      data.entries,
      ({
        role,
        organization,
        startDate,
        endDate,
        current,
        description,
        organizationUrl,
      }) => ({
        role,
        organization,
        startDate,
        current,
        description,
        ...(endDate !== undefined ? { endDate } : {}),
        ...(organizationUrl !== undefined ? { organizationUrl } : {}),
      }),
    );
    return { id, type: "work-experience", data: { entries } };
  },
  *text({ id, data }) {
    yield;
    return { id, type: "text", data: { title: data.title, body: data.body } };
  },
  *"social-links"(component, draft) {
    return {
      id: component.id,
      type: "social-links",
      data: {
        links: yield* displayLinks(draft.links, "showInSocialComponent"),
      },
    };
  },
  *github(component, _draft, options) {
    yield;
    const source = options.graph;
    const graph: GraphModel =
      source === "live"
        ? { state: "live" }
        : source &&
            source.username.toLowerCase() ===
              component.data.username.toLowerCase() &&
            validGraphDays(source.days)
          ? { state: "ready", fetchedAt: source.fetchedAt, days: source.days }
          : { state: "unavailable" };
    return {
      id: component.id,
      type: "github",
      data: { username: component.data.username, graph },
    };
  },
  *contact(component) {
    yield;
    return { id: component.id, type: "contact", data: { available: false } };
  },
  *resume(component, _draft, options) {
    yield;
    return {
      id: component.id,
      type: "resume",
      data: { file: resolveFile(component.data.file, options) },
    };
  },
} satisfies Adapters;
function* displayLinks(
  links: DraftDoc["links"],
  flag: "showInProfile" | "showInSocialComponent",
): Generator<void, ProfileModel["links"]> {
  const result: ProfileModel["links"] = [];
  for (const link of links) {
    yield;
    if (!link[flag]) continue;
    const href = link.kind === "email" ? `mailto:${link.value}` : link.value;
    if (isSafeLink(href))
      result.push({
        label: link.label || (link.kind === "email" ? "Email" : "Link"),
        href,
      });
  }
  return result;
}
function* projectSteps(
  draft: DraftDoc,
  options: ProjectionOptions,
): Generator<void, PortfolioModel> {
  const components: ComponentModel[] = [];
  for (const component of draft.components) {
    yield;
    if (draft.samples[`components.${component.id}`]) continue;
    switch (component.type) {
      case "projects":
        components.push(yield* adapters.projects(component, draft, options));
        break;
      case "skills":
        components.push(yield* adapters.skills(component));
        break;
      case "work-experience":
        components.push(yield* adapters["work-experience"](component));
        break;
      case "text":
        components.push(yield* adapters.text(component));
        break;
      case "social-links":
        components.push(yield* adapters["social-links"](component, draft));
        break;
      case "github":
        components.push(yield* adapters.github(component, draft, options));
        break;
      case "contact":
        components.push(yield* adapters.contact(component));
        break;
      case "resume":
        components.push(yield* adapters.resume(component, draft, options));
        break;
      default: {
        const exhaustive: never = component;
        return exhaustive;
      }
    }
  }
  return {
    profile: {
      name: draft.samples["profile.name"] ? "" : draft.profile.name,
      bio: draft.samples["profile.bio"] ? "" : draft.profile.bio,
      ...(draft.profile.location !== undefined
        ? { location: draft.profile.location }
        : {}),
      avatar: resolveImage(
        draft.samples["profile.avatar"] ? undefined : draft.profile.avatar,
        "avatar",
        options,
      ),
      banner: resolveImage(
        draft.samples["profile.banner"] ? undefined : draft.profile.banner,
        "banner",
        options,
      ),
      decoration: displayDecoration(draft.profile.decorationId),
      ...(draft.profile.faceReveal.enabled
        ? {
            faceReveal: {
              image: resolveImage(
                draft.profile.faceReveal.image,
                "face",
                options,
              ),
            },
          }
        : {}),
      links: yield* displayLinks(draft.links, "showInProfile"),
    },
    components,
    appearance: displayAppearance(draft.appearance),
  };
}
export function projectPortfolio(
  draft: DraftDoc,
  options: ProjectionOptions,
): PortfolioModel {
  const steps = projectSteps(draft, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return normalizeDisplayStrings(step.value);
}
export async function projectPortfolioCancellable(
  draft: DraftDoc,
  options: ProjectionOptions,
  signal: AbortSignal,
): Promise<PortfolioModel> {
  const steps = projectSteps(draft, options);
  let step = steps.next();
  let nodes = 0;
  while (!step.done) {
    if (++nodes % 256 === 0) {
      await yieldPreviewTask();
      signal.throwIfAborted();
    }
    step = steps.next();
  }
  signal.throwIfAborted();
  return step.value;
}

export function normalizeDisplayStrings(model: PortfolioModel): PortfolioModel;
export function normalizeDisplayStrings(model: ProfileModel): ProfileModel;
export function normalizeDisplayStrings(model: ComponentModel): ComponentModel;
export function normalizeDisplayStrings(model: ProjectDisplay): ProjectDisplay;
export function normalizeDisplayStrings(
  model: PreviewPageModel,
): PreviewPageModel;
export function normalizeDisplayStrings(
  model:
    | PortfolioModel
    | ProfileModel
    | ComponentModel
    | ProjectDisplay
    | PreviewPageModel,
):
  | PortfolioModel
  | ProfileModel
  | ComponentModel
  | ProjectDisplay
  | PreviewPageModel {
  const copy = structuredClone(model);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: false });
  function visit(node: object): void {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") {
        Reflect.set(
          node,
          key,
          decoder.decode(
            encoder.encode(
              value.replace(/\r\n?/g, "\n").replaceAll("\u0000", "\uFFFD"),
            ),
          ),
        );
      } else if (value !== null && typeof value === "object") visit(value);
    }
  }
  visit(copy);
  return copy;
}

export type InputBounds = {
  maxNodes: number;
  maxDepth: number;
  maxString: number;
  maxBytes: number;
  outputBudget?: { maxBytes: number; fixedMarkupBytes: number };
};
const SOURCE_ACCOUNTING_FACTOR = 8;
const MIN_PROJECT_IMAGE_ENTRY_BYTES = 94;
// The fixed profile adds at most three images: avatar, banner and the
// enabled Face Reveal photo.
const MAX_RESOLVED_ASSETS =
  Math.floor(DRAFT_MAX_BYTES / MIN_PROJECT_IMAGE_ENTRY_BYTES) + 3;
const MAX_ASSET_WIRE_BYTES = 2 * URL_MAX_BYTES + 128;
export const PREVIEW_MAX_BYTES =
  SOURCE_ACCOUNTING_FACTOR * DRAFT_MAX_BYTES +
  MAX_RESOLVED_ASSETS * MAX_ASSET_WIRE_BYTES +
  4096;
export const PREVIEW_BOUNDS: InputBounds = {
  maxNodes: 2 * DRAFT_MAX_BYTES + 128,
  maxDepth: 64,
  maxString: 1_048_576,
  maxBytes: PREVIEW_MAX_BYTES,
};
export function withinBounds(input: unknown, bounds: InputBounds): boolean {
  let nodes = 0;
  let bytes = 0;
  const seen = new Set<object>();
  const pending: { value: unknown; depth: number }[] = [
    { value: input, depth: 0 },
  ];
  while (pending.length) {
    const item = pending.pop();
    if (!item || ++nodes > bounds.maxNodes || item.depth > bounds.maxDepth)
      return false;
    const { value } = item;
    if (typeof value === "string") {
      if (value.length > bounds.maxString) return false;
      bytes += new TextEncoder().encode(value).byteLength;
    } else if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      bytes += 8;
    else if (typeof value === "object") {
      if (
        seen.has(value) ||
        (!Array.isArray(value) &&
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null)
      )
        return false;
      seen.add(value);
      if (Object.getOwnPropertySymbols(value).length) return false;
      const keys = Object.keys(value);
      if (
        keys.length > bounds.maxNodes - nodes ||
        (Array.isArray(value) && keys.length !== value.length)
      )
        return false;
      for (const key of keys) {
        if (
          key.length > bounds.maxString ||
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype"
        )
          return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) return false;
        bytes += key.length + 4;
        pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    } else return false;
    if (bytes > bounds.maxBytes) return false;
    if (
      bounds.outputBudget &&
      bytes * 6 + nodes * 512 + bounds.outputBudget.fixedMarkupBytes >
        bounds.outputBudget.maxBytes
    )
      return false;
  }
  return true;
}
export function parsePortfolioModel(
  input: unknown,
): PortfolioModel | undefined {
  if (!withinBounds(input, PREVIEW_BOUNDS)) return undefined;
  const result = portfolioModelSchema.safeParse(input);
  return result.success ? normalizeDisplayStrings(result.data) : undefined;
}

// Full-page preview. Each page of the private draft is one document: the
// shared profile plus either the portfolio sections, one case study or the
// resume page, mirroring the published page types.
const pageImageSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({
    state: z.literal("ready"),
    url: z.string().refine(isWebUrl),
  }),
]);
export const previewPageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("portfolio") }),
  z.strictObject({
    kind: z.literal("case-study"),
    // Position among the draft's case studies; published pages use it for
    // the section ID.
    index: z.number().int().nonnegative(),
    title: z.string(),
    body: caseStudyRichTextContentSchema,
    images: z.record(z.string(), pageImageSchema),
  }),
  z.strictObject({ kind: z.literal("resume"), file: fileSchema }),
]);
export type PreviewPage = z.infer<typeof previewPageSchema>;
export const previewPageModelSchema = z.strictObject({
  model: portfolioModelSchema,
  page: previewPageSchema,
});
export type PreviewPageModel = z.infer<typeof previewPageModelSchema>;

/** Asset URLs that a page model asks the browser to load, for origin checks. */
export function previewPageAssetUrls(page: PreviewPage): string[] {
  if (page.kind === "case-study")
    return Object.values(page.images).flatMap((image) =>
      image.state === "ready" ? [image.url] : [],
    );
  if (page.kind === "resume")
    return page.file.state === "ready"
      ? [page.file.url, page.file.viewUrl]
      : [];
  return [];
}
export function parsePreviewPageModel(
  input: unknown,
): PreviewPageModel | undefined {
  if (!withinBounds(input, PREVIEW_BOUNDS)) return undefined;
  const result = previewPageModelSchema.safeParse(input);
  return result.success ? normalizeDisplayStrings(result.data) : undefined;
}

/**
 * Projects the saved draft as the page published at `path`: `/`, `/resume` or
 * `/projects/{slug}`. Returns undefined where a published portfolio would show
 * its page-unavailable state: no such case study, or no resume component.
 */
export function projectPreviewPage(
  draft: DraftDoc,
  path: string,
  options: ProjectionOptions,
): PreviewPageModel | undefined {
  const portfolio = projectPortfolio(draft, options);
  if (path === "/") return { model: portfolio, page: { kind: "portfolio" } };
  const profile = { ...portfolio, components: [] };
  if (path === "/resume") {
    const resume = portfolio.components.find(
      (component) => component.type === "resume",
    );
    return resume?.type === "resume"
      ? {
          model: profile,
          page: { kind: "resume", file: resume.data.file },
        }
      : undefined;
  }
  let index = 0;
  for (const component of draft.components) {
    if (component.type !== "projects") continue;
    if (draft.samples[`components.${component.id}`]) continue;
    for (const entry of component.data.entries) {
      if (!entry.caseStudy) continue;
      if (caseStudyPath(entry.caseStudy.slug) === path) {
        const body: CaseStudyDocument = entry.caseStudy.body;
        const images: Record<string, z.infer<typeof pageImageSchema>> = {};
        for (const node of body.content) {
          if (node.type !== "image" || images[node.attrs.assetId]) continue;
          const resolved = resolveImage(
            { assetId: node.attrs.assetId },
            "case_study",
            options,
          );
          images[node.attrs.assetId] =
            resolved.state === "ready"
              ? { state: "ready", url: resolved.url }
              : { state: "unavailable" };
        }
        return normalizeDisplayStrings({
          model: profile,
          page: {
            kind: "case-study",
            index,
            title: entry.title,
            body,
            images,
          },
        });
      }
      index++;
    }
  }
  return undefined;
}
