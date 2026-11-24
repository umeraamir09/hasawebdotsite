"use client";

import {
  clearSample,
  componentRegistry,
  type DraftDoc,
  type PublicationIssue,
  type PublicationOperation,
  type PublicationSite,
  richText,
} from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { getAt, resolveField } from "../lib/draft/planner";
import {
  type checkPublication,
  readPublicationIssues,
} from "../lib/draft/publication";
import {
  publicationFieldLabel,
  publicationIssueLabel,
} from "../lib/draft/publication-labels";
import {
  PublishFailure,
  publicationMessages,
  publicationRequest,
  publishSavedDraft,
} from "../lib/draft/publish";
import { DraftFailure, type FieldPath } from "../lib/draft/types";
import { removeEditorComponent } from "../lib/editor/components";
import { withdrawGraphAccess } from "../lib/editor/github-graph";
import { sectionIcons, sectionLabel } from "../lib/editor/sections";
import {
  type PublicationSiteState,
  siteHost,
} from "../lib/editor/use-publication-site";
import { AddressControl } from "./address-control";
import { DraftTextField } from "./draft-text-field";
import { ResumeUpload } from "./resume-controls";
import { ComponentRemovalDialog } from "./section-removal-dialog";
import { Button, Icon, type IconName, StatusPill } from "./workbench";
import "./publish-popover.css";

type Check = Awaited<ReturnType<typeof checkPublication>>;
type Row = { key: string; issue: PublicationIssue; label: string };

// Where an issue lives, shown under its label with that section's icon.
function issuePlace(
  issue: PublicationIssue,
  draft: DraftDoc | null | undefined,
): { place: string; icon: IconName } {
  const [root, index] = issue.path;
  if (root === "components" && typeof index === "number") {
    const component = draft?.components[index];
    if (component)
      return {
        place: sectionLabel(component),
        icon: sectionIcons[component.type],
      };
  }
  if (root === "appearance") return { place: "Style", icon: "palette" };
  if (root === "seo" || root === "requestedSubdomain")
    return { place: "Share", icon: "globe" };
  if (root === "links") return { place: "Links", icon: "link" };
  return { place: "Profile", icon: "user" };
}

/**
 * The Publish popover (Figma 414:8373, states 414:9545). Opening it checks
 * the saved draft; each issue opens its control. The button shows the first
 * publish, ready, publishing, published and failed states.
 */
