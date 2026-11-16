import { connectPreviewBridge } from "../../packages/components/src/browser";
import { parsePortfolioModel } from "../../packages/components/src/model";

const frame = document.querySelector("iframe");
if (!frame) throw new Error("Preview iframe is missing");
const bridge = connectPreviewBridge({
  iframe: frame,
  origin: location.origin,
  channel: "phase16-fixture",
  identity: { ownerId: "fixture-owner-a", portfolioId: "fixture-portfolio-a" },
  onState: (state) => Object.assign(window, { rendererState: state }),
  onSelect: () => {},
});
Object.assign(window, { rendererBridge: bridge });
const name = new URL(location.href).searchParams.get("fixture") ?? "complete";
const response = await fetch(
  `/private/model?fixture=${encodeURIComponent(name)}`,
);
if (!response.ok) throw new Error("Private fixture access denied");
const model = parsePortfolioModel(await response.json());
if (!model) throw new Error("Invalid fixture model");
bridge.request(async () => model);
window.addEventListener("pagehide", () => bridge.dispose(), { once: true });
