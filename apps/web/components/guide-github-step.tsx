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
            className="guide-github-connect"
            data-github-action="connect"
            disabled={off}
            onClick={() => void flow.connectGitHub()}
          >
            {/* The filled GitHub mark from the sign-in page, in the text color. */}
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12.0001 2C6.47789 2 2 6.59042 2 12.2532C2 16.7833 4.86531 20.6266 8.83867 21.9824C9.33844 22.0773 9.52195 21.7599 9.52195 21.4891C9.52195 21.2446 9.51266 20.437 9.50836 19.5802C6.72633 20.2004 6.1393 18.3705 6.1393 18.3705C5.68438 17.1854 5.02891 16.8703 5.02891 16.8703C4.12164 16.2338 5.09734 16.2469 5.09734 16.2469C6.10148 16.3192 6.63023 17.3035 6.63023 17.3035C7.52219 18.871 8.96969 18.4178 9.54031 18.1558C9.63008 17.4932 9.88922 17.0409 10.1752 16.7848C7.95406 16.5256 5.61914 15.6464 5.61914 11.7177C5.61914 10.5983 6.00977 9.68356 6.64945 8.96553C6.54563 8.70728 6.20336 7.66451 6.74633 6.25215C6.74633 6.25215 7.58609 5.97659 9.49711 7.30317C10.2948 7.076 11.1502 6.96209 12.0001 6.95817C12.8499 6.96209 13.7061 7.076 14.5052 7.30317C16.4139 5.97659 17.2525 6.25215 17.2525 6.25215C17.7968 7.66451 17.4544 8.70728 17.3505 8.96553C17.9917 9.68356 18.3797 10.5983 18.3797 11.7177C18.3797 15.6557 16.0403 16.5229 13.8135 16.7767C14.1722 17.0949 14.4918 17.7189 14.4918 18.6754C14.4918 20.0473 14.4802 21.1514 14.4802 21.4891C14.4802 21.762 14.6602 22.0817 15.1671 21.981C19.1383 20.6238 22 16.7817 22 12.2532C22 6.59042 17.5227 2 12.0001 2Z" />
            </svg>
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
