import { isSafeLink } from "@hasaweb/schema";
import { createElement, type ReactNode } from "react";
import { z } from "zod";
import { GRAPH_SOURCE_PATH } from "./graph";

// Same-site page paths only: the portfolio root, /resume or a generated
// case-study slug. Owner destinations use `href`, which keeps the external-link
// allowlist.
export const pagePathSchema = z
  .string()
  .max(96)
  .regex(/^\/(?:resume|projects\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
// Closed vocabulary for resumable wrappers. No owner-selected tag or attribute.
export const frameSchema = z.enum([
  "profile",
  "profile-copy",
  "section",
  "article",
  "entry",
  "paragraph",
  "bio",
  "muted",
  "links",
  "link-row",
  "tags",
  "rich",
  "list",
  "ordered",
  "item",
  "span",
  "link",
  "page-link",
  "page-nav",
  "graph",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
export type FrameName = z.infer<typeof frameSchema>;
export const frameInputSchema = z.strictObject({
  name: frameSchema,
  id: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
    .optional(),
  component: z
    .enum([
      "projects",
      "skills",
      "work-experience",
      "text",
      "social-links",
      "github",
      "contact",
      "resume",
    ])
    .optional(),
  href: z.string().max(2048).refine(isSafeLink).optional(),
  start: z.number().int().positive().optional(),
  path: pagePathSchema.optional(),
});
export type FrameInput = z.infer<typeof frameInputSchema>;
const definitions: Record<FrameName, { tag: string; className?: string }> = {
  profile: { tag: "header", className: "pf-profile" },
  "profile-copy": { tag: "div", className: "pf-profile-copy" },
  section: { tag: "section", className: "pf-section" },
  article: { tag: "article", className: "pf-entry" },
  entry: { tag: "div", className: "pf-entry" },
  paragraph: { tag: "p" },
  bio: { tag: "p", className: "pf-bio" },
  muted: { tag: "p", className: "pf-muted" },
  links: { tag: "ul", className: "pf-links" },
  "link-row": { tag: "div", className: "pf-links" },
  tags: { tag: "ul", className: "pf-tags" },
  rich: { tag: "div", className: "pf-rich-text" },
  list: { tag: "ul" },
  ordered: { tag: "ol" },
  item: { tag: "li" },
  span: { tag: "span" },
  link: { tag: "a" },
  "page-link": { tag: "a", className: "pf-page-link" },
  "page-nav": { tag: "nav", className: "pf-page-nav" },
  graph: { tag: "div", className: "pf-graph" },
  h1: { tag: "h1" },
  h2: { tag: "h2" },
  h3: { tag: "h3" },
  h4: { tag: "h4" },
  h5: { tag: "h5" },
  h6: { tag: "h6" },
};
export function PortfolioFrame({
  frame,
  children,
}: {
  frame: FrameInput;
  children?: ReactNode;
}) {
  const definition = definitions[frame.name];
  return createElement(
    definition.tag,
    {
      ...(definition.className ? { className: definition.className } : {}),
      ...(frame.name === "profile" ? { "data-component": "profile" } : {}),
      ...(frame.name === "section"
        ? { "data-component": frame.component, "data-component-id": frame.id }
        : {}),
      ...(frame.name === "ordered" && frame.start !== undefined
        ? { start: frame.start }
        : {}),
      ...(frame.name === "link"
        ? { href: frame.href, rel: "noopener noreferrer" }
        : {}),
      ...(frame.name === "page-link" ? { href: frame.path ?? "/" } : {}),
      ...(frame.name === "page-nav" ? { "aria-label": "Portfolio" } : {}),
      // Published placeholder. The visitor's browser asks the graph endpoint.
      ...(frame.name === "graph"
        ? {
            "data-github-graph": "",
            "data-state": "loading",
            "data-graph-source": GRAPH_SOURCE_PATH,
            "aria-live": "polite",
          }
        : {}),
    },
    children,
  );
}
