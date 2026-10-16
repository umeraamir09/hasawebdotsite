import { z } from "zod";
import { boundedJsonSchema, encodeJson } from "./json";
import {
  checkUniqueIds,
  emailSchema,
  idSchema,
  versionSchema,
  webUrlSchema,
} from "./primitives";
import { profileDefinition, profileSchema } from "./profile";
import { componentContentSchema, componentRegistry } from "./registry";

export const DRAFT_SCHEMA_VERSION = 1;
export const linkSchema = z
  .strictObject({
    id: idSchema,
    label: z.string(),
    kind: idSchema,
    value: z.string(),
    showInProfile: z.boolean(),
    showInSocialComponent: z.boolean(),
  })
  .superRefine((link, ctx) => {
    if (link.value === "") return; // Owners must be able to save unfinished fields.
    const valid =
      link.kind === "email"
        ? emailSchema.safeParse(link.value)
        : webUrlSchema.safeParse(link.value);
    if (!valid.success)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter a valid email address or HTTP(S) URL",
      });
  });
export const appearanceSchema = z.strictObject({
  themeId: idSchema,
  fontId: idSchema,
  customColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  colorMode: z.enum(["light", "dark", "system"]),
});
export const seoSchema = z.strictObject({
  title: z.string().optional(),
  description: z.string().optional(),
  ogImage: z.strictObject({ assetId: idSchema }).optional(),
});

const profileSampleFields = ["name", "bio", "avatar", "banner"] as const;
export type ProfileSampleField = (typeof profileSampleFields)[number];
const sampleKeySchema = z
  .string()
  .regex(
    /^(?:profile\.(?:name|bio|avatar|banner)|components\.[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/,
  );
const samplesSchema = z.record(sampleKeySchema, z.literal(true));

export const draftFields = {
  schemaVersion: z.literal(DRAFT_SCHEMA_VERSION),
  profile: profileSchema,
  links: z.array(linkSchema),
  components: z.array(componentContentSchema),
  appearance: appearanceSchema,
  seo: seoSchema,
  samples: samplesSchema,
};
const currentDraftSchema = z
  .strictObject(draftFields)
  .superRefine((draft, ctx) => {
    checkUniqueIds(draft.links, ctx, ["links"]);
    checkUniqueIds(draft.components, ctx, ["components"]);
    const types = new Set<string>();
    draft.components.forEach((component, index) => {
      if (
        componentRegistry[component.type].singleton &&
        types.has(component.type)
      )
        ctx.addIssue({
          code: "custom",
          path: ["components", index, "type"],
          message: "Only one instance of this component is allowed",
        });
      types.add(component.type);
    });
    const componentIds = new Set(
      draft.components.map((component) => component.id),
    );
    for (const key of Object.keys(draft.samples)) {
      const exists = key.startsWith("components.")
        ? componentIds.has(key.slice(11))
        : draft.profile[key.slice(8) as ProfileSampleField] !== undefined;
      if (!exists)
        ctx.addIssue({
          code: "custom",
          path: ["samples", key],
          message: "Sample marker has no target",
        });
    }
  });
export const draftSchema = boundedJsonSchema.pipe(currentDraftSchema);
export type DraftDoc = z.infer<typeof draftSchema>;

// Serialize once for both the byte guard and storage. The content schemas have
// no transforms/defaults, so accepted input and parsed output are JSON-equivalent.
export function serializeDraft(input: unknown): {
  draft: DraftDoc;
  json: string;
} {
  const json = encodeJson(input);
  return { draft: currentDraftSchema.parse(input), json };
}
export type SocialLink = z.infer<typeof linkSchema>;

// Migration staging validates only identity/version wrappers. Final validation
// uses draftSchema after every component has reached its current version.
export const migrationEnvelopeSchema = z.looseObject({
  schemaVersion: versionSchema,
  components: z.array(
    z.strictObject({
      id: idSchema,
      type: idSchema,
      version: versionSchema,
      data: z.unknown(),
    }),
  ),
});

export function createEmptyDraft(
  appearance: z.infer<typeof appearanceSchema>,
): DraftDoc {
  return draftSchema.parse({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    profile: profileDefinition.defaults(),
    links: [],
    components: [],
    appearance,
    seo: {},
    samples: {},
  });
}
