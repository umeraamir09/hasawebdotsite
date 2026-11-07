import { Buffer } from "node:buffer";
import {
  type FrameInput,
  type FrameName,
  frameInputSchema,
  renderFragment,
} from "@hasaweb/render";
import { caseStudyPath } from "@hasaweb/schema";
import { z } from "zod";

const path = z.string().max(4096);
const view = z.enum([
  "profile",
  "component",
  "project",
  "work",
  "group",
  "skill",
  "rich",
  "link",
]);
export const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("root") }),
  z.strictObject({ kind: z.literal("profile-end") }),
  z.strictObject({
    kind: z.literal("reuse-profile"),
    index: z.number().int().nonnegative(),
    count: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("page-start"),
    ordinal: z.number().int().nonnegative(),
    path: z.string().max(128),
  }),
  z.strictObject({ kind: z.literal("page-end") }),
  z.strictObject({
    kind: z.literal("case-pages"),
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("resume-page") }),
  z.strictObject({
    kind: z.literal("resume-file"),
    path,
    variant: z.enum(["component", "page"]),
  }),
  z.strictObject({
    kind: z.literal("discover"),
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("skills"),
    path,
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("skill-filter"),
    path,
    index: z.number().int().nonnegative(),
    category: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("frame"),
    frame: frameInputSchema,
    side: z.enum(["open", "close"]),
  }),
  z.strictObject({ kind: z.literal("literal"), text: z.string().max(4096) }),
  z.strictObject({
    kind: z.literal("text"),
    path,
    offset: z.number().int().nonnegative(),
    fallback: z.string().max(128),
  }),
  z.strictObject({ kind: z.literal("view"), view, path }),
  z.strictObject({
    kind: z.literal("each"),
    view,
    path,
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("image"),
    path,
    purpose: z.enum(["avatar", "banner", "project", "case_study"]),
    // "face" is the markup between the avatar and Face Reveal descriptions.
    side: z.enum(["open", "face", "close"]).default("open"),
  }),
]);
type View = z.infer<typeof view>;
export type Command = z.infer<typeof commandSchema>;
export const cursorSchema = z.array(commandSchema).max(96);
export type SourceNode = {
  type: string | null;
  length: number;
  value: string | number | null;
  wire: string;
  count: number;
};
export interface PreparationSource {
  read(path: string, offset?: number): Promise<SourceNode>;
  discover(index: number): Promise<boolean>;
  caseAt(index: number): Promise<{ path: string; slug: string } | null>;
  resumeAt(): Promise<{ path: string; ordinal: number } | null>;
  // Renders the resume component section or the /resume page body with the
  // candidate's published PDF URLs. Both use the same transferred asset.
  resume(path: string, variant: "component" | "page"): Promise<string>;
  project(path: string): Promise<string | null>;
  components(
    path: string,
    index: number,
  ): Promise<{ html: string; count: number }>;
  category(
    path: string,
    index: number,
  ): Promise<{ id: string | null; count: number; namePath: string } | null>;
  skill(
    path: string,
    category: string | null,
    index: number,
  ): Promise<number | null>;
  image(
    path: string,
    purpose: "avatar" | "banner" | "project" | "case_study",
    side: "open" | "face" | "close",
  ): Promise<string>;
}
async function faceRevealEnabled(source: PreparationSource) {
  if ((await source.read("$.profile.faceReveal.enabled")).type !== "true")
    return false;
  return (
    (await source.read("$.profile.faceReveal.image.assetId")).type === "text"
  );
}
const cmd = (
  name: FrameName,
  side: "open" | "close",
  fields: Omit<FrameInput, "name"> = {},
): Command => ({ kind: "frame", frame: { name, ...fields }, side });
const text = (path: string, fallback = ""): Command => ({
  kind: "text",
  path,
  offset: 0,
  fallback,
});
const literal = (value: string): Command => ({ kind: "literal", text: value });
const visit = (view: View, path: string): Command => ({
  kind: "view",
  view,
  path,
});
const each = (view: View, path: string): Command => ({
  kind: "each",
  view,
  path,
  index: 0,
});
const wrap = (
  name: FrameName,
  children: Command[],
  fields: Omit<FrameInput, "name"> = {},
): Command[] => [
  cmd(name, "open", fields),
  ...children,
  cmd(name, "close", fields),
];
const field = (name: FrameName, path: string, fallback = "") =>
  wrap(name, [text(path, fallback)]);
