// Must stay first: it prepares the globals satori needs while it loads.
import "./satori-prelude";
import webp from "@jsquash/webp/codec/dec/webp_dec.wasm";
import resvg from "@resvg/resvg-wasm/index_bg.wasm";
import yoga from "satori/layout.wasm";
import type { CardModules } from "./sharing-card-render";

// The Worker's card renderer, loaded only by the card stage. Vitest imports
// sharing-card-render directly and compiles the same wasm files itself.
export { cardImage, renderSharingCard } from "./sharing-card-render";
export const cardModules: CardModules = { yoga, resvg, webp };
