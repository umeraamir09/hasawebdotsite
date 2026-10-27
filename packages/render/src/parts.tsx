import { frameInputSchema, PortfolioFrame } from "@hasaweb/components/frames";

export {
  type FrameInput,
  type FrameName,
  frameInputSchema,
} from "@hasaweb/components/frames";

import { withinBounds } from "@hasaweb/components/model";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";

export const partSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string().max(4096) }),
  z.strictObject({
    kind: z.literal("frame"),
    frame: frameInputSchema,
    side: z.enum(["open", "close"]),
  }),
]);
export type RenderPart = z.infer<typeof partSchema>;
export function normalizeText(value: string): string {
  return new TextDecoder("utf-8", { ignoreBOM: true, fatal: false }).decode(
    new TextEncoder().encode(
      value.replace(/\r\n?/g, "\n").replaceAll("\u0000", "\uFFFD"),
    ),
  );
}
export function escapeDisplayText(value: string): string {
  return normalizeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}
export function renderPart(input: unknown): string {
  if (
    !withinBounds(input, {
      maxNodes: 32,
      maxDepth: 4,
      maxString: 4096,
      maxBytes: 16384,
    })
  )
    throw new Error("Part exceeds its bounded envelope");
  const part = partSchema.parse(input);
  if (part.kind === "text") return escapeDisplayText(part.text);
  const marker = "S8_CONTROLLED_FRAME_CHILD";
  const frame =
    part.frame.href === undefined
      ? part.frame
      : { ...part.frame, href: normalizeText(part.frame.href) };
  const markup = renderToStaticMarkup(
    <PortfolioFrame frame={frame}>{marker}</PortfolioFrame>,
  );
  const index = markup.lastIndexOf(marker);
  if (index < 0) throw new Error("Invalid frame");
  return part.side === "open"
    ? markup.slice(0, index)
    : markup.slice(index + marker.length);
}
