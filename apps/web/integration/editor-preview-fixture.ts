import { openEditorPreview } from "../lib/editor/preview-child";
import "@hasaweb/components/styles.css";

const root = document.getElementById("preview-root");
if (!root) throw new Error("Preview root is missing");
await openEditorPreview(root);
