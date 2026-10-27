import { renderFragment } from "@hasaweb/render";
import { describe, expect, it } from "vitest";
import { normalizeText } from "../../../packages/render/src/parts";
import { decodeSqlString, decodeTextSlice } from "./publication-preparation";

describe("bounded publication text", () => {
  for (const source of [
    "hello",
    `${"a".repeat(2047)}😀<>&"'\r\nlast`,
    `${"a".repeat(2046)}\u0000tail`,
    `${"a".repeat(2046)}\\"suffix`,
    "\ufeffعمر".repeat(1200),
    `${"a".repeat(2045)}\ud800z`,
    `${"a".repeat(2046)}\r\nnext`,
  ]) {
    it(`preserves escaped Unicode and normalization (${source.length})`, () => {
      const wire = Array.from(JSON.stringify(source).slice(1, -1));
      let offset = 0,
        html = "";
      while (offset < wire.length) {
        const piece = wire.slice(offset, offset + 2048).join("");
        const decoded = decodeTextSlice(piece, offset + 2048 >= wire.length);
        expect(decoded.consumed).toBeGreaterThan(0);
        offset += decoded.consumed;
        const result = renderFragment({ kind: "text", text: decoded.text });
        expect(result.status).toBe("ready");
        if (result.status === "ready") html += result.html;
      }
      const expected = normalizeText(source)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#x27;");
      expect(html).toBe(expected);
    });
  }
  it("rejects an unbounded prepared text unit", () =>
    expect(
      renderFragment({ kind: "text", text: "x".repeat(4097) }).status,
    ).toBe("needs_partitioning"));
  it("rejects owner-controlled markup frames", () =>
    expect(
      renderFragment({ kind: "frame", frame: { name: "script" }, side: "open" })
        .status,
    ).toBe("invalid"));
});

it("normalizes isolated SQLite surrogates once and preserves real Unicode", () => {
  expect(decodeSqlString("41EDA08042EDB0805A")).toBe("A\uFFFDB\uFFFDZ");
  expect(decodeSqlString("F09F9880")).toBe("😀");
  expect(decodeSqlString("EFBFBDEFBFBDEFBFBD")).toBe("\uFFFD\uFFFD\uFFFD");
});
it("does not consume a partial UTF-8 scalar at a SQL slice boundary", () => {
  expect(decodeSqlString("41F09F98")).toBe("A");
  expect(decodeSqlString("41EDA0")).toBe("A");
  const value = decodeTextSlice("ع😀", true);
  expect(value.consumedBytes).toBe(6);
});

it("preserves safe attributes that contain the controlled child marker", () => {
  const frame = {
    name: "link",
    href: "https://example.test/S8_CONTROLLED_FRAME_CHILD",
  };
  const open = renderFragment({ kind: "frame", frame, side: "open" });
  const close = renderFragment({ kind: "frame", frame, side: "close" });
  expect(open.status).toBe("ready");
  expect(close.status).toBe("ready");
  if (open.status === "ready" && close.status === "ready")
    expect(`${open.html}ok${close.html}`).toBe(
      '<a href="https://example.test/S8_CONTROLLED_FRAME_CHILD" rel="noopener noreferrer">ok</a>',
    );
});
