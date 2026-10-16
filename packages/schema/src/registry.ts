import { z } from "zod";
import { contactSchema } from "./components/contact";
import { githubSchema } from "./components/github";
import { projectsContentSchema, projectsSchema } from "./components/projects";
import { resumeSchema } from "./components/resume";
import { skillsSchema } from "./components/skills";
import { socialLinksSchema } from "./components/social-links";
import { textContentSchema, textSchema } from "./components/text";
import { workExperienceSchema } from "./components/work-experience";
import type { MigrationStep } from "./migration-contract";
import { idSchema } from "./primitives";
import { richText } from "./rich-text";

interface Definition<T extends string, V extends number, S extends z.ZodType> {
  type: T;
  version: V;
  migrations?: Readonly<Record<number, MigrationStep>>;
  singleton: boolean;
  schema: S;
  defaults: () => z.infer<S>;
  sample: () => z.infer<S>;
  picker: {
    title: string;
    description: string;
    requirements: readonly string[];
  };
}
function defineComponent<
  T extends string,
  const V extends number,
  S extends z.ZodType,
>(definition: Definition<T, V, S>) {
  return {
    ...definition,
    migrations: definition.migrations ?? {},
    instanceSchema: z.strictObject({
      id: idSchema,
      type: z.literal(definition.type),
      version: z.literal(definition.version),
      data: definition.schema,
    }),
  };
}

// The only list of optional component types. Consumers attach Editor/Render
// implementations in @hasaweb/components when those phases are implemented.
export const componentRegistry = {
  projects: defineComponent({
    type: "projects",
    version: 1,
    singleton: true,
    schema: projectsSchema,
    defaults: () => ({ entries: [] }),
    sample: () => ({
      entries: [
        {
          id: "sample-project",
          title: "Example project",
          summary: "Replace this with what you built.",
          technologies: [],
          contribution: "Describe your contribution.",
        },
      ],
    }),
    picker: {
      title: "Projects",
      description: "Projects and optional case studies.",
      requirements: [
        "A title and summary for each project.",
        "Images, technologies, contribution and code/demo links are optional.",
      ],
    },
  }),
  skills: defineComponent({
    type: "skills",
    version: 1,
    singleton: true,
    schema: skillsSchema,
    defaults: () => ({ categories: [], entries: [] }),
    sample: () => ({
      categories: [],
      entries: [{ id: "sample-skill", name: "Example skill" }],
    }),
    picker: {
      title: "Skills and technologies",
      description: "Manually entered skills with optional categories.",
      requirements: ["Skill names, optionally grouped into named categories."],
    },
  }),
  "work-experience": defineComponent({
    type: "work-experience",
    version: 1,
    singleton: true,
    schema: workExperienceSchema,
    defaults: () => ({ entries: [] }),
    sample: () => ({
      entries: [
        {
          id: "sample-role",
          role: "Example role",
          organization: "Example organization",
          startDate: "2026-01",
          current: true,
          description: "Describe your work.",
        },
      ],
    }),
    picker: {
      title: "Work experience",
      description: "Roles, organizations and employment dates.",
      requirements: [
        "Role, organization, dates and description.",
        "An end date or current-role selection.",
      ],
    },
  }),
  text: defineComponent({
    type: "text",
    version: 1,
    singleton: false,
    schema: textSchema,
    defaults: () => ({ title: "", body: richText("") }),
    sample: () => ({
      title: "About me",
      body: richText("Replace this with your story."),
    }),
    picker: {
      title: "Text section",
      description: "An About me section or other text. Add more than one.",
      requirements: [
        "A title and text using headings, paragraphs, lists and links.",
      ],
    },
  }),
  github: defineComponent({
    type: "github",
    version: 1,
    singleton: true,
    schema: githubSchema,
    defaults: () => ({ username: "", includePrivate: false }),
    sample: () => ({ username: "example", includePrivate: false }),
    picker: {
      title: "GitHub activity",
      description: "A contribution graph for a GitHub account.",
      requirements: [
        "A username and successful contribution fetch.",
        "Explicit matching-account authorization for private activity.",
      ],
    },
  }),
  contact: defineComponent({
    type: "contact",
    version: 1,
    singleton: true,
    schema: contactSchema,
    defaults: () => ({}),
    sample: () => ({}),
    picker: {
      title: "Contact form",
      description: "Let visitors send you a message.",
      requirements: ["A verified recipient in contact settings."],
    },
  }),
  "social-links": defineComponent({
    type: "social-links",
    version: 1,
    singleton: true,
    schema: socialLinksSchema,
    defaults: () => ({}),
    sample: () => ({}),
    picker: {
      title: "Social links",
      description: "Display links from your shared social and contact list.",
      requirements: ["Valid labeled links selected for this component."],
    },
  }),
  resume: defineComponent({
    type: "resume",
    version: 1,
    singleton: true,
    schema: resumeSchema,
    defaults: () => ({}),
    sample: () => ({}),
    picker: {
      title: "Resume download",
      description: "A PDF download and public resume page.",
      requirements: ["A successfully uploaded PDF resume, up to 10 MiB."],
    },
  }),
} as const;

export type ComponentType = keyof typeof componentRegistry;
type InstanceSchema =
  (typeof componentRegistry)[ComponentType]["instanceSchema"];
// Object.values preserves the union but loses tuple cardinality. The registry
// above is non-empty, so retain that fact for Zod's discriminated-union API.
const instanceSchemas = Object.values(componentRegistry).map(
  (definition) => definition.instanceSchema,
) as [InstanceSchema, ...InstanceSchema[]];
export const componentSchema = z.discriminatedUnion("type", instanceSchemas);
// Only for a draft tree which has already passed its whole-tree JSON guard.
export const componentContentSchema = z.discriminatedUnion("type", [
  componentRegistry.projects.instanceSchema.extend({
    data: projectsContentSchema,
  }),
  componentRegistry.text.instanceSchema.extend({ data: textContentSchema }),
  ...instanceSchemas.filter(
    (schema) =>
      schema !== componentRegistry.projects.instanceSchema &&
      schema !== componentRegistry.text.instanceSchema,
  ),
]);
export type DraftComponent = z.infer<typeof componentSchema>;
export type ComponentOf<T extends ComponentType> = Extract<
  DraftComponent,
  { type: T }
>;

export function createComponent<T extends ComponentType>(
  type: T,
  id: string,
): ComponentOf<T> {
  const definition = componentRegistry[type];
  return componentSchema.parse({
    id,
    type,
    version: definition.version,
    data: definition.defaults(),
  }) as ComponentOf<T>;
}
