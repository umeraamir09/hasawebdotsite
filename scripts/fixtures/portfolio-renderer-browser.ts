import {
  attachPreviewBridge,
  mountPreview,
} from "../../packages/components/src/browser";

const root = document.getElementById("preview-root");
if (!root) throw new Error("Preview root is missing");
const preview = mountPreview(
  root,
  {
    profile: {
      name: "",
      bio: "",
      avatar: { state: "missing" },
      banner: { state: "missing" },
      links: [],
    },
    components: [],
  },
  { assetOrigins: [location.origin] },
);
const detach = attachPreviewBridge({
  target: preview,
  root,
  identity: { ownerId: "fixture-owner-a", portfolioId: "fixture-portfolio-a" },
  parentWindow: window.parent,
  parentOrigin: location.origin,
  channel: "phase16-fixture",
  assetOrigins: [location.origin],
});
window.addEventListener(
  "pagehide",
  () => {
    detach();
    preview.dispose();
  },
  { once: true },
);
