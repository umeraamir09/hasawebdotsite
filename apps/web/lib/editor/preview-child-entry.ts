// The editor's iframe preview child, served by the web Worker at
// `/editor/preview` and built to `/preview-assets/editor.*`.
import { openEditorPreview } from "./preview-child";
import "@hasaweb/components/styles.css";

const root = document.getElementById("preview-root");
if (!root) throw new Error("Preview root is missing");
await openEditorPreview(root);
