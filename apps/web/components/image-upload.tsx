"use client";

import type { ImageReference } from "@hasaweb/schema";
import { useEffect, useId, useRef, useState } from "react";
import {
  privateImageUrl,
  readPrivateImage,
  uploadImage,
} from "../lib/assets/browser";
import {
  type CropPurpose,
  type LocalImage,
  openLocalImage,
} from "../lib/assets/crop";
import { ImageCropDialog } from "./image-crop-dialog";
import "./profile-images.css";

type UploadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "cropping"; image: LocalImage }
  | { kind: "uploading"; blob: Blob; progress: number }
  | { kind: "failed"; blob: Blob; message: string }
  | { kind: "error"; message: string }
  | { kind: "complete" };

export function ImageUpload({
  label,
  purpose,
  value,
  description,
  descriptionInvalid = false,
  ownerId,
  disabled,
  onReady,
  onRemove,
  onDescription,
}: {
  label: string;
  purpose: CropPurpose;
  value: ImageReference | undefined;
  description: string;
  descriptionInvalid?: boolean;
  ownerId: string;
  disabled: boolean;
  onReady(assetId: string): void;
  onRemove(): void;
  onDescription(value: string): void;
}) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const attempt = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const current = useRef({ disabled, onReady });
  current.current = { disabled, onReady };
  const localImage = state.kind === "cropping" ? state.image : null;
  useEffect(() => () => localImage?.release(), [localImage]);
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
    setState({ kind: "idle" });
  }, [disabled]);
  function cancel() {
    generation.current++;
    attempt.current?.abort();
    setState({ kind: "idle" });
    file.current?.focus();
  }
  async function select(blob: Blob) {
    const expected = ++generation.current;
    setState({ kind: "loading" });
    try {
      const image = await openLocalImage(blob);
      if (expected !== generation.current || current.current.disabled)
        image.release();
      else setState({ kind: "cropping", image });
    } catch (cause) {
      if (expected === generation.current)
        setState({
          kind: "error",
          message:
            cause instanceof Error ? cause.message : "Choose another image.",
        });
    }
  }
  async function cropExisting() {
    if (!value) return;
    const expected = ++generation.current;
    const request = new AbortController();
    attempt.current = request;
    setState({ kind: "loading" });
    try {
      const blob = await readPrivateImage({
        id: value.assetId,
        purpose,
        ownerId,
        signal: request.signal,
      });
      if (expected === generation.current) await select(blob);
    } catch (cause) {
      if (expected === generation.current)
        setState({
          kind: "error",
          message:
            cause instanceof Error
              ? cause.message
              : "Select the original image again.",
        });
    }
  }
  async function upload(blob: Blob) {
    const expected = ++generation.current;
    const request = new AbortController();
    attempt.current = request;
    setState({ kind: "uploading", blob, progress: 0 });
    try {
      const assetId = await uploadImage({
        blob,
        purpose,
        ownerId,
        signal: request.signal,
        onProgress: (progress) => {
          if (expected === generation.current)
            setState({ kind: "uploading", blob, progress });
        },
      });
      if (expected !== generation.current || current.current.disabled) return;
      current.current.onReady(assetId);
      setState({ kind: "complete" });
    } catch (cause) {
      if (expected === generation.current)
        setState({
          kind: "failed",
          blob,
          message:
            cause instanceof Error
              ? cause.message
              : "The upload could not finish. Retry the upload.",
        });
    }
  }
  const busy = state.kind === "loading" || state.kind === "uploading";
  return (
    <section className="profile-image-control" aria-label={`${label} image`}>
      <h3>{label}</h3>
      <div className={`profile-image-preview profile-image-preview-${purpose}`}>
        {value && unavailable !== value.assetId ? (
          <img
            src={privateImageUrl(value.assetId, purpose)}
            alt={description}
            onError={() => setUnavailable(value.assetId)}
          />
        ) : (
          <span>
            {value
              ? "Image unavailable. Replace it to try again."
              : `Add your ${purpose}`}
          </span>
        )}
      </div>
      <div className="profile-image-actions">
        <label className="profile-image-file" htmlFor={`${id}-file`}>
          {value ? `Replace ${purpose}` : `Upload ${purpose}`}
        </label>
        <input
          ref={file}
          id={`${id}-file`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          aria-describedby={`${id}-formats`}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected) void select(selected);
          }}
        />
        {value && (
          <>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void cropExisting()}
            >
              Crop {purpose}
            </button>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                cancel();
                onRemove();
              }}
            >
              Remove {purpose}
            </button>
          </>
        )}
      </div>
      <p id={`${id}-formats`} className="profile-image-note">
        JPEG, PNG or WebP. Up to 5 MiB. Only the finished crop is saved.
      </p>
      {value && (
        <div className="editor-field">
          <label htmlFor={`${id}-description`}>{label} description</label>
          <input
            id={`${id}-description`}
            value={description}
            disabled={disabled}
            onChange={(event) => onDescription(event.target.value)}
            aria-invalid={descriptionInvalid}
            aria-describedby={`${id}-description-note${descriptionInvalid ? ` ${id}-description-local` : ""}`}
          />
          <p className="profile-image-note" id={`${id}-description-note`}>
            Describe meaningful content. Leave this empty if the image is
            decorative.
          </p>
          {descriptionInvalid && (
            <p className="editor-input-note" id={`${id}-description-local`}>
              Unfinished input stays in this browser. The preview keeps the last
              valid description.
            </p>
          )}
        </div>
      )}
      <div aria-live="polite" role="status">
        {state.kind === "loading" && <p>Opening image...</p>}
        {state.kind === "uploading" && (
          <>
            <label htmlFor={`${id}-progress`}>
              {state.progress < 100
                ? `Uploading ${state.progress}%`
                : "Confirming upload..."}
            </label>
            <progress id={`${id}-progress`} value={state.progress} max="100" />
            <button type="button" onClick={cancel}>
              Cancel upload
            </button>
          </>
        )}
        {state.kind === "complete" && (
          <p>Upload complete. Your draft image is ready.</p>
        )}
      </div>
      {(state.kind === "failed" || state.kind === "error") && (
        <div role="alert">
          <p>{state.message}</p>
          {state.kind === "failed" && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void upload(state.blob)}
            >
              Retry upload
            </button>
          )}
        </div>
      )}
      {state.kind === "cropping" && (
        <ImageCropDialog
          image={state.image}
          purpose={purpose}
          onCancel={cancel}
          onApply={(blob) => void upload(blob)}
        />
      )}
    </section>
  );
}
