export const DRAFT_LIMIT = 1_048_576;
export const FRAGMENT_BYTES = 8_192;
export const FRAGMENT_NODES = 64;
export type PageKind = "portfolio" | "case-study" | "resume";
export interface Atom {
  tag: string;
  text: string;
  href?: string;
  src?: string;
}
export interface Fixture {
  kind: PageKind;
  atoms: Atom[];
}
export const bytes = (value: string) => new TextEncoder().encode(value).length;
const prose =
  'Owner text <script>alert("unsafe")</script> & contribution details. ';

export function makeFixture(kind: PageKind): Fixture {
  const atoms: Atom[] = [
    { tag: "h1", text: "Alex Example, developer & designer" },
    { tag: "img", text: "Profile banner", src: "/assets/banner.webp" },
    { tag: "img", text: "Avatar", src: "/assets/avatar.webp" },
    { tag: "p", text: prose.repeat(8) },
    { tag: "a", text: "Contact Alex", href: "mailto:alex@example.test" },
  ];
  if (kind === "portfolio") {
    for (const section of [
      "Projects",
      "Skills",
      "Experience",
      "Text",
      "GitHub activity",
      "Contact form",
      "Social links",
      "Resume download",
    ]) {
      atoms.push({ tag: "h2", text: section });
    }
    for (let i = 0; i < 100; i++) {
      atoms.push({ tag: "h3", text: `Project ${i}: individual contribution` });
      atoms.push({
        tag: "img",
        text: `Project ${i}`,
        src: `/assets/project-${i}.webp`,
      });
      atoms.push({
        tag: "a",
        text: "Read case study",
        href: `/projects/project-${i}`,
      });
    }
    for (let i = 0; i < 100; i++) {
      atoms.push({ tag: "li", text: `Technology ${i}, category ${i % 10}` });
    }
    for (let i = 0; i < 20; i++) {
      atoms.push(
        { tag: "h3", text: `Role ${i} at Example organization` },
        { tag: "time", text: "2024-01 to present" },
        { tag: "p", text: prose.repeat(4) },
      );
    }
    for (let i = 0; i < 50; i++)
      atoms.push({ tag: "h2", text: `Text section ${i}` });
    for (let i = 0; i < 10; i++)
      atoms.push({
        tag: "a",
        text: `Social ${i}`,
        href: `https://example.test/profile-${i}`,
      });
    // GitHub's graph is drawn by the public script, not expanded by React SSR.
    atoms.push(
      {
        tag: "div",
        text: "GitHub contribution graph: last updated 2026-10-15",
      },
      { tag: "button", text: "Reveal face" },
      { tag: "img", text: "Real photo", src: "/assets/face.webp" },
      { tag: "a", text: "Download resume", href: "/resume" },
      { tag: "input", text: "Visitor name" },
      { tag: "textarea", text: "Message" },
      { tag: "button", text: "Send message" },
    );
  } else if (kind === "case-study") {
    atoms.push({ tag: "h2", text: "Case study with short rich-text nodes" });
    for (let i = 0; i < 200; i++) {
      atoms.push({
        tag: "img",
        text: `Case study image ${i}`,
        src: `/assets/case-${i}.webp`,
      });
    }
  } else {
    atoms.push(
      { tag: "h2", text: "Resume" },
      { tag: "iframe", text: "Resume PDF", src: "/assets/resume.pdf" },
      { tag: "a", text: "Download resume", href: "/assets/resume.pdf" },
      { tag: "a", text: "Back to portfolio", href: "/" },
    );
  }
  // Fill almost the entire draft allowance. Small case-study nodes stress tree
  // construction; longer portfolio paragraphs stress escaping/output bytes.
  // Resume spans stress shared chrome text at the same byte ceiling, without
  // inventing a structured resume editor or inlining PDF bytes.
  const text = kind === "case-study" ? prose : prose.repeat(8);
  const atom: Atom = { tag: kind === "resume" ? "span" : "p", text };
  let size = bytes(JSON.stringify({ kind, atoms }));
  const increment = bytes(JSON.stringify(atom)) + 1;
  while (size + increment <= DRAFT_LIMIT) {
    atoms.push({ ...atom });
    size += increment;
  }
  return { kind, atoms };
}

export function fragments(fixture: Fixture): string[] {
  const result: string[] = [];
  let group: Atom[] = [];
  let size = 2;
  for (const atom of fixture.atoms) {
    const atomBytes = bytes(JSON.stringify(atom));
    if (atomBytes + 2 > FRAGMENT_BYTES)
      throw new Error("Atom exceeds fragment bound");
    const increment = atomBytes + (group.length ? 1 : 0);
    if (group.length === FRAGMENT_NODES || size + increment > FRAGMENT_BYTES) {
      result.push(JSON.stringify(group));
      group = [];
      size = 2;
    }
    size += atomBytes + (group.length ? 1 : 0);
    group.push(atom);
  }
  if (group.length) result.push(JSON.stringify(group));
  return result;
}
