"use client";

import { clearSample } from "@hasaweb/schema";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  privateImageUrl,
  resumeFile,
  uploadResume,
} from "../lib/assets/browser";
import type { DraftController } from "../lib/draft/controller";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; blob: Blob; progress: number }
  | { kind: "failed"; blob: Blob; message: string }
  | { kind: "error"; message: string }
  | { kind: "complete" };

// Sets or removes the one resume PDF on the singleton resume component.
// A failed or cancelled upload never changes the current reference.
export function setResumeFile(
  controller: DraftController,
  componentId: string,
  assetId: string | null,
): void {
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Open your draft before changing the resume.");
  const next = {
    ...draft,
    components: draft.components.map((item) => {
      if (item.id !== componentId || item.type !== "resume") return item;
      const { file: _previous, ...data } = item.data;
      return { ...item, data: assetId ? { ...data, file: { assetId } } : data };
    }),
  };
  controller.update(clearSample(next, `components.${componentId}`));
}

export function ResumeUpload({
  controller,
  componentId,
  disabled: blocked,
}: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
}) {
  const id = useId();
  const state = useStore(controller.store);
  const disabled =
    blocked || state.suspended || state.error === "owner_changed";
  const live = useRef(disabled);
  live.current = disabled;
  const input = useRef<HTMLInputElement>(null);
  const attempt = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const pending = upload.kind === "uploading" || upload.kind === "failed";
  const pendingKey = `resume:${componentId}`;
  useLayoutEffect(() => {
    controller.store.setState((current) => ({
      pendingImages: { ...current.pendingImages, [pendingKey]: pending },
    }));
  }, [controller, pendingKey, pending]);
  useLayoutEffect(
    () => () =>
      controller.store.setState((current) => ({
        pendingImages: { ...current.pendingImages, [pendingKey]: false },
      })),
    [controller, pendingKey],
  );
  useEffect(
    () => () => {
      generation.current++;
      attempt.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!disabled) return;
    generation.current++;
    attempt.current?.abort();
    setUpload({ kind: "idle" });
  }, [disabled]);
  const component = state.working?.components.find(
    (item) => item.id === componentId,
  );
  if (component?.type !== "resume") return null;
  const file = component.data.file;
  function cancel() {
    generation.current++;
    attempt.current?.abort();
    setUpload({ kind: "idle" });
    requestAnimationFrame(() => input.current?.focus());
  }
  async function send(blob: Blob) {
    const expected = ++generation.current;
    const request = new AbortController();
    attempt.current = request;
    setUpload({ kind: "uploading", blob, progress: 0 });
    try {
      const assetId = await uploadResume({
        blob,
        ownerId: controller.identity.ownerId,
        signal: request.signal,
        onProgress: (progress) => {
          if (expected === generation.current)
            setUpload({ kind: "uploading", blob, progress });
        },
      });
      if (expected !== generation.current || live.current) return;
      try {
        setResumeFile(controller, componentId, assetId);
      } catch {
        throw new Error(
          "The PDF is ready but could not be added to your draft. Retry the upload.",
        );
      }
      setUpload({ kind: "complete" });
    } catch (cause) {
      if (expected === generation.current)
        setUpload({
          kind: "failed",
          blob,
          message:
            cause instanceof Error
              ? cause.message
              : "The upload could not finish. Retry the upload.",
        });
    }
  }
  async function select(selected: File) {
    try {
      await send(await resumeFile(selected));
    } catch (cause) {
      setUpload({
        kind: "error",
        message: cause instanceof Error ? cause.message : "Choose a PDF file.",
      });
    }
  }
  const busy = upload.kind === "uploading";
  return (
    <section
      className="resume-upload"
      aria-label="Resume PDF"
      data-publication-field="file"
    >
      <h3>Resume PDF</h3>
      <p className="editor-muted" data-resume-state={file ? "ready" : "empty"}>
        {file
          ? "A PDF is attached to your draft. Visitors see it after Publish."
          : "No PDF attached. Upload one before you Publish this section."}
      </p>
      <div className="profile-image-actions">
        <label className="profile-image-file" htmlFor={`${id}-file`}>
          {file ? "Replace resume PDF" : "Upload resume PDF"}
        </label>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept="application/pdf,.pdf"
          disabled={disabled || busy}
          aria-describedby={`${id}-formats`}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected) void select(selected);
          }}
        />
        {file && (
          <>
            <a
              href={privateImageUrl(file.assetId, "resume")}
              download="resume.pdf"
            >
              Download draft PDF
            </a>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                cancel();
                try {
                  setResumeFile(controller, componentId, null);
                } catch {
                  setUpload({
                    kind: "error",
                    message:
                      "The resume could not be removed. Reload the editor and retry.",
                  });
                }
              }}
            >
              Remove resume PDF
            </button>
          </>
        )}
      </div>
      <p id={`${id}-formats`} className="profile-image-note">
        One PDF, up to 10 MiB. The download controls and your /resume page use
        this file. Changes stay private until Publish.
      </p>
      <div aria-live="polite" role="status">
        {upload.kind === "uploading" && (
          <>
            <label htmlFor={`${id}-progress`}>
              {upload.progress < 100
                ? `Uploading ${upload.progress}%`
                : "Confirming upload..."}
            </label>
            <progress id={`${id}-progress`} value={upload.progress} max="100" />
            <button type="button" onClick={cancel}>
              Cancel upload
            </button>
          </>
        )}
        {upload.kind === "complete" && (
          <p>Upload complete. Your draft resume is ready.</p>
        )}
      </div>
      {(upload.kind === "failed" || upload.kind === "error") && (
        <div role="alert">
          <p>{upload.message}</p>
          {upload.kind === "failed" && (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void send(upload.blob)}
              >
                Retry upload
              </button>
              <button type="button" disabled={disabled} onClick={cancel}>
                Cancel upload
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function ResumeControls({
  controller,
  componentId,
  disabled,
}: {
  controller: DraftController;
  componentId: string;
  disabled: boolean;
}) {
  return (
    <section aria-label="Resume download controls">
      <h2>Resume download</h2>
      <p className="editor-muted">
        Adds a download button to your portfolio and a public /resume page that
        shows the same PDF. Move this section to choose where the button
        appears.
      </p>
      <ResumeUpload
        key={`${controller.scopeKey}:${componentId}`}
        controller={controller}
        componentId={componentId}
        disabled={disabled}
      />
    </section>
  );
}
