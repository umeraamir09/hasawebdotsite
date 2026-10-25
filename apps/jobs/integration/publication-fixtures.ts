import {
  PortfolioAvatar,
  PortfolioProfile,
  PortfolioSection,
  projectPortfolio,
  RichText,
} from "@hasaweb/components";
import {
  createComponent,
  createEmptyDraft,
  type DraftDoc,
  richText,
  serializeDraft,
} from "@hasaweb/schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
export function makeDraft(kind: string): DraftDoc {
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  draft.requestedSubdomain = "s8-fixture";
  draft.profile = {
    name: "عمر Example",
    bio: "I build <tools> & interfaces.\r\n😀",
    location: "Karachi",
    avatar: { assetId: "avatar", accepted: true, alt: "Portrait" },
    banner: { assetId: "banner", alt: "Banner" },
    faceReveal: {
      enabled: false,
      image: { assetId: "private-face", alt: "Keep private" },
    },
  };
  draft.links = [
    {
      id: "website",
      label: "Website",
      kind: "website",
      value: "https://example.test",
      showInProfile: true,
      showInSocialComponent: true,
    },
  ];
  if (kind !== "small") {
    const text = createComponent("text", "text");
    text.data = {
      title: "Notes",
      body: richText('Useful work <safe> & "escaped".'),
    };
    const projects = createComponent("projects", "projects");
    projects.data.entries = [
      {
        id: "project",
        title: "Project",
        summary: "Summary",
        contribution: "Built it",
        technologies: ["TypeScript", "SQLite"],
        image: { assetId: "project-image", alt: "Project <&>" },
        codeUrl: "https://example.test/code",
        caseStudy: {
          slug: "project",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Case study" }],
              },
            ],
          },
        },
      },
    ];
    const skills = createComponent("skills", "skills");
    skills.data = {
      categories: [{ id: "language", name: "Languages" }],
      entries: [
        { id: "ts", name: "TypeScript", categoryId: "language" },
        { id: "sql", name: "SQL" },
      ],
    };
    const work = createComponent("work-experience", "work");
    work.data.entries = [
      {
        id: "role",
        role: "Engineer",
        organization: "Studio",
        startDate: "2020-01",
        current: true,
        description: "Built useful things",
        organizationUrl: "https://example.test",
      },
    ];
    const social = createComponent("social-links", "social");
    const resume = createComponent("resume", "resume");
    resume.data.file = { assetId: "resume" };
    draft.components = [text, projects, skills, work, social, resume];
  }
  if (kind === "unicode" || kind === "max") {
    const size = kind === "max" ? 1_048_576 : 80_000;
    const pattern = kind === "max" ? "x" : 'عمر😀\r\n\u0000<&>"\\';
    draft.profile.bio = pattern.repeat(Math.floor(size / 20));
    if (kind === "max") {
      draft.profile.bio = "";
      const base = Buffer.byteLength(serializeDraft(draft).json);
      draft.profile.bio = "x".repeat(size - base);
    }
  }
  if (kind === "assets") {
    const projects = draft.components.find(
      (component) => component.type === "projects",
    );
    if (projects?.type !== "projects")
      throw new Error("Missing project fixture");
    const original = projects.data.entries[0];
    if (!original) throw new Error("Missing project entry");
    projects.data.entries = Array.from({ length: 24 }, (_, index) => {
      const entry = {
        ...original,
        id: `gallery-${index}`,
        title: `Gallery ${index}`,
        image: {
          assetId: `gallery-image-${index % 4}`,
          alt: `Image ${index} 😀 <&>`,
        },
      };
      if (index) delete entry.caseStudy;
      return entry;
    });
    original.caseStudy?.body.content.push({
      type: "image",
      attrs: { assetId: "case-image", alt: "Case image 😀 <&>" },
    });
  }
  if (kind === "dense") {
    draft.components = Array.from({ length: 3000 }, (_, index) => {
      const component = createComponent("text", `text-${index}`);
      component.data = { title: `Section ${index}`, body: richText("Body") };
      return component;
    });
  }
  if (kind === "deep") {
    let list: {
      type: "bulletList";
      content: {
        type: "listItem";
        content: [
          { type: "paragraph"; content: { type: "text"; text: string }[] },
          ...unknown[],
        ];
      }[];
    } = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Deep" }] },
          ],
        },
      ],
    };
    for (let n = 0; n < 8; n++)
      list = {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: `Level ${n}` }],
              },
              list,
            ],
          },
        ],
      };
    const component = createComponent("text", "deep");
    component.data.title = "Deep structure";
    component.data.body = richText("Start");
    // Fixture parsing below validates the generated recursive tree.
    Reflect.set(component.data.body, "content", [list]);
    draft.components = [component];
  }
  if (kind === "description") {
    if (draft.profile.banner)
      draft.profile.banner.alt = '😀<&>"\r\n'.repeat(2000);
  }
  if (kind === "hands" || kind === "cat") draft.profile.decorationId = kind;
  if (kind === "face") draft.profile.faceReveal.enabled = true;
  if (kind === "surrogate") draft.profile.bio = "A\ud800B\udc00Z";
  return serializeDraft(draft).draft;
}
export function assetReferences(draft: DraftDoc) {
  const found = new Map<string, { id: string; purpose: string }>();
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== "object") return;
    if ("assetId" in value && typeof value.assetId === "string") {
      const purpose =
        path === "profile.avatar"
          ? "avatar"
          : path === "profile.banner"
            ? "banner"
            : path === "profile.faceReveal.image"
              ? "face"
              : path === "seo.ogImage"
                ? "og"
                : path.endsWith(".file")
                  ? "resume"
                  : path.endsWith(".image")
                    ? "project"
                    : "case_study";
      found.set(value.assetId, { id: value.assetId, purpose });
    }
    for (const [key, child] of Object.entries(value))
      visit(child, `${path ? `${path}.` : ""}${key}`);
  }
  visit(draft, "");
  return [...found.values()];
}
function profileHtml(
  draft: DraftDoc,
  profile: import("@hasaweb/components").ProfileModel,
) {
  const strip = (html: string) =>
    html.replace(/<link rel="preload"[^>]*\/>/g, "");
  const html = strip(
    renderToStaticMarkup(createElement(PortfolioProfile, { profile })),
  );
  if (
    draft.profile.decorationId !== "cat" &&
    draft.profile.decorationId !== "hands"
  )
    return html;
  return html.replace(
    strip(
      renderToStaticMarkup(
        createElement(PortfolioAvatar, { asset: profile.avatar }),
      ),
    ),
    strip(
      renderToStaticMarkup(
        createElement(PortfolioAvatar, {
          asset: profile.avatar,
          decoration: draft.profile.decorationId,
        }),
      ),
    ),
  );
}
export function expected(draft: DraftDoc, id: string) {
  const model = projectPortfolio(draft, {
    assetOrigins: ["https://s8-assets.invalid"],
    resolveAsset: ({ assetId }) => ({
      state: "ready",
      url: `https://s8-assets.invalid/candidate/${id}/assets/${assetId}`,
    }),
  });
  return [
    profileHtml(draft, model.profile),
    ...model.components.map((component) =>
      renderToStaticMarkup(createElement(PortfolioSection, { component })),
    ),
  ]
    .join("")
    .replace(/<link rel="preload"[^>]*\/>/g, "");
}

