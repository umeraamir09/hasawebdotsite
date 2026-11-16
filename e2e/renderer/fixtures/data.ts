import {
  createComponent,
  createEmptyDraft,
  type DraftDoc,
  draftSchema,
  richText,
} from "../../packages/schema/src/index";

export const fixtureNames = [
  "complete",
  "incomplete",
  "empty",
  "long",
] as const;
export type FixtureName = (typeof fixtureNames)[number];

export function fixtureDraft(kind: FixtureName): DraftDoc {
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  if (kind === "empty") return draft;
  const components = [
    createComponent("text", "intro"),
    createComponent("projects", "projects"),
    createComponent("skills", "skills"),
    createComponent("work-experience", "experience"),
    createComponent("text", "notes"),
    createComponent("social-links", "social"),
    createComponent("github", "github"),
    createComponent("contact", "contact"),
    createComponent("resume", "resume"),
  ];
  if (kind === "incomplete") {
    draft.profile.name = "Mira's unfinished portfolio";
    draft.profile.avatar = { assetId: "missing-avatar", accepted: false };
    draft.profile.banner = { assetId: "failed-banner" };
    draft.profile.faceReveal = {
      enabled: true,
      image: { assetId: "private-face" },
    };
    draft.links = [
      {
        id: "unfinished-link",
        label: "Website",
        kind: "website",
        value: "",
        showInProfile: true,
        showInSocialComponent: true,
      },
    ];
    draft.components = components;
    return draftSchema.parse(draft);
  }
  draft.requestedSubdomain = "private-address-candidate";
  draft.profile = {
    name: "Mira Sen",
    bio: "I build thoughtful tools for everyday work.\r\nClear notes, useful outcomes.",
    location: "Karachi, Pakistan",
    avatar: {
      assetId: "fixture-avatar",
      accepted: true,
      alt: "Mira's illustrated avatar",
    },
    banner: {
      assetId: "fixture-banner",
      alt: "Geometric shapes in lime and warm neutral colors",
    },
    faceReveal: { enabled: false, image: { assetId: "private-face" } },
  };
  draft.links = [
    {
      id: "website",
      label: "Website",
      kind: "website",
      value: "https://example.test/mira?view=work&lang=en",
      showInProfile: true,
      showInSocialComponent: true,
    },
    {
      id: "email",
      label: "Say hello",
      kind: "email",
      value: "hello@example.test",
      showInProfile: true,
      showInSocialComponent: false,
    },
    {
      id: "github-link",
      label: "GitHub",
      kind: "github",
      value: "https://github.com/octocat",
      showInProfile: false,
      showInSocialComponent: true,
    },
  ];
  draft.components = [
    {
      id: "intro",
      type: "text",
      version: 1,
      data: {
        title: "A little about me",
        body: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 3 },
              content: [
                { type: "text", text: "Careful work, useful outcomes" },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "My notes <script>window.fixtureXss=true</script> stay literal. Unicode stays intact. 🧑🏽‍💻 اردو café\r\nA NUL \u0000 and lone surrogate \uD800 stay visibly replaceable. & < > \" '",
                },
              ],
            },
            {
              type: "orderedList",
              attrs: { start: 3 },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Read the project notes",
                          marks: [
                            {
                              type: "link",
                              attrs: {
                                href: "https://example.test/notes?a=1&b=2",
                              },
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "Keep the nested detail.",
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    {
      id: "projects",
      type: "projects",
      version: 1,
      data: {
        entries: [
          {
            id: "atlas",
            title: "Atlas workspace",
            summary: "A calmer place to plan shared work.",
            contribution: "I designed and built the editing workflow.",
            technologies: ["TypeScript", "SQLite"],
            image: {
              assetId: "broken-project",
              alt: "Atlas workspace overview",
            },
            codeUrl: "https://example.test/code",
            demoUrl: "https://example.test/demo",
            caseStudy: {
              slug: "atlas",
              body: richText(
                "A private case-study body must not be sent to the portfolio preview.",
              ),
            },
          },
          {
            id: "field-notes",
            title: "Field notes",
            summary: "An independent notebook for daily observations.",
            contribution: "",
            technologies: [],
            codeUrl: "",
          },
        ],
      },
    },
    {
      id: "skills",
      type: "skills",
      version: 1,
      data: {
        categories: [{ id: "tools", name: "Tools" }],
        entries: [
          { id: "typescript", name: "TypeScript", categoryId: "tools" },
          { id: "research", name: "Research" },
        ],
      },
    },
    {
      id: "experience",
      type: "work-experience",
      version: 1,
      data: {
        entries: [
          {
            id: "studio",
            role: "Product engineer",
            organization: "Independent studio",
            startDate: "2024-03",
            current: true,
            description: "Build accessible tools with small teams.",
            organizationUrl: "https://example.test/studio",
          },
        ],
      },
    },
    {
      id: "notes",
      type: "text",
      version: 1,
      data: {
        title: "Currently exploring",
        body: richText("Local-first software and small gardens."),
      },
    },
    { id: "social", type: "social-links", version: 1, data: {} },
    {
      id: "github",
      type: "github",
      version: 1,
      data: { username: "octocat", includePrivate: true },
    },
    {
      id: "contact",
      type: "contact",
      version: 1,
      data: { recipientId: "secret-recipient-record" },
    },
    {
      id: "resume",
      type: "resume",
      version: 1,
      data: { file: { assetId: "private-resume" } },
    },
  ];
  if (kind === "long") {
    draft.profile.name = "Mira".repeat(80);
    draft.profile.bio =
      "A long introduction with Unicode 🧑🏽‍💻 اردو & <angle brackets>. ".repeat(
        1400,
      );
    const notes = draft.components.find(
      (component) => component.id === "notes",
    );
    if (notes?.type === "text")
      notes.data.body = richText("Unbroken".repeat(8000));
  }
  return draftSchema.parse(draft);
}
