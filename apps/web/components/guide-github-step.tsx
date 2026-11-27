"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { removeEditorComponent } from "../lib/editor/components";
import {
  type GraphPreviewData,
  type GraphSetupStatus,
  loadGraphPreview,
  withdrawGraphAccess,
} from "../lib/editor/github-graph";
import { acceptGraph, findGraph } from "../lib/guide/github";
import { clearLinkReturn, linkReturnNotice } from "../lib/sign-in-methods";
import { ComponentRemovalDialog } from "./section-removal-dialog";
import { useGitHubGraph } from "./use-github-graph";
import { Button, Icon, StatusPill } from "./workbench";

// The GitHub step (Figma 471:11820). A GitHub sign-up sees its own graph,
// public and private, already connected; Continue adds it and Skip leaves it
// out. A Google owner connects GitHub as a sign-in method; that account
// becomes the graph. Authorization returns to this saved step.
export function GuideGitHub({
  controller,
  disabled,
  onStatus,
  beforeConsent,
}: {
  controller: DraftController;
  disabled: boolean;
  onStatus(status: GraphSetupStatus | null): void;
  beforeConsent(): Promise<boolean>;
}) {
  const state = useStore(controller.store);
  const graph = findGraph(state.working);
  const id = useId();
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState<GraphPreviewData>(null);
  const inactive =
    disabled || state.suspended || state.error === "owner_changed";
  const flow = useGitHubGraph({
    draftUsername: graph?.data.username ?? "",
    autoConnect: true,
    returnTo: "setup",
    beforeConsent,
    // Leaving for GitHub: the draft must name the account on return.
    onSelected: (username) => acceptGraph(controller, username),
    // The sign-in's graph is added on Continue, unless one already exists.
    onConnected: (username) => {
      if (findGraph(controller.store.getState().working))
        acceptGraph(controller, username);
    },
  });
  const { status, account, busy } = flow;
  // Linking GitHub returns here through `/editor`. A refused link (for
  // example, the account signs in to another hasaweb.site account) is
  // shown once; a successful one connects on open.
  const setProblem = flow.setProblem;
  useEffect(() => {
    const notice = linkReturnNotice(location.search, "GitHub");
    if (!notice) return;
    clearLinkReturn();
    if (notice.kind === "error") setProblem(notice.text);
  }, [setProblem]);
  const reportStatus = useRef(onStatus);
  reportStatus.current = onStatus;
  useEffect(() => {
    if (status) reportStatus.current(status);
  }, [status]);
  const off = inactive || busy;
  // Offer Connect whenever the graph is not live: link GitHub if missing,
  // connect the sign-in token, or replace a stale selected account after
  // the owner switches GitHub sign-in.
  const canConnect = !flow.connected && !!status && status.privateAvailable;

  const privateState = status?.private.state ?? "off";
  const statusAt =
    status?.private.state === "ready" ? status.private.fetchedAt : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new fetch time re-reads the calendar.
  useEffect(() => {
    if (!flow.connected) {
      setPreview(null);
      return;
    }
    const request = new AbortController();
    loadGraphPreview(request.signal, true)
      .then((next) => {
        if (!request.signal.aborted) setPreview(next);
      })
      .catch(() => {
        // An aborted read is replaced by the next one.
      });
    return () => request.abort();
  }, [flow.connected, statusAt]);

  const canAuthorize =
    !!account &&
    !flow.connected &&
    ["off", "consent_failed", "reconnect", "authorizing"].includes(
      privateState,
    );
  const canRetry =
    !!account && !flow.connected && ["pending", "error"].includes(privateState);
  const pill = busy
    ? { status: "pending" as const, label: account ? "Checking" : "Connecting" }
    : flow.connected
      ? { status: "live" as const, label: "Connected" }
      : account
        ? { status: "issue" as const, label: "Unfinished" }
        : null;
  return (
    <section
      aria-label="GitHub activity controls"
      className="guide-github"
      data-guide-github={
        graph ? "added" : flow.connected ? "connected" : "none"
      }
    >
      {account && (
        <div className="guide-big-field" data-publication-field="username">
          <Icon name="github" size={20} />
          <a
            className="guide-github-account"
            href={account.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{account.username}
          </a>
          {pill && (
            <span className="guide-big-field-status">
              <StatusPill status={pill.status}>{pill.label}</StatusPill>
            </span>
          )}
        </div>
      )}
      {canConnect && (
        <div className="guide-github-actions">
          <Button
            kind="primary"
            icon="github"
            data-github-action="connect"
            disabled={off}
            onClick={() => void flow.connectGitHub()}
          >
            {busy ? "Connecting..." : "Connect GitHub"}
          </Button>
        </div>
      )}
      {flow.problem && (
        <p className="guide-field-error" role="alert">
          {flow.problem}
        </p>
      )}
      <p
        id={`${id}-status`}
        role="status"
        className={
          !account || flow.connected
            ? "wb-visually-hidden"
            : "guide-github-note"
        }
        data-github-status={privateState}
      >
        {account ? flow.summary.text : ""}
      </p>
      {flow.connected && status?.private.state === "ready" && (
        <section
          className="guide-card guide-graph"
          aria-label="Contribution graph"
        >
          <div className="guide-graph-head">
            <span>
              {status.private.total.toLocaleString("en")}{" "}
              {status.private.total === 1 ? "contribution" : "contributions"}
            </span>
            <span className="guide-graph-range">last 12 months</span>
          </div>
          <Calendar days={preview?.days ?? []} />
        </section>
      )}
      <div className="guide-github-actions">
        {canAuthorize && (
          <Button
            size="s"
            data-github-action="authorize"
            disabled={off}
            onClick={() => void flow.authorize()}
          >
            {privateState === "off" ? "Authorize on GitHub" : "Authorize again"}
          </Button>
        )}
        {canRetry && (
          <Button
            size="s"
            data-github-action="retry"
            disabled={off}
            onClick={() => void flow.retry()}
          >
            Retry
          </Button>
        )}
        {graph && (
          <Button
            size="s"
            kind="ghost"
            icon="trash"
            className="guide-github-remove"
            disabled={off}
            onClick={() => setRemoving(true)}
          >
            Remove graph
          </Button>
        )}
      </div>
      {graph && removing && (
        <ComponentRemovalDialog
          title="GitHub activity"
          disabled={inactive}
          withdrawal
          onCancel={() => setRemoving(false)}
          onRemove={async () => {
            // Access goes first, at once and without Publish. A failure
            // keeps the graph so nothing claims a removal.
            await withdrawGraphAccess();
            if (
              !removeEditorComponent(controller, graph.id, {
                accessWithdrawn: true,
              })
            )
              return;
            setRemoving(false);
            onStatus(null);
            void flow.reload();
          }}
        />
      )}
    </section>
  );
}

// The graph preview: one column per week, darker for busier days.
function Calendar({ days }: { days: { date: string; count: number }[] }) {
  const recent = days.slice(-53 * 7);
  const max = Math.max(1, ...recent.map((day) => day.count));
  return (
    <div className="guide-calendar" aria-hidden="true">
      {recent.map((day) => (
        <span
          key={day.date}
          data-level={day.count === 0 ? 0 : Math.ceil((day.count / max) * 4)}
        />
      ))}
    </div>
  );
}
