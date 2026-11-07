import "@hasaweb/components/styles.css";
import { openFullPreview } from "./full-preview";

const root = document.getElementById("preview-root");
if (!root) throw new Error("Preview root is missing");
await openFullPreview(root);
