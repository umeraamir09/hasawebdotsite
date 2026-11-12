// Browser test bundle only. This file has no production route or import.
// It mounts the Phase 42A setup guide for an authenticated owner who has not
// entered the editor; production activation remains Phase 42E.

import { createRoot } from "react-dom/client";
import { SetupGuide } from "../components/setup-guide";
import { readOwner } from "../lib/auth-client";
import type { RecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import "../app/globals.css";

const owner = await readOwner();
if (!owner?.portfolio)
  throw new Error("An authenticated portfolio is required");
const scope = { ownerId: owner.user.id, portfolioId: owner.portfolio.id };
const element = document.getElementById("root");
if (!element) throw new Error("Guide root is missing");
const fixture = {
  ready: false,
  signOuts: 0,
  recovery: null as RecoveryCoordinator | null,
  scope,
};
Object.assign(window, { guideFixture: fixture });
createRoot(element).render(
  <SetupGuide
    owner={scope}
    // Signing out would revoke the shared fixture session; record intent only.
    onSignOut={async () => {
      fixture.signOuts++;
    }}
    onReady={(recovery) => {
      fixture.recovery = recovery;
      fixture.ready = true;
    }}
  />,
);
