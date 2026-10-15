import { createEmptyDraft, type DraftDoc } from "./draft";
import { componentRegistry, createComponent } from "./registry";
import { richText } from "./rich-text";

export function completeDraft(): DraftDoc {
  const draft = createEmptyDraft({
    themeId: "fixture-theme",
    fontId: "fixture-font",
    colorMode: "system",
    customColor: "#123aBC",
  });
  draft.profile = {
    name: "عمر Example",
    bio: "I build tools. 👋",
    location: "Karachi",
    avatar: {
      assetId: "avatar-1",
      alt: "Illustrated portrait",
      accepted: true,
    },
    banner: { assetId: "banner-1", alt: "A mountain" },
    decorationId: "fixture-decoration",
    faceReveal: {
      enabled: false,
      image: { assetId: "face-1", alt: "My photo" },
    },
  };
  draft.links = [
    {
      id: "email-1",
      label: "Email me",
      kind: "email",
      value: "umer@example.test",
      showInProfile: true,
      showInSocialComponent: true,
    },
    {
      id: "github-1",
      label: "My GitHub",
      kind: "github",
      value: "https://github.com/example",
      showInProfile: false,
      showInSocialComponent: true,
    },
  ];
  const projects = createComponent("projects", "projects-1");
  projects.data.entries = [
    {
      id: "project-1",
      title: "My project",
      summary: "A small tool",
      technologies: ["TypeScript", "SQLite"],
      contribution: "Built the editor",
      codeUrl: "https://github.com/example/tool",
      demoUrl: "http://example.test/tool",
      image: { assetId: "project-image", alt: "The tool" },
      caseStudy: {
        slug: "my-project",
        body: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "How I built it" }],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Read more",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: "https://example.test/story" },
                    },
                  ],
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
                      content: [{ type: "text", text: "Build" }],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "Test" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "image",
              attrs: { assetId: "case-image", alt: "Architecture" },
            },
          ],
        },
      },
    },
  ];
  const skills = createComponent("skills", "skills-1");
  skills.data = {
    categories: [{ id: "languages", name: "Languages" }],
    entries: [
      { id: "ts", name: "TypeScript", categoryId: "languages" },
      { id: "git", name: "Git" },
    ],
  };
  const work = createComponent("work-experience", "work-1");
  work.data.entries = [
    {
      id: "role-1",
      role: "Developer",
      organization: "Example",
      startDate: "2024-01",
      current: true,
      description: "Built tools",
      organizationUrl: "https://example.test",
    },
  ];
  const text = createComponent("text", "text-1");
  text.data = {
    title: "About me",
    body: richText("I like building useful tools."),
  };
  const otherText = createComponent("text", "text-2");
  otherText.data = { title: "Interests", body: richText("Open-source work") };
  const github = createComponent("github", "github-activity");
  github.data = { username: "example", includePrivate: true };
  const contact = createComponent("contact", "contact-1");
  contact.data = { recipientId: "recipient-1" };
  const resume = createComponent("resume", "resume-1");
  resume.data = { file: { assetId: "resume-pdf" } };
  draft.components = [
    projects,
    skills,
    work,
    text,
    otherText,
    github,
    contact,
    createComponent("social-links", "social-1"),
    resume,
  ];
  draft.seo = {
    title: "My portfolio",
    description: "Developer",
    ogImage: { assetId: "sharing-image" },
  };
  draft.samples = { "components.text-2": true };
  return draft;
}

export const definitions = Object.values(componentRegistry);
