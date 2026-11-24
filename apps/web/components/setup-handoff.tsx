"use client";

import { useRef, useState } from "react";
import type { RecoveryCoordinator } from "../lib/draft/recovery-coordinator";
import { Button } from "./workbench";
import "./setup-handoff.css";

export function SetupHandoff({
  recovery,
  onEntered,
  send,
}: {
  recovery: RecoveryCoordinator;
  onEntered: (
    result: Awaited<ReturnType<RecoveryCoordinator["handoff"]>>,
  ) => void;
  send?: typeof fetch;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function open() {
    if (busy.current) return;
    const state = recovery.store.getState();
    if (state.busy || state.review) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const entered = await recovery.handoff(send);
      if (entered.result.kind === "editor") onEntered(entered);
      else if (entered.result.kind === "required")
        setMessage(
          `Complete ${entered.result.issues.join(", ")} before opening the editor.`,
        );
    } catch {
      setMessage(
        "We couldn't open the editor. Your input remains available. Check required fields and saved changes, then retry.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="setup-handoff workbench">
      <Button kind="primary" disabled={pending} onClick={() => void open()}>
        {pending ? "Opening editor..." : "Open editor"}
      </Button>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
