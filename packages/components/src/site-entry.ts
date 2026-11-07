import { applyStoredMode, installSite } from "./site";

// Loaded as a render-blocking script in <head>. The stored visitor mode is
// applied before the body exists; controls attach once the document parses.
applyStoredMode(document);
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => installSite(document), {
    once: true,
  });
else installSite(document);