export function PublicationChecklist({
  controller,
  disabled,
  open,
  site,
  onOpen,
  onPublished,
  onIssues,
}: {
  controller: DraftController;
  disabled: boolean;
  open: boolean;
  site: PublicationSiteState;
  onOpen(issue: PublicationIssue): void;
  onPublished?(): void;
  // The number shown on the Publish button.
  onIssues?(count: number): void;
}) {
  const state = useStore(controller.store);
  const idPrefix = useId();
  const [result, setResult] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [publishingNow, setPublishingNow] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<PublicationOperation | null>(null);
  const [copied, setCopied] = useState(false);
  // The revision just published. Its "You're live" view lasts until the
  // popover closes or the draft changes.
  const [celebrated, setCelebrated] = useState<number | null>(null);
  const publishing = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const reportIssues = useRef(onIssues);
  reportIssues.current = onIssues;
  const { refresh: refreshSite } = site;
  const busy = checking || publishingNow;
  useEffect(() => {
    alive.current = true;
    void publicationRequest(controller, "status", {})
      .then((current) => {
        if (alive.current && !publishing.current) setOperation(current);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      publishing.current?.abort();
    };
  }, [controller]);
  useEffect(() => {
    if (!open) {
      setCelebrated(null);
      setCopied(false);
    }
  }, [open]);
  const saved =
    !Object.keys(state.inputs).length &&
    !state.error &&
    !Object.values(state.pendingImages).some(Boolean);
  const current =
    result &&
    result.revision === state.confirmed?.revision &&
    result.draft === state.working &&
    saved
      ? result
      : null;
  // Opening the popover, or a new saved revision while it is open, reads
  // the saved draft's issues once. The read pauses nothing, so editing
  // continues while it runs; Publish runs the full check.
  const attempted = useRef<number | null>(null);
  const revision = state.confirmed?.revision ?? null;
  const readable =
    open &&
    !disabled &&
    !publishingNow &&
    !current &&
    saved &&
    state.status === "saved" &&
    revision !== null;
  useEffect(() => {
    if (!readable || revision === null || attempted.current === revision)
      return;
    attempted.current = revision;
    const abort = new AbortController();
    const draft = controller.store.getState().working;
    let finished = false;
    setChecking(true);
    setError("");
    readPublicationIssues(controller.identity, revision, fetch, abort.signal)
      .then(({ issues, hasMoreIssues }) => {
        finished = true;
        if (!abort.signal.aborted)
          setResult({ revision, issues, hasMoreIssues, draft });
      })
      .catch(() => {
        finished = true;
        if (!abort.signal.aborted)
          setError(
            "Could not check this saved draft. Resolve any save or sign-in issue, then retry.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setChecking(false);
      });
    return () => {
      abort.abort();
      setChecking(false);
      // An interrupted read runs again when the draft is readable.
      if (!finished) attempted.current = null;
    };
  }, [controller, readable, revision]);
  const issueCount =
    (current ? current.issues.length : 0) + Object.keys(state.inputs).length;
  useEffect(() => reportIssues.current?.(issueCount), [issueCount]);

  async function publish() {
    if (publishing.current) return;
    const abort = new AbortController();
    publishing.current = abort;
    setPublishingNow(true);
    setError("");
    setCopied(false);
    setOperation(null);
    let notified = false;
    try {
      const next = await publishSavedDraft(
        controller,
        (current) => {
          if (alive.current) {
            setOperation(current);
            if (
              !notified &&
              (current.stage === "withdrawing" || current.stage === "published")
            ) {
              notified = true;
              onPublished?.();
              void refreshSite();
            }
          }
        },
        abort.signal,
      );
      if (!alive.current) return;
      if (next.kind === "blocked") setResult(next);
      else {
        setOperation(next.operation);
        if (next.operation.stage === "published")
          setCelebrated(next.operation.revision);
        if (!notified) onPublished?.();
        void refreshSite();
      }
    } catch (cause) {
      if (alive.current)
        setError(
          publicationMessages[
            cause instanceof DraftFailure || cause instanceof PublishFailure
              ? cause.code
              : "publication_unavailable"
          ] ??
            publicationMessages.publication_unavailable ??
            "Retry publication.",
        );
    } finally {
      publishing.current = null;
      if (alive.current) setPublishingNow(false);
    }
  }

  const status = site.site?.status;
  const live = status === "published";
  const host = siteHost(site.site, state.working?.requestedSubdomain);
  const liveUrl =
    live && site.site?.url
      ? site.site.url
      : operation && "url" in operation
        ? operation.url
        : null;
  // Only a publication this tab is driving runs; an unfinished one found on
  // load offers Try again, which resumes it.
  const running = publishingNow;
  const failed =
    !publishingNow &&
    (Boolean(error && !checking) || operation?.stage === "failed");
  const firstPublish = !status || status === "draft";
  const stages = [
    "admitting",
    "preparing",
    "assembling",
    "transferring",
    "ready",
    "withdrawing",
  ];
  const progress = operation
    ? (stages.indexOf(operation.stage) + 1) / (stages.length + 1)
    : 0.08;
  const rows: Row[] = [
    ...Object.values(state.inputs).map((input) => {
      let path: PublicationIssue["path"];
      try {
        path = state.working ? resolveField(state.working, input.path) : [];
      } catch {
        path = [typeof input.path[0] === "string" ? input.path[0] : "profile"];
      }
      const issue: PublicationIssue = { code: "required", path };
      return {
        key: `input:${JSON.stringify(input.path)}`,
        issue,
        label: `Finish unsaved ${publicationFieldLabel(issue, state.working)}`,
      };
    }),
    ...(current?.issues ?? []).map((issue) => ({
      key: JSON.stringify(issue),
      issue,
      label: publicationIssueLabel(issue, state.working),
    })),
  ];
  const ready = current !== null && rows.length === 0 && !current.hasMoreIssues;
  const buttonLabel = running
    ? "Publishing"
    : failed ||
        (operation !== null &&
          operation.stage !== "published" &&
          operation.stage !== "failed")
      ? "Try again"
      : firstPublish
        ? "Publish"
        : "Publish changes";

  if (celebrated !== null && celebrated === revision && liveUrl)
    return (
      <section
        className="publish-popover publish-done"
        aria-label="Publication checklist"
      >
        <span className="publish-done-mark" aria-hidden="true">
          <Icon name="check" size={24} />
        </span>
        <p className="publish-done-title" role="status">
          You're live
        </p>
        <a
          className="publish-done-url"
          href={liveUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {new URL(liveUrl).host}
        </a>
        <div className="publish-actions">
          <Button
            icon="copy"
            onClick={() => {
              void navigator.clipboard
                .writeText(liveUrl)
                .then(() => setCopied(true))
                .catch(() => setError("Could not copy the URL."));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <a
            className="wb-button"
            data-kind="primary"
            data-size="m"
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="arrow-up-right" size={16} />
            Open
          </a>
        </div>
      </section>
    );

  return (
    <section className="publish-popover" aria-label="Publication checklist">
      {firstPublish ? (
        // Mounted only while open, so the Share panel's field is the only
        // other address control on the page.
        open && (
          <>
            <h2 className="publish-title">Your address</h2>
            <AddressControl
              controller={controller}
              disabled={disabled}
              compact
            />
          </>
        )
      ) : (
        <div className="publish-site">
          <SitePill status={status} />
          <span className="publish-host">{host}</span>
        </div>
      )}
      {running && (
        <div className="publish-progress" aria-hidden="true">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {failed && (
        <p className="publish-failed" role="alert">
          <Icon name="alert" size={18} />
          {error || "Couldn't publish. Your live site hasn't changed."}
        </p>
      )}
      {rows.length > 0 && (
        <div className="publish-issues">
          <div className="publish-issues-head">
            <h2 className="publish-title">Before you publish</h2>
            <StatusPill status="issue">
              {rows.length}
              {current?.hasMoreIssues ? "+" : ""} to fix
            </StatusPill>
          </div>
          <ul>
            {rows.map((row, index) => {
              const { place, icon } = issuePlace(row.issue, state.working);
              const rowId = `${idPrefix}-${index}`;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    className="publish-issue"
                    disabled={disabled || publishingNow}
                    aria-labelledby={`${rowId}-label`}
                    aria-describedby={`${rowId}-place`}
                    onClick={() => onOpen(row.issue)}
                  >
                    <span className="publish-issue-icon" aria-hidden="true">
                      <Icon name={icon} size={16} />
                    </span>
                    <span className="publish-issue-text">
                      <span
                        className="publish-issue-label"
                        id={`${rowId}-label`}
                      >
                        {row.label}
                      </span>
                      <span
                        className="publish-issue-place"
                        id={`${rowId}-place`}
                      >
                        {place}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div role="status" aria-live="polite" className="publish-state">
        {checking ? (
          <span className="publish-checking">
            <Icon name="loader" size={18} />
            Checking
          </span>
        ) : ready ? (
          <span className="publish-passed">
            <Icon name="check-circle" size={18} />
            All checks passed
          </span>
        ) : null}
      </div>
      {/* With issues listed the button turns grey (Figma 414:9543) but
          stays usable: Publish checks the saved draft again on the server
          and lists what blocks it. */}
      <Button
        kind={rows.length > 0 ? "secondary" : "primary"}
        className="publish-button"
        data-running={running || undefined}
        icon={running ? "loader" : failed ? "refresh" : undefined}
        disabled={disabled || busy || running}
        onClick={() => void publish()}
      >
        {buttonLabel}
      </Button>
    </section>
  );
}

export function SitePill({
  status,
}: {
  status: PublicationSite["status"] | undefined;
}) {
  return status === "published" ? (
    <StatusPill status="live">Live</StatusPill>
  ) : status === "suspended" ? (
    <StatusPill status="issue">Suspended</StatusPill>
  ) : status === "unpublished" ? (
    <StatusPill status="pending">Offline</StatusPill>
  ) : (
    <StatusPill status="draft">Private</StatusPill>
  );
}

export function PublicationCorrection({
  controller,
  issue,
  componentId,
  target,
  disabled,
  onClose,
}: {
  controller: DraftController;
  issue: PublicationIssue;
  componentId: string | null;
  target: FieldPath;
  disabled: boolean;
  onClose(): void;
}) {
  const [removing, setRemoving] = useState(false);
  const state = useStore(controller.store);
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    region.current?.focus();
  }, []);
  const draft = state.working;
  if (!draft) return null;
  const index = componentId
    ? draft.components.findIndex((item) => item.id === componentId)
    : issue.path[0] === "components" && typeof issue.path[1] === "number"
      ? issue.path[1]
      : null;
  const component = index === null ? undefined : draft.components[index];
  let value: unknown;
  try {
    value = getAt(draft, resolveField(draft, target));
  } catch {
    return null;
  }
  const textInput = state.inputs[JSON.stringify(target)]?.value;
  const catalog = issue.code === "catalog";
  const options =
    issue.path[0] === "appearance"
      ? issue.path[1] === "themeId"
        ? appearanceCatalog.themes
        : appearanceCatalog.fonts
      : appearanceCatalog.decorations;
  return (
    <section
      className="publication-correction"
      aria-label="Publication correction"
      tabIndex={-1}
      ref={region}
    >
      <h2>{publicationIssueLabel(issue, state.working)}</h2>
      {catalog && (
        <label>
          Approved option
          <select
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => controller.edit(target, event.target.value)}
          >
            <option value="" disabled>
              Choose an option
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {catalog && issue.path[0] === "profile" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const profile = { ...draft.profile };
            delete profile.decorationId;
            controller.update({ ...draft, profile });
            onClose();
          }}
        >
          Remove decoration
        </button>
      )}
      {component && (
        <>
          <p>{componentRegistry[component.type].picker.title}</p>
          {(typeof value === "string" || issue.path.at(-1) === "endDate") &&
            issue.code === "required" && (
              <DraftTextField
                controller={controller}
                disabled={disabled}
                label="Required value"
                path={target}
                multiline
              />
            )}
          {component.type === "resume" && (
            <ResumeUpload
              controller={controller}
              componentId={component.id}
              disabled={disabled}
            />
          )}
          {component.type === "text" && issue.path.at(-1) === "body" && (
            <label>
              Section text
              <textarea
                disabled={disabled}
                defaultValue={typeof textInput === "string" ? textInput : ""}
                onChange={(event) => {
                  if (
                    controller.edit(
                      ["components", { id: component.id }, "data", "body"],
                      richText(event.target.value),
                    )
                  ) {
                    const edited = controller.store.getState().working;
                    if (edited)
                      controller.update(
                        clearSample(edited, `components.${component.id}`),
                      );
                  } else controller.setInput(target, event.target.value);
                }}
              />
            </label>
          )}
          <p className="editor-muted">
            Complete this section using its controls, or remove it to publish
            without it. Configuration tools for some sections are not available
            in this editor yet.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setRemoving(true)}
          >
            Remove this section
          </button>
          {removing && (
            <ComponentRemovalDialog
              title={componentRegistry[component.type].picker.title}
              disabled={disabled}
              withdrawal={component.type === "github"}
              onCancel={() => setRemoving(false)}
              onRemove={async () => {
                if (component.type === "github") await withdrawGraphAccess();
                if (
                  removeEditorComponent(controller, component.id, {
                    accessWithdrawn: component.type === "github",
                  })
                )
                  onClose();
              }}
            />
          )}
        </>
      )}
      {issue.path[0] === "profile" && issue.path[1] === "faceReveal" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            controller.edit(["profile", "faceReveal", "enabled"], false);
            onClose();
          }}
        >
          Turn Face Reveal off
        </button>
      )}
      {issue.path[0] === "seo" && issue.path[1] === "ogImage" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const seo = { ...draft.seo };
            delete seo.ogImage;
            controller.update({ ...draft, seo });
            onClose();
          }}
        >
          Use the default sharing image
        </button>
      )}
      <button type="button" onClick={onClose}>
        Close correction
      </button>
    </section>
  );
}
