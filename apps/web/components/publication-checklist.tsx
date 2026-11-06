"use client";

import {
  clearSample,
  componentRegistry,
  type DraftDoc,
  type PublicationIssue,
  type PublicationOperation,
  richText,
} from "@hasaweb/schema";
import { appearanceCatalog } from "@hasaweb/theme";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { getAt, resolveField } from "../lib/draft/planner";
import { checkPublication } from "../lib/draft/publication";
import {
  PublishFailure,
  publicationMessages,
  publicationRequest,
  publishSavedDraft,
} from "../lib/draft/publish";
import { DraftFailure, type FieldPath } from "../lib/draft/types";
import {
  canRemoveEditorComponent,
  removeEditorComponent,
} from "../lib/editor/components";
import { ComponentRemovalDialog } from "./component-controls";
import { DraftTextField } from "./draft-text-field";

export function publicationFieldLabel(
  issue: PublicationIssue,
  draft: DraftDoc | null,
) {
  const [root, index] = issue.path;
  const last = String(issue.path.at(-1));
  const fields: Record<string, string> = {
    name: "name",
    bio: "bio",
    avatar: "avatar",
    banner: "banner",
    label: "link label",
    value: "link destination",
    title: "title",
    summary: "summary",
    entries: "entries",
    categories: "categories",
    role: "role",
    organization: "organization",
    startDate: "start date",
    endDate: "end date",
    description: "description",
    body: "text",
    caseStudy: "case study",
    file: "resume PDF",
    recipientId: "contact recipient",
    username: "GitHub account",
    image: "image",
    assetId: "image",
  };
  if (root === "requestedSubdomain") return "portfolio address";
  if (root === "links")
    return issue.path.length === 1 ? "profile link" : (fields[last] ?? "link");
  if (root === "appearance") return last === "themeId" ? "theme" : "font";
  if (root === "seo") return "sharing image";
  if (root === "profile")
    return index === "decorationId"
      ? "avatar decoration"
      : index === "faceReveal"
        ? "Face Reveal image"
        : String(index);
  const component =
    root === "components" && typeof index === "number"
      ? draft?.components[index]
      : undefined;
  return component
    ? `${componentRegistry[component.type].picker.title.toLowerCase()} ${fields[last] ?? "details"}`
    : "section details";
}
export function publicationIssueLabel(
  issue: PublicationIssue,
  draft: DraftDoc | null,
) {
  const field = publicationFieldLabel(issue, draft);
  const message = {
    required: `Complete your ${field}`,
    address: "Reserve or restore your address",
    catalog: `Choose an approved ${field}`,
    asset: `Replace the unavailable ${field}`,
    github: "Connect GitHub and fetch activity",
    recipient: "Verify your contact recipient",
    case_study_url:
      "Reload the editor to restore this case study's published address",
  } satisfies Record<PublicationIssue["code"], string>;
  return message[issue.code];
}

export function PublicationChecklist({
  controller,
  disabled,
  onOpen,
  onPublished,
}: {
  controller: DraftController;
  disabled: boolean;
  onOpen(issue: PublicationIssue): void;
  onPublished?(): void;
}) {
  const state = useStore(controller.store);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof checkPublication>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<PublicationOperation | null>(null);
  const [copied, setCopied] = useState(false);
  const publishing = useRef<AbortController | null>(null);
  const alive = useRef(true);
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
  const current =
    result &&
    result.revision === state.confirmed?.revision &&
    result.draft === state.working &&
    !Object.keys(state.inputs).length &&
    !state.error &&
    !Object.values(state.pendingImages).some(Boolean)
      ? result
      : null;
  async function check() {
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const next = await checkPublication(controller);
      if (alive.current) setResult(next);
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof DraftFailure && cause.code === "recovery_required"
            ? "Finish or resolve unsaved input, uploads and draft recovery, then check again."
            : "Could not check this saved draft. Resolve any save or sign-in issue, then retry.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function publish() {
    if (publishing.current) return;
    const abort = new AbortController();
    publishing.current = abort;
    setBusy(true);
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
            }
          }
        },
        abort.signal,
      );
      if (!alive.current) return;
      if (next.kind === "blocked") setResult(next);
      else {
        setOperation(next.operation);
        if (!notified) onPublished?.();
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
      if (alive.current) setBusy(false);
    }
  }
  const stageLabel = {
    admitting: "Saving publication request...",
    preparing: "Preparing your saved content...",
    assembling: "Building complete pages...",
    transferring: "Preparing images and files...",
    ready: "Publishing your portfolio...",
    withdrawing:
      "Your new version is live. Finishing removal of withdrawn files...",
    published: "Publication complete.",
    failed: "Publication did not complete.",
  };
  return (
    <section
      className="publication-checklist"
      aria-label="Publication checklist"
    >
      <h2>Before you publish</h2>
      <p className="editor-muted">
        Check your saved content, uploads and address. Sample sections are
        omitted until you edit them.
      </p>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void check()}
      >
        {busy ? "Checking saved draft..." : "Check publication readiness"}
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void publish()}
      >
        {busy && publishing.current
          ? "Publishing..."
          : error ||
              (operation &&
                operation.stage !== "published" &&
                operation.stage !== "failed")
            ? "Retry Publish"
            : "Publish"}
      </button>
      {error && <p role="alert">{error}</p>}
      <div role="status" aria-live="polite">
        {operation && <p>{stageLabel[operation.stage]}</p>}
        {current && !current.issues.length && !current.hasMoreIssues && (
          <p>Saved draft passed the checklist. You can publish it now.</p>
        )}
        {!current && result && (
          <p>Your draft changed. Check it again before publishing.</p>
        )}
        {current?.hasMoreIssues && (
          <p>More issues remain. Fix the listed items and check again.</p>
        )}
      </div>
      {operation &&
        (operation.stage === "published" ||
          operation.stage === "withdrawing") && (
          <div className="publication-url">
            <p>Published portfolio</p>
            <a href={operation.url} target="_blank" rel="noopener noreferrer">
              Open published portfolio
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(operation.url)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      "Could not copy the URL. Select and copy the address below.",
                    ),
                  );
              }}
            >
              {copied ? "Copied" : "Copy public URL"}
            </button>
            <p>{operation.url}</p>
          </div>
        )}
      {Object.values(state.inputs).length > 0 && (
        <ul>
          {Object.values(state.inputs).map((input) => {
            let path: PublicationIssue["path"];
            try {
              path = state.working
                ? resolveField(state.working, input.path)
                : [];
            } catch {
              path = [
                typeof input.path[0] === "string" ? input.path[0] : "profile",
              ];
            }
            return (
              <li key={JSON.stringify(input.path)}>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => onOpen({ code: "required", path })}
                >
                  Finish unsaved{" "}
                  {publicationFieldLabel(
                    { code: "required", path },
                    state.working,
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {current && (
        <ul>
          {current.issues.map((issue) => (
            <li key={JSON.stringify(issue)}>
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => onOpen(issue)}
              >
                {publicationIssueLabel(issue, state.working)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
              allowed={canRemoveEditorComponent(component)}
              onCancel={() => setRemoving(false)}
              onRemove={() => {
                if (removeEditorComponent(controller, component.id)) onClose();
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
      {issue.path[0] === "seo" && (
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
