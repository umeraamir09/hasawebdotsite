import { describe, expect, it } from "vitest";
import {
  caseStudyRichTextSchema,
  componentRegistry,
  isSafeLink,
  linkSchema,
  richText,
  richTextSchema,
} from "./index";

function documentWith(node: unknown) {
  return { type: "doc", content: [node] };
}
function linkedText(href: string) {
  return documentWith({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "Link",
        marks: [{ type: "link", attrs: { href } }],
      },
    ],
  });
}

describe("link allowlist", () => {
  it.each([
    "https://example.test/path?x=1#section",
    "http://example.test",
    "HTTPS://example.test",
    "mailto:owner@example.test",
  ])("accepts safe link %s without changing it", (href) => {
    expect(isSafeLink(href)).toBe(true);
    expect(richTextSchema.parse(linkedText(href))).toEqual(linkedText(href));
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<svg onload=alert(1)>",
    "vbscript:run()",
    "file:///etc/passwd",
    "ftp://example.test",
    "//example.test",
    "/relative/path",
    "https:example.test",
    " https://example.test",
    "https://example.test\n",
    "https://example.test\\@evil.test",
    "https://user:pass@example.test",
    "mailto:owner@example.test?bcc=other@example.test",
    "mailto:owner@example.test%0d%0aBcc:other@example.test",
    "mailto:bad-address",
    "#local",
    "",
  ])("rejects unsafe or unsupported link %s", (href) => {
    expect(isSafeLink(href)).toBe(false);
    expect(richTextSchema.safeParse(linkedText(href)).success).toBe(false);
    if (href !== "")
      expect(
        linkSchema.safeParse({
          id: "a",
          label: "Link",
          kind: "website",
          value: href,
          showInProfile: true,
          showInSocialComponent: false,
        }).success,
      ).toBe(false);
  });

  it("validates plain email contact identity and web-only project links", () => {
    const link = {
      id: "a",
      label: "Email",
      kind: "email",
      value: "owner@example.test",
      showInProfile: true,
      showInSocialComponent: true,
    };
    expect(linkSchema.parse(link)).toEqual(link);
    for (const value of [
      "not-an-email",
      "mailto:owner@example.test",
      "owner@example.test\r\nBcc:other@example.test",
    ])
      expect(linkSchema.safeParse({ ...link, value }).success).toBe(false);
    expect(
      componentRegistry.projects.schema.safeParse({
        entries: [
          {
            id: "a",
            title: "",
            summary: "",
            technologies: [],
            contribution: "",
            codeUrl: "mailto:owner@example.test",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("rich-text structure and unsafe content", () => {
  it("preserves literal markup as text for the escaping renderer", () => {
    const document = richText(
      '<script>alert(1)</script> <img src=x onerror="run()"> & CSS',
    );
    expect(richTextSchema.parse(document)).toEqual(document);
  });

  it("allows headings, empty paragraphs, nested lists and email links", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "About" }],
        },
        { type: "paragraph" },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "One" }] },
                {
                  type: "orderedList",
                  attrs: { start: 2 },
                  content: [
                    { type: "listItem", content: [{ type: "paragraph" }] },
                  ],
                },
              ],
            },
          ],
        },
        ...linkedText("mailto:owner@example.test").content,
      ],
    };
    expect(richTextSchema.parse(document)).toEqual(document);
  });

  it.each([
    { type: "html", html: "<script>run()</script>" },
    { type: "script", content: "run()" },
    { type: "iframe", attrs: { src: "https://evil.test" } },
    { type: "video", attrs: { src: "https://evil.test" } },
    { type: "paragraph", attrs: { style: "color:red", onclick: "run()" } },
    { type: "text", text: "Outside paragraph" },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Inline", marks: [{ type: "bold" }] }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Inline",
          marks: [
            {
              type: "link",
              attrs: { href: "https://example.test", onclick: "run()" },
            },
          ],
        },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "", marks: [] }] },
    { type: "paragraph", content: [{ type: "heading", attrs: { level: 2 } }] },
    { type: "heading", attrs: { level: 1 } },
    { type: "heading", attrs: { level: 7 } },
    { type: "bulletList", content: [] },
    { type: "bulletList", content: [{ type: "paragraph" }] },
    {
      type: "bulletList",
      attrs: { start: 1 },
      content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
    },
    {
      type: "orderedList",
      attrs: { start: 0 },
      content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "text", text: "Missing paragraph" }],
        },
      ],
    },
  ])("rejects unapproved node/attributes or malformed nesting %#", (node) => {
    expect(richTextSchema.safeParse(documentWith(node)).success).toBe(false);
    expect(caseStudyRichTextSchema.safeParse(documentWith(node)).success).toBe(
      false,
    );
  });

  it("permits uploaded images exclusively as case-study blocks", () => {
    const image = {
      type: "image",
      attrs: { assetId: "uploaded-image", alt: "Useful description" },
    };
    expect(caseStudyRichTextSchema.parse(documentWith(image))).toEqual(
      documentWith(image),
    );
    expect(richTextSchema.safeParse(documentWith(image)).success).toBe(false);
    expect(
      caseStudyRichTextSchema.safeParse(
        documentWith({ type: "paragraph", content: [image] }),
      ).success,
    ).toBe(false);
    for (const attrs of [
      { src: "https://external.test/image.png" },
      { assetId: "image", style: "width:100px" },
      { assetId: "image", onerror: "run()" },
      { assetId: "../image" },
    ])
      expect(
        caseStudyRichTextSchema.safeParse(
          documentWith({ type: "image", attrs }),
        ).success,
      ).toBe(false);
  });
});