const empty = (message: string) => wrap("muted", [literal(message)]);
function markup(input: unknown): string {
  const result = renderFragment(input);
  if (result.status !== "ready")
    throw new Error(`Prepared renderer unit ${result.status}`);
  return result.html;
}
// SQLite returns an encoded JSON-string slice, so NUL and escape boundaries do
// not truncate substr(). Keep surrogate pairs and CRLF across chunk boundaries.
export function decodeTextSlice(
  wire: string,
  final: boolean,
): { text: string; consumed: number; consumedBytes: number } {
  // Most large bios contain plain ASCII. Avoid walking and parsing it twice.
  const ascii = wire.slice(0, 4096);
  if (ascii && /^[\x20-\x21\x23-\x5b\x5d-\x7f]*$/.test(ascii))
    return { text: ascii, consumed: ascii.length, consumedBytes: ascii.length };
  let safe = 0,
    units = 0,
    bytes = 0;
  const utf8 = (n: number) =>
    n === 0 || (n >= 0xd800 && n <= 0xdfff)
      ? 3
      : n <= 0x7f
        ? 1
        : n <= 0x7ff
          ? 2
          : n <= 0xffff
            ? 3
            : 4;
  for (let i = 0; i < wire.length; ) {
    let n = wire.codePointAt(i) ?? 0,
      addedUnits = n > 0xffff ? 2 : 1,
      addedBytes = utf8(n);
    if (wire[i] === "\\") {
      if (i + 1 >= wire.length) break;
      if (wire[i + 1] === "u") {
        if (i + 6 > wire.length) break;
        n = Number.parseInt(wire.slice(i + 2, i + 6), 16);
        i += 6;
        addedUnits = 1;
        addedBytes = utf8(n);
        if (n >= 0xd800 && n <= 0xdbff) {
          if (i + 6 > wire.length && !final) break;
          if (wire.slice(i, i + 2) === "\\u" && i + 6 <= wire.length) {
            const low = Number.parseInt(wire.slice(i + 2, i + 6), 16);
            if (low >= 0xdc00 && low <= 0xdfff) {
              i += 6;
              addedUnits = 2;
              addedBytes = 4;
            }
          }
        }
      } else {
        const escapedCharacter = wire[i + 1];
        i += 2;
        addedUnits = 1;
        addedBytes = 1;
        if (escapedCharacter === "r") {
          if (i === wire.length && !final) break;
          if (wire.slice(i, i + 2) === "\\n") {
            i += 2;
            addedUnits = 2;
            addedBytes = 2;
          }
        }
      }
    } else i += addedUnits;
    if (units + addedUnits > 4096 || bytes + addedBytes > 8192) break;
    units += addedUnits;
    bytes += addedBytes;
    safe = i;
  }
  if (!safe && wire) throw new Error("Unprogressing text slice");
  return {
    text: JSON.parse(`"${wire.slice(0, safe)}"`),
    consumed: Array.from(wire.slice(0, safe)).length,
    consumedBytes: new TextEncoder().encode(wire.slice(0, safe)).byteLength,
  };
}
// SQLite emits isolated UTF-16 surrogates as CESU-8. Transport hex avoids
// irreversible replacement by the D1 JSON decoder before display normalization.
export function decodeSqlString(hex: string): string {
  if (hex.length > 16384 || hex.length % 2 || !/^[a-f0-9]*$/i.test(hex))
    throw new Error("SQL string envelope");
  const bytes = Buffer.from(hex, "hex");
  let end = bytes.length;
  if (end) {
    let start = end - 1;
    while (
      start >= 0 &&
      (bytes[start] ?? 0) >= 0x80 &&
      (bytes[start] ?? 0) <= 0xbf
    )
      start--;
    if (start < 0) throw new Error("Invalid SQL string boundary");
    const first = bytes[start] ?? 0;
    const width = first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
    if (end - start < width) end = start;
  }
  for (let i = 0; i + 2 < end; i++) {
    if (
      bytes[i] === 0xed &&
      (bytes[i + 1] ?? 0) >= 0xa0 &&
      (bytes[i + 1] ?? 0) <= 0xbf &&
      (bytes[i + 2] ?? 0) >= 0x80 &&
      (bytes[i + 2] ?? 0) <= 0xbf
    ) {
      bytes.set([0xef, 0xbf, 0xbd], i);
      i += 2;
    }
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes.subarray(0, end),
  );
}
export async function advancePreparation(
  stack: Command[],
  source: PreparationSource,
): Promise<string> {
  const command = stack.pop();
  if (!command) return "";
  const push = (commands: Command[]) => {
    stack.push(...commands.reverse());
    if (stack.length > 96) throw new Error("Preparation depth exceeded");
  };
  if (command.kind === "frame") return markup(command);
  if (command.kind === "literal")
    return markup({ kind: "text", text: command.text });
  if (command.kind === "discover") {
    if (await source.discover(command.index))
      stack.push({ ...command, index: command.index + 4 });
    return "";
  }
  if (command.kind === "skills") {
    const group = await source.category(command.path, command.index);
    if (group) {
      const next: Command = { ...command, index: command.index + 1 };
      if (group.count)
        push([
          ...wrap("entry", [
            ...(group.id ? field("h3", group.namePath) : []),
            ...wrap("tags", [
              {
                kind: "skill-filter",
                path: command.path,
                index: 0,
                category: group.id,
              },
            ]),
          ]),
          next,
        ]);
      else stack.push(next);
    }
    return "";
  }
  if (command.kind === "skill-filter") {
    const index = await source.skill(
      command.path,
      command.category,
      command.index,
    );
    if (index !== null)
      push([
        ...field(
          "item",
          `${command.path}.data.entries[${index}].name`,
          "Unnamed skill",
        ),
        { ...command, index: command.index + 1 },
      ]);
    return "";
  }
  if (command.kind === "image") {
    // An enabled Face Reveal photo adds its description after the avatar's.
    const face =
      command.purpose === "avatar" &&
      command.side === "open" &&
      (await faceRevealEnabled(source));
    if (command.side === "open")
      push([
        text(`${command.path}.alt`),
        { ...command, side: face ? "face" : "close" },
      ]);
    if (command.side === "face")
      push([
        text("$.profile.faceReveal.image.alt"),
        { ...command, side: "close" },
      ]);
    return source.image(command.path, command.purpose, command.side);
  }
  if (
    command.kind === "page-start" ||
    command.kind === "page-end" ||
    command.kind === "profile-end" ||
    command.kind === "reuse-profile"
  )
    throw new Error("Page boundary requires durable dispatch");
  if (command.kind === "case-pages") {
    const page = await source.caseAt(command.index);
    if (page)
      push([
        {
          kind: "page-start",
          ordinal: command.index + 1,
          path: caseStudyPath(page.slug),
        },
        visit("profile", "$.profile"),
        ...wrap("page-nav", [
          ...wrap("page-link", [literal("Back to portfolio")], { path: "/" }),
        ]),
        ...wrap(
          "section",
          [
            ...field("h2", `${page.path}.title`, "Untitled project"),
            ...wrap("rich", [
              each("rich", `${page.path}.caseStudy.body.content`),
            ]),
          ],
          { id: `case-${command.index}`, component: "text" },
        ),
        { kind: "page-end" },
        { ...command, index: command.index + 1 },
      ]);
    return "";
  }
  if (command.kind === "resume-page") {
    const page = await source.resumeAt();
    if (page)
      push([
        { kind: "page-start", ordinal: page.ordinal, path: "/resume" },
        visit("profile", "$.profile"),
        { kind: "resume-file", path: page.path, variant: "page" },
        { kind: "page-end" },
      ]);
    return "";
  }
  if (command.kind === "resume-file")
    return source.resume(command.path, command.variant);
  if (command.kind === "root") {
    push([
      { kind: "page-start", ordinal: 0, path: "/" },
      visit("profile", "$.profile"),
      each("component", "$.components"),
      { kind: "page-end" },
      { kind: "case-pages", index: 0 },
      { kind: "resume-page" },
    ]);
    return "";
  }
  if (command.kind === "text") {
    const node = await source.read(command.path, command.offset);
    if (node.type !== "text" || !node.length)
      return markup({
        kind: "text",
        text: command.offset ? "" : command.fallback,
      });
    const wire = node.wire;
    const decoded = decodeTextSlice(
      wire,
      command.offset + new TextEncoder().encode(wire).byteLength >= node.length,
    );
    if (command.offset + decoded.consumedBytes < node.length)
      stack.push({
        ...command,
        offset: command.offset + decoded.consumedBytes,
      });
    return markup({ kind: "text", text: decoded.text });
  }
  if (command.kind === "each") {
    if (command.view === "component") {
      const batch = await source.components(command.path, command.index);
      if (batch.count) {
        stack.push({ ...command, index: command.index + batch.count });
        return batch.html;
      }
    }
    const node = await source.read(command.path);
    if (command.index < node.count)
      push([
        visit(command.view, `${command.path}[${command.index}]`),
        { ...command, index: command.index + 1 },
      ]);
    return "";
  }
  const p = command.path;
  const value = async (suffix: string) => (await source.read(p + suffix)).value;
  // Mirrors PortfolioProject's card link. Slugs come from the validated draft.
  const caseStudyLink = async (entry: string): Promise<Command[]> => {
    const slug = (await source.read(`${entry}.caseStudy.slug`)).value;
    if (typeof slug !== "string") return [];
    return wrap(
      "paragraph",
      wrap(
        "page-link",
        [
          literal("Read case study: "),
          text(`${entry}.title`, "Untitled project"),
        ],
        { path: caseStudyPath(slug) },
      ),
    );
  };
  const count = async (suffix: string) => (await source.read(p + suffix)).count;
  switch (command.view) {
    case "profile": {
      const location = await value(".location");
      const links = await source.read("$.profileLinks");
      push([
        ...wrap("profile", [
          {
            kind: "image",
            path: `${p}.banner`,
            purpose: "banner",
            side: "open",
          },
          {
            kind: "image",
            path: `${p}.avatar`,
            purpose: "avatar",
            side: "open",
          },
          ...wrap("profile-copy", [
            ...field("h1", `${p}.name`, "Name not added"),
            ...field("bio", `${p}.bio`, "Bio not added."),
            ...(location ? field("muted", `${p}.location`) : []),
            ...(links.count
              ? wrap("links", [each("link", "$.profileLinks")])
              : empty("No links added.")),
          ]),
        ]),
        { kind: "profile-end" },
      ]);
      break;
    }
    case "component": {
      const type = z
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
        .parse(await value(".type"));
      if (type === "resume") return source.resume(p, "component");
      const id = z.string().parse(await value(".id"));
      const titles = {
        projects: "Projects",
        skills: "Skills and technologies",
        "work-experience": "Work experience",
        text: "",
        "social-links": "Social links",
        github: "GitHub contributions",
        contact: "Contact",
      };
      const children: Command[] =
        type === "text"
          ? field("h2", `${p}.data.title`, "Untitled section")
          : wrap("h2", [literal(titles[type])]);
      switch (type) {
        case "projects":
          children.push(
            ...((await count(".data.entries"))
              ? [each("project", `${p}.data.entries`)]
              : empty("No projects added.")),
          );
          break;
        case "skills":
          children.push(
            ...((await count(".data.entries"))
              ? [{ kind: "skills", path: p, index: 0 } satisfies Command]
              : empty("No skills added.")),
          );
          break;
        case "work-experience":
          children.push(
            ...((await count(".data.entries"))
              ? [each("work", `${p}.data.entries`)]
              : empty("No work experience added.")),
          );
          break;
        case "text":
          children.push(
            ...((await count(".data.body.content"))
              ? wrap("rich", [each("rich", `${p}.data.body.content`)])
              : empty("No text added.")),
          );
          break;
        case "social-links":
          children.push(
            ...((await source.read("$.socialLinks")).count
              ? wrap("links", [each("link", "$.socialLinks")])
              : empty("No links added.")),
          );
          break;
        case "github": {
          const username = await value(".data.username");
          if (username)
            children.push(
              ...wrap(
                "paragraph",
                wrap("link", [text(`${p}.data.username`)], {
                  href: `https://github.com/${username}`,
                }),
              ),
            );
          children.push(...empty("Contribution graph unavailable."));
          break;
        }
        case "contact":
          children.push(...empty("Contact form unavailable."));
          break;
      }
      push(wrap("section", children, { id, component: type }));
      break;
    }
    case "project": {
      const html = await source.project(p);
      if (html !== null) return html;
      const image = await value(".image.assetId"),
        contribution = await value(".contribution");
      const code = await value(".codeUrl"),
        demo = await value(".demoUrl");
      push(
        wrap("article", [
          ...(image
            ? [
                {
                  kind: "image",
                  path: `${p}.image`,
                  purpose: "project",
                  side: "open",
                } satisfies Command,
              ]
            : []),
          ...field("h3", `${p}.title`, "Untitled project"),
          ...field("paragraph", `${p}.summary`, "Summary not added."),
          ...(contribution ? field("paragraph", `${p}.contribution`) : []),
          ...((await count(".technologies"))
            ? wrap("tags", [each("skill", `${p}.technologies`)])
            : []),
          ...(code || demo
            ? wrap("link-row", [
                ...(code
                  ? wrap("link", [literal("Code")], { href: String(code) })
                  : []),
                ...(demo
                  ? wrap("link", [literal("Demo")], { href: String(demo) })
                  : []),
              ])
            : []),
          ...(await caseStudyLink(p)),
        ]),
      );
      break;
    }
    case "work": {
      const href = await value(".organizationUrl"),
        current = await value(".current");
      push(
        wrap("article", [
          ...field("h3", `${p}.role`, "Role not added"),
          ...wrap(
            "paragraph",
            wrap(
              href ? "link" : "span",
              [text(`${p}.organization`, "Organization not added")],
              href ? { href: String(href) } : {},
            ),
          ),
          ...wrap("muted", [
            text(`${p}.startDate`, "Start date not added"),
            literal(" · "),
            ...(current
              ? [literal("Present")]
              : [text(`${p}.endDate`, "End date not added")]),
          ]),
          ...field("paragraph", `${p}.description`, "Description not added."),
        ]),
      );
      break;
    }
    case "group":
      push(
        wrap("entry", [
          ...((await value(".name")) ? field("h3", `${p}.name`) : []),
          ...wrap("tags", [each("skill", `${p}.skills`)]),
        ]),
      );
      break;
    case "skill":
      push(field("item", p, "Unnamed skill"));
      break;
    case "link": {
      const href = z.string().parse(await value(".href"));
      push(wrap("item", wrap("link", [text(`${p}.label`, "Link")], { href })));
      break;
    }
    case "rich": {
      const type = await value(".type");
      if (type === "image") {
        push([
          {
            kind: "image",
            path: `${p}.attrs`,
            purpose: "case_study",
            side: "open",
          },
        ]);
      } else if (type === "text") {
        const href = await value(".marks[0].attrs.href");
        push(
          wrap(
            href ? "link" : "span",
            [text(`${p}.text`)],
            href ? { href: String(href) } : {},
          ),
        );
      } else {
        let name: FrameName;
        switch (type) {
          case "paragraph":
            name = "paragraph";
            break;
          case "heading": {
            const level = z
              .number()
              .int()
              .min(2)
              .max(6)
              .parse(await value(".attrs.level"));
            name =
              level === 2
                ? "h3"
                : level === 3
                  ? "h4"
                  : level === 4
                    ? "h5"
                    : "h6";
            break;
          }
          case "bulletList":
            name = "list";
            break;
          case "orderedList":
            name = "ordered";
            break;
          case "listItem":
            name = "item";
            break;
          default:
            throw new Error("Unsupported rich node");
        }
        const start = name === "ordered" ? await value(".attrs.start") : null;
        push(
          wrap(
            name,
            [each("rich", `${p}.content`)],
            typeof start === "number" ? { start } : {},
          ),
        );
      }
      break;
    }
  }
  return "";
}