export function expectedPages(draft: DraftDoc, id: string) {
  const pages = [{ path: "/", html: expected(draft, id) }];
  const origin = "https://s8-assets.invalid";
  const image = (assetId: string, alt: string) => ({
    state: "ready" as const,
    url: `${origin}/candidate/${id}/assets/${assetId}`,
    alt,
  });
  const model = projectPortfolio(draft, {
    assetOrigins: [origin],
    resolveAsset: ({ assetId }) => image(assetId, ""),
  });
  let ordinal = 1;
  for (const component of draft.components) {
    if (
      component.type !== "projects" ||
      draft.samples[`components.${component.id}`]
    )
      continue;
    for (const entry of component.data.entries) {
      if (!entry.caseStudy) continue;
      const body = createElement(
        "section",
        {
          className: "pf-section",
          "data-component": "text",
          "data-component-id": `case-${ordinal - 1}`,
        },
        createElement("h2", null, entry.title),
        createElement(RichText, {
          document: entry.caseStudy.body,
          images: image,
        }),
      );
      pages.push({
        path: `/projects/${entry.caseStudy.slug}`,
        html: profileHtml(draft, model.profile) + renderToStaticMarkup(body),
      });
      ordinal++;
    }
  }
  const resume = model.components.find(
    (component) => component.type === "resume",
  );
  if (resume)
    pages.push({
      path: "/resume",
      html:
        profileHtml(draft, model.profile) +
        renderToStaticMarkup(
          createElement(PortfolioSection, { component: resume }),
        ),
    });
  return pages.map((page) => ({
    ...page,
    html: page.html.replace(/<link rel="preload"[^>]*\/>/g, ""),
  }));
}
