import { describe, expect, it } from "vitest";
import {
  type Atom,
  bytes,
  DRAFT_LIMIT,
  FRAGMENT_BYTES,
  FRAGMENT_NODES,
  fragments,
  makeFixture,
} from "./fixtures";
import { prefix, renderAtoms, renderFixture, suffix } from "./render";

describe("S-1 fixtures and fragment boundaries", () => {
  for (const kind of ["portfolio", "case-study", "resume"] as const) {
    it(`${kind} fits the draft bound and preserves output across fragments`, () => {
      const fixture = makeFixture(kind);
      const size = bytes(JSON.stringify(fixture));
      expect(size).toBeLessThanOrEqual(DRAFT_LIMIT);
      expect(size).toBeGreaterThan(DRAFT_LIMIT * 0.99);
      const chunks = fragments(fixture);
      const decoded = chunks.flatMap((chunk) => {
        expect(bytes(chunk)).toBeLessThanOrEqual(FRAGMENT_BYTES);
        const atoms = JSON.parse(chunk) as Atom[];
        expect(atoms.length).toBeLessThanOrEqual(FRAGMENT_NODES);
        return atoms;
      });
      expect(decoded).toEqual(fixture.atoms);
      const html = renderFixture(fixture);
      expect(
        prefix +
          chunks.map((chunk) => renderAtoms(JSON.parse(chunk))).join("") +
          suffix,
      ).toBe(html);
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
      if (kind === "resume") {
        expect(html).toContain("<iframe");
        expect(html).toContain("Download resume");
      }
    });
  }
  it("rejects a single node beyond the fragment bound", () => {
    expect(() =>
      fragments({
        kind: "portfolio",
        atoms: [{ tag: "p", text: "x".repeat(FRAGMENT_BYTES) }],
      }),
    ).toThrow("Atom exceeds fragment bound");
  });
});
