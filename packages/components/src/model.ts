import {
  type AssetPurpose,
  type ComponentOf,
  type ComponentType,
  componentRegistry,
  type DraftDoc,
  draftWebUrlSchema,
  idSchema,
  isSafeLink,
  isWebUrl,
  profileSchema,
  richTextContentSchema,
} from "@hasaweb/schema";
import { z } from "zod";

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
const linkSchema = z.strictObject({
  label: z.string(),
  href: z.string().refine(isSafeLink),
});
type ProjectDisplay = Omit<
  ComponentOf<"projects">["data"]["entries"][number],
  "id" | "image" | "caseStudy"
> & { image: DisplayAsset; hasCaseStudy: boolean };
const projectSchema = z.strictObject({
  title: z.string(),
  summary: z.string(),
  technologies: z.array(z.string()),
  contribution: z.string(),
  codeUrl: draftWebUrlSchema.optional(),
  demoUrl: draftWebUrlSchema.optional(),
  image: assetSchema,
  hasCaseStudy: z.boolean(),
}) satisfies z.ZodType<ProjectDisplay>;
const { id: _workId, ...workFields } =
  componentRegistry["work-experience"].schema.shape.entries.element.shape;
const workSchema = z.strictObject(workFields);
const identity = { id: idSchema };
const schemas = {
  projects: z.strictObject({
    ...identity,
    type: z.literal("projects"),
    data: z.strictObject({ entries: z.array(projectSchema) }),
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
      available: z.literal(false),
      username: componentRegistry.github.schema.shape.username,
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
    data: z.strictObject({ available: z.literal(false) }),
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
    links: z.array(linkSchema),
  });
export const portfolioModelSchema = z.strictObject({
  profile: profileModelSchema,
  components: z.array(componentModelSchema),
});
export type PortfolioModel = z.infer<typeof portfolioModelSchema>;
export type ProfileModel = PortfolioModel["profile"];
export type ComponentModel = PortfolioModel["components"][number];
export type ProjectionOptions = {
  resolveAsset: (asset: {
    assetId: string;
    purpose: AssetPurpose;
  }) => { state: "ready"; url: string } | { state: "unavailable" };
  assetOrigins: readonly string[];
};

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
  ) => Extract<ComponentModel, { type: K }>;
};
const adapters = {
  projects: ({ id, data }, _draft, options) => ({
    id,
    type: "projects",
    data: {
      entries: data.entries.map(
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
          hasCaseStudy: !!caseStudy,
        }),
      ),
    },
  }),
  skills: ({ id, data }) => ({
    id,
    type: "skills",
    data: {
      groups: [
        ...data.categories.map((category) => ({
          name: category.name,
          skills: data.entries
            .filter((entry) => entry.categoryId === category.id)
            .map((entry) => entry.name),
        })),
        {
          name: "",
          skills: data.entries
            .filter((entry) => !entry.categoryId)
            .map((entry) => entry.name),
        },
      ].filter((group) => group.skills.length > 0),
    },
  }),
  "work-experience": ({ id, data }) => ({
    id,
    type: "work-experience",
    data: {
      entries: data.entries.map(
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
      ),
    },
  }),
  text: ({ id, data }) => ({
    id,
    type: "text",
    data: { title: data.title, body: data.body },
  }),
  "social-links": (component, draft) => ({
    id: component.id,
    type: "social-links",
    data: {
      links: displayLinks(
        draft.links.filter((link) => link.showInSocialComponent),
      ),
    },
  }),
  github: (component) => ({
    id: component.id,
    type: "github",
    data: { available: false, username: component.data.username },
  }),
  contact: (component) => ({
    id: component.id,
    type: "contact",
    data: { available: false },
  }),
  resume: (component) => ({
    id: component.id,
    type: "resume",
    data: { available: false },
  }),
} satisfies Adapters;
function displayLinks(links: DraftDoc["links"]): ProfileModel["links"] {
  return links.flatMap((link) => {
    const href = link.kind === "email" ? `mailto:${link.value}` : link.value;
    return isSafeLink(href)
      ? [
          {
            label: link.label || (link.kind === "email" ? "Email" : "Link"),
            href,
          },
        ]
      : [];
  });
}
export function projectPortfolio(
  draft: DraftDoc,
  options: ProjectionOptions,
): PortfolioModel {
  const components = draft.components
    .filter((component) => !draft.samples[`components.${component.id}`])
    .map((component): ComponentModel => {
      switch (component.type) {
        case "projects":
          return adapters.projects(component, draft, options);
        case "skills":
          return adapters.skills(component);
        case "work-experience":
          return adapters["work-experience"](component);
        case "text":
          return adapters.text(component);
        case "social-links":
          return adapters["social-links"](component, draft);
        case "github":
          return adapters.github(component);
        case "contact":
          return adapters.contact(component);
        case "resume":
          return adapters.resume(component);
        default: {
          const exhaustive: never = component;
          return exhaustive;
        }
      }
    });
  return normalizeDisplayStrings({
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
      links: displayLinks(draft.links.filter((link) => link.showInProfile)),
    },
    components,
  });
}

export function normalizeDisplayStrings(model: PortfolioModel): PortfolioModel;
export function normalizeDisplayStrings(model: ProfileModel): ProfileModel;
export function normalizeDisplayStrings(model: ComponentModel): ComponentModel;
export function normalizeDisplayStrings(
  model: PortfolioModel | ProfileModel | ComponentModel,
): PortfolioModel | ProfileModel | ComponentModel {
  const copy = structuredClone(model);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
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
export const PREVIEW_BOUNDS: InputBounds = {
  maxNodes: 250_000,
  maxDepth: 64,
  maxString: 1_048_576,
  maxBytes: 2_097_152,
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
