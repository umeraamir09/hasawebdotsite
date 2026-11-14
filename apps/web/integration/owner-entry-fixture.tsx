// Browser test bundle only. It mounts the production `OwnerEntry` resolver
// that the gated `/auth/entry` and `/editor` pages render, so the guide,
// Review, handoff and editor run through the same routing code. The page
// shell is the harness's; the iframe document is the production Worker's
// `/editor/preview` route.

import { createRoot } from "react-dom/client";
import { OwnerEntry } from "../components/owner-entry";
import { createRecoveryStorage } from "../lib/draft/recovery";
import type { RecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import "../app/globals.css";

const element = document.getElementById("root");
if (!element) throw new Error("Owner entry root is missing");
const route = location.pathname === "/editor" ? "editor" : "entry";
type Scope = { ownerId: string; portfolioId: string };
const guide = {
  ready: false,
  signOuts: 0,
  recovery: null as RecoveryCoordinator | null,
  scope: null as Scope | null,
};
const editor = {
  ready: false,
  signOuts: 0,
  recovery: null as RecoveryCoordinator | null,
  scope: null as Scope | null,
  storage: null as ReturnType<typeof createRecoveryStorage> | null,
};
Object.assign(window, {
  ownerEntryFixture: { route },
  ...(route === "entry" ? { guideFixture: guide } : { editorFixture: editor }),
});
createRoot(element).render(
  <OwnerEntry
    route={route}
    // Signing out would revoke the shared fixture session; record intent only.
    onSignOut={async () => {
      (route === "entry" ? guide : editor).signOuts++;
    }}
    onGuideReady={(recovery, scope) => {
      Object.assign(guide, { recovery, scope, ready: true });
    }}
    onEditorReady={(recovery, scope) => {
      Object.assign(editor, {
        recovery,
        scope,
        storage: createRecoveryStorage(scope.ownerId, scope.portfolioId),
        ready: true,
      });
    }}
  />,
);
