import { connectPreviewBridge } from "@hasaweb/components/browser";
import { projectPortfolioCancellable } from "@hasaweb/components/model";
import { createRoot } from "react-dom/client";
import { EditorSession } from "../components/editor-session";
import { readOwner } from "../lib/auth-client";
import { createRecoveryStorage } from "../lib/draft/recovery";
import "../app/globals.css";

const owner = await readOwner();
if (!owner?.portfolio)
  throw new Error("An authenticated portfolio is required");
const scope = { ownerId: owner.user.id, portfolioId: owner.portfolio.id };
const element = document.getElementById("root");
if (!element) throw new Error("Editor root is missing");
const root = createRoot(element);
const storage = createRecoveryStorage(scope.ownerId, scope.portfolioId);
const fixture = {
  ready: false,
  recovery: null as
    | Parameters<NonNullable<Parameters<typeof EditorSession>[0]["onReady"]>>[0]
    | null,
  storage,
  scope,
  root,
  connectPreviewBridge,
  projectPortfolioCancellable,
  rerender,
};
function rerender() {
  root.render(
    <EditorSession
      owner={{ ...scope }}
      previewDocument="/private/editor-preview"
      onReady={(recovery) => {
        fixture.recovery = recovery;
        fixture.ready = true;
      }}
    />,
  );
}
Object.assign(window, { editorFixture: fixture });
rerender();
