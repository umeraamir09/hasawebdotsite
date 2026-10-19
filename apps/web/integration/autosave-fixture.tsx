// Browser test bundle only. This file has no production route or import.
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { DraftRecovery } from "../components/draft-recovery";
import { DraftStatus } from "../components/draft-status";
import { createDraftController } from "../lib/draft/controller";
import { createRecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import { createDraftTransport } from "../lib/draft/transport";
import "../app/globals.css";

const owner = (await (await fetch("/api/owner")).json()) as {
  user: { id: string };
  portfolio: { id: string };
};
const fault = { action: "", mode: "", calls: [] as string[] };
const send: typeof fetch = async (input, init) => {
  const action = String(input).split("/").at(-1) ?? "";
  fault.calls.push(action);
  if (fault.action === action && fault.mode === "before") {
    fault.action = "";
    throw new Error("Fixture dropped outgoing request");
  }
  const response = await fetch(input, init);
  if (fault.action === action && fault.mode === "after") {
    fault.action = "";
    throw new Error("Fixture dropped reply");
  }
  return response;
};
const options = {
  ownerId: owner.user.id,
  portfolioId: owner.portfolio.id,
  context:
    new URL(location.href).searchParams.get("context") === "content"
      ? "content"
      : "setup",
  transport: createDraftTransport(owner.user.id, owner.portfolio.id, send),
} as const;
const controller = createDraftController(options);
const recovery = createRecoveryCoordinator({ ...options, controller });
function Fixture() {
  const recoveryState = useStore(recovery.store);
  const current = recoveryState.controller;
  const state = useStore(current.store);
  return (
    <main className="editor-entry">
      <h1>Autosave fixture</h1>
      <label style={{ display: "grid", gap: 8, margin: "24px 0" }}>
        Name
        <input
          id="fixture-name"
          disabled={state.suspended || Boolean(recoveryState.review)}
          value={state.working?.profile.name ?? ""}
          onChange={(event) =>
            current.edit(["profile", "name"], event.target.value)
          }
        />
      </label>
      {new URL(location.href).searchParams.has("recovery") ? (
        <DraftRecovery recovery={recovery} />
      ) : (
        <DraftStatus controller={current} />
      )}
    </main>
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(<Fixture />);
Object.assign(window, {
  fixture: {
    get controller() {
      return recovery.store.getState().controller;
    },
    recovery,
    fault,
    ready: false,
  },
});
await controller.initialize().catch(() => {});
(window as unknown as { fixture: { ready: boolean } }).fixture.ready = true;
