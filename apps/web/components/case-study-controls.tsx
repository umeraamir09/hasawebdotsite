"use client";

import {
  type ComponentOf,
  caseStudyPath,
  type PublishedCaseStudy,
} from "@hasaweb/schema";
import { useState } from "react";
import type { DraftController } from "../lib/draft/controller";
import { addCaseStudy, removeCaseStudy } from "../lib/editor/case-studies";
import { RichTextEditor } from "./rich-text-editor";

type Project = ComponentOf<"projects">["data"]["entries"][number];
export type CaseStudyAddressState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; addresses: PublishedCaseStudy[] };

export function CaseStudyControls({
  controller,
  componentId,
  entry,
  inactive,
  addresses,
  onRetry,
}: {
  controller: DraftController;
  componentId: string;
  entry: Project;
  inactive: boolean;
  addresses: CaseStudyAddressState;
  onRetry(): void;
}) {
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState("");
  const path = [
    "components",
    { id: componentId },
    "data",
    "entries",
    { id: entry.id },
    "caseStudy",
    "body",
  ];
  const frozen =
    addresses.status === "ready" &&
    addresses.addresses.some(
      (item) =>
        item.projectId === entry.id ||
        (item.projectId === null && item.slug === entry.caseStudy?.slug),
    );
  return (
    <section aria-label="Case study" className="case-study-controls">
      <h3>Case study</h3>
      {addresses.status === "loading" && (
        <p role="status">Checking published case-study addresses...</p>
      )}
      {addresses.status === "error" && (
        <div role="alert">
          <p>Could not check published case-study addresses.</p>
          <button type="button" disabled={inactive} onClick={onRetry}>
            Retry address check
          </button>
        </div>
      )}
      {!entry.caseStudy ? (
        <>
          <p className="editor-muted">
            Add an optional page about this project. Its card links to it after
            Publish.
          </p>
          <button
            type="button"
            disabled={inactive || addresses.status !== "ready"}
            onClick={() => {
              if (addresses.status !== "ready") return;
              setMessage(
                addCaseStudy(
                  controller,
                  componentId,
                  entry.id,
                  addresses.addresses,
                )
                  ? "Case study ready to edit."
                  : "This draft cannot fit a case study. Shorten content and try again.",
              );
            }}
          >
            Add case study
          </button>
        </>
      ) : (
        <>
          <p data-case-study-path={caseStudyPath(entry.caseStudy.slug)}>
            Public address: <code>{caseStudyPath(entry.caseStudy.slug)}</code>
          </p>
          <p className="editor-muted">
            {frozen
              ? "Published. This address stays the same when you change the project title."
              : "Set from the project title until the first Publish, then fixed."}
          </p>
          <RichTextEditor
            controller={controller}
            path={path}
            sampleKey={`components.${componentId}`}
            label="Case study body"
            inactive={inactive}
            images
          />
          <button type="button" onClick={() => setRemoving(true)}>
            Remove case study
          </button>
          {removing && (
            <fieldset aria-label="Confirm case study removal">
              <p>
                Remove this case study and its content? The public page stays
                until you Publish. After that, its address shows a page
                unavailable message.
              </p>
              <button
                type="button"
                onClick={() => {
                  removeCaseStudy(controller, componentId, entry.id);
                  setRemoving(false);
                  setMessage("Case study removed from your draft.");
                }}
              >
                Confirm remove case study
              </button>
              <button type="button" onClick={() => setRemoving(false)}>
                Keep case study
              </button>
            </fieldset>
          )}
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
