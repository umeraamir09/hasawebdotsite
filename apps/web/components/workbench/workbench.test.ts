import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { appearanceCatalog } from "@hasaweb/theme";
import { describe, expect, it } from "vitest";
import figma from "./figma-tokens.json";

const css = readFileSync(new URL("./workbench.css", import.meta.url), "utf8");
const fontsDir = new URL("../../fonts/", import.meta.url);
const fontManifest = JSON.parse(
  readFileSync(new URL("fonts.json", fontsDir), "utf8"),
) as {
  fonts: {
    family: string;
    weight: [number, number];
    asset: string;
    license: string;
    sha256: string;
  }[];
};

type Scheme = "light" | "dark";
type Tokens = Record<string, string>;

function block(pattern: RegExp): Tokens {
  const body = css.match(pattern)?.[1];
  if (!body) throw new Error(`No token block for ${pattern}`);
  return Object.fromEntries(
    [...body.matchAll(/--wb-([a-z-]+):\s*(#[0-9a-f]+);/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}
const tokens: Record<Scheme, Tokens> = {
  light: block(/:root,\s*\[data-wb-scheme="light"\]\s*\{([^}]*)\}/),
  dark: block(/\[data-wb-scheme="dark"\]\s*\{([^}]*)\}/),
};
const systemDark = block(
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/,
);

// Figma values that fail WCAG 2.2 AA in the pairs below, moved along OKLCH
// lightness to the nearest passing value. Everything else matches Figma.
const AA_ADJUSTMENTS: Record<Scheme, Tokens> = {
  light: {
    "text/tertiary": "#6c6b67",
    "success/base": "#007f3d",
    "warning/base": "#a65d00",
    "danger/base": "#ce2a33",
  },
  dark: { "text/tertiary": "#92918d" },
};
// Not in the Figma collection: the 3:1 boundary for toggle tracks and
// selected segments, and the toggle knob, which Figma fills with raw white.
const APP_ONLY = ["line-control", "knob"];

const cssName = (figmaName: string) => figmaName.replace("/", "-");

describe("Workbench tokens", () => {
  it("follows the operating system with the same values as the pinned dark scheme", () => {
    expect(systemDark).toEqual(tokens.dark);
  });

  for (const scheme of ["light", "dark"] as const) {
    it(`matches the Figma ${scheme} values except the listed AA adjustments`, () => {
      const expected = Object.fromEntries(
        Object.entries(figma[scheme]).map(([name, value]) => [
          cssName(name),
          AA_ADJUSTMENTS[scheme][name] ?? value,
        ]),
      );
      const { "line-control": _, knob: __, ...rest } = tokens[scheme];
      expect(rest).toEqual(expected);
      for (const name of APP_ONLY) expect(tokens[scheme][name]).toBeDefined();
      for (const [name, value] of Object.entries(AA_ADJUSTMENTS[scheme]))
        expect(value).not.toBe(figma[scheme][name as keyof typeof figma.light]);
    });
  }
});

function luminance(hex: string) {
  const linear = (index: number) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}
function token(scheme: Scheme, name: string) {
  const value = tokens[scheme][name];
  if (!value) throw new Error(`No ${scheme} token ${name}`);
  return value;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// [foreground, backgrounds, where the controls use the pair]
const TEXT_PAIRS: [string, string[], string][] = [
  ["text-inverse", ["ink-fill"], "primary button, selected filter chip"],
  [
    "text-primary",
    ["bg-panel", "bg-raised", "bg-sunken", "bg-hover", "bg-selected"],
    "labels, values, rows, segments, dialogs",
  ],
  [
    "text-secondary",
    ["bg-panel", "bg-raised", "bg-sunken", "bg-hover"],
    "field labels, filter chips, segments, draft pill",
  ],
  [
    "text-tertiary",
    ["bg-panel", "bg-raised", "bg-sunken", "bg-hover", "bg-selected"],
    "counters, trails, row meta, placeholders",
  ],
  [
    "danger-base",
    ["danger-soft", "bg-panel", "bg-raised"],
    "danger button, errors, issue pill",
  ],
  ["success-base", ["success-soft"], "live pill"],
  ["warning-base", ["warning-soft"], "pending pill"],
];
const NON_TEXT_PAIRS: [string, string[], string][] = [
  [
    "signal-base",
    [
      "bg-canvas",
      "bg-panel",
      "bg-raised",
      "bg-sunken",
      "bg-hover",
      "bg-selected",
    ],
    "focus ring, field focus, selected row, toggle on",
  ],
  ["knob", ["signal-base", "line-control"], "toggle knob on its track"],
  [
    "line-control",
    ["bg-panel", "bg-raised", "bg-sunken"],
    "toggle off, selected segment",
  ],
  [
    "danger-base",
    ["bg-sunken", "bg-panel", "bg-hover", "bg-selected"],
    "error border, issue dot",
  ],
  [
    "text-secondary",
    ["bg-panel", "bg-raised", "bg-sunken", "bg-hover"],
    "icons",
  ],
];

describe("Workbench contrast (WCAG 2.2 AA)", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const [pairs, minimum] of [
      [TEXT_PAIRS, 4.5],
      [NON_TEXT_PAIRS, 3],
    ] as const)
      for (const [foreground, backgrounds, use] of pairs)
        it(`${scheme}: ${foreground} reaches ${minimum}:1 (${use})`, () => {
          for (const background of backgrounds)
            expect(
              contrast(token(scheme, foreground), token(scheme, background)),
              `${foreground} on ${background}`,
            ).toBeGreaterThanOrEqual(minimum);
        });
  }
});

describe("Workbench fonts", () => {
  for (const font of fontManifest.fonts) {
    it(`pins ${font.family} by digest with its OFL notice`, () => {
      const bytes = readFileSync(new URL(font.asset, fontsDir));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        font.sha256,
      );
      expect(bytes.readUInt32BE(0)).toBe(0x00010000);
      const tags = Array.from({ length: bytes.readUInt16BE(4) }, (_, index) =>
        bytes.toString("ascii", 12 + index * 16, 16 + index * 16),
      );
      // A family pinned to one weight is a static face; a range needs the
      // variable font's weight axis.
      if (font.weight[0] !== font.weight[1]) expect(tags).toContain("fvar");
      expect(readFileSync(new URL(font.license, fontsDir), "utf8")).toContain(
        "SIL OPEN FONT LICENSE Version 1.1",
      );
    });

    it(`loads ${font.family} from the pinned file`, () => {
      const face = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
        .map((match) => match[1] ?? "")
        .find((body) => body.includes(`font-family: "${font.family}";`));
      expect(face).toContain(`url("../../fonts/${font.asset}")`);
      expect(face).toContain(`font-weight: ${font.weight.join(" ")};`);
    });

    it(`keeps ${font.family} out of the portfolio catalog`, () => {
      expect(
        appearanceCatalog.fonts.map((entry) => entry.family),
      ).not.toContain(font.family);
    });
  }
});
