// biome-ignore-all lint/performance/noImgElement: Private owner images come from the authorized asset route; Cloudflare image optimization is disabled.
"use client";

import type { ImageReference } from "@hasaweb/schema";
import { useRef, useState } from "react";
import { privateImageUrl } from "../lib/assets/browser";
import { type UploadPurpose, useImageUpload } from "./image-upload";
import { Button, Field, IconButton, Popover } from "./workbench";

// An editor image (Figma 409:2175): the picture itself with a camera button.
// The button picks a file when the slot is empty and otherwise opens the
// image's options: replace, crop, description and remove. Upload progress
// and errors show beside the picture.
export function ImageSlot({
  label,
  purpose,
  noun,
  variant,
  value,
  description,
  descriptionInvalid,
  ownerId,
  providerPortfolioId,
  disabled,
  onReady,
  onRemove,
  onDescription,
  onPendingChange,
}: {
  label: string;
  purpose: UploadPurpose;
  noun: string;
  variant: "banner" | "avatar" | "tile";
  value: ImageReference | undefined;
  description: string;
  descriptionInvalid: boolean;
  ownerId: string;
  providerPortfolioId?: string | undefined;
  disabled: boolean;
  onReady(assetId: string): void;
  onRemove(): void;
  onDescription(value: string): void;
  onPendingChange(pending: boolean): void;
}) {
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [options, setOptions] = useState(false);
  const picture = useRef<HTMLDivElement>(null);
  // The options close as an action starts, so focus returns to the camera.
  const camera = () =>
    picture.current?.querySelector<HTMLElement>(".image-slot-camera");
  const upload = useImageUpload({
    returnFocus: camera,
    purpose,
    value,
    ownerId,
    providerPortfolioId,
    disabled,
    onReady,
    onPendingChange,
  });
  const { state, busy } = upload;
  const uncropped = purpose === "project" || purpose === "case_study";
  const close = () => {
    camera()?.focus();
    setOptions(false);
  };
  const pickFile = () => {
    close();
    upload.file.current?.click();
  };
  const broken = value !== undefined && unavailable === value.assetId;
  return (
    <section
      className="image-slot"
      data-variant={variant}
      aria-label={`${label} image`}
    >
      <div className="image-slot-picture" ref={picture}>
        {value && !broken && (
          <img
            src={privateImageUrl(value.assetId, purpose)}
            alt={description}
            onError={() => setUnavailable(value.assetId)}
          />
        )}
        {broken &&
          (variant === "avatar" ? (
            <IconButton
              icon="refresh"
              label={`Retry ${noun} preview`}
              className="image-slot-retry"
              disabled={disabled || busy}
              onClick={() => setUnavailable(null)}
            />
          ) : (
            <Button
              size="s"
              kind="ghost"
              icon="refresh"
              className="image-slot-retry"
              disabled={disabled || busy}
              onClick={() => setUnavailable(null)}
            >
              Retry {noun} preview
            </Button>
          ))}
        {value || providerPortfolioId ? (
          <Popover
            label={label}
            align={variant === "avatar" ? "start" : "end"}
            open={options}
            onOpenChange={setOptions}
            trigger={(props) => (
              <IconButton
                {...props}
                icon="camera"
                kind="raised"
                label={`Edit ${noun}`}
                className="image-slot-camera"
                disabled={disabled || busy}
              />
            )}
          >
            <div className="image-slot-options">
              <Button kind="ghost" icon="upload" onClick={pickFile}>
                {value ? `Replace ${noun}` : `Upload ${noun}`}
              </Button>
              {providerPortfolioId && (
                <Button
                  kind="ghost"
                  icon="user"
                  onClick={() => {
                    close();
                    void upload.importPhoto();
                  }}
                >
                  Use my account photo
                </Button>
              )}
              {value && !uncropped && (
                <Button
                  kind="ghost"
                  icon="image"
                  onClick={() => {
                    close();
                    void upload.cropExisting();
                  }}
                >
                  Crop {noun}
                </Button>
              )}
              {value && (
                <>
                  <Field
                    label={`${label} description`}
                    value={description}
                    disabled={disabled}
                    error={
                      descriptionInvalid
                        ? "Unfinished input stays in this browser. The preview keeps the last valid description."
                        : undefined
                    }
                    onChange={(event) => onDescription(event.target.value)}
                  />
                  <Button
                    kind="danger"
                    icon="trash"
                    onClick={() => {
                      close();
                      upload.cancel();
                      onRemove();
                    }}
                  >
                    Remove {noun}
                  </Button>
                </>
              )}
            </div>
          </Popover>
        ) : (
          <IconButton
            icon="camera"
            kind="raised"
            label={`Add ${noun}`}
            className="image-slot-camera"
            disabled={disabled || busy}
            onClick={pickFile}
          />
        )}
      </div>
      <input
        ref={upload.file}
        type="file"
        className="wb-visually-hidden"
        tabIndex={-1}
        aria-label={value ? `Replace ${noun}` : `Upload ${noun}`}
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled || busy}
        onChange={upload.choose}
      />
      <div className="image-slot-status">
        <div aria-live="polite" role="status" data-upload={state.kind}>
          {state.kind === "loading" && (
            <>
              <p>Opening image...</p>
              <Button size="s" kind="ghost" onClick={upload.cancel}>
                Cancel image selection
              </Button>
            </>
          )}
          {state.kind === "uploading" && (
            <>
              <p>
                {state.progress < 100
                  ? `Uploading ${state.progress}%`
                  : "Confirming upload..."}
              </p>
              <progress
                value={state.progress}
                max="100"
                aria-label={`${label} upload`}
              />
              <Button size="s" kind="ghost" onClick={upload.cancel}>
                Cancel upload
              </Button>
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
              <>
                <Button
                  size="s"
                  disabled={disabled}
                  onClick={() => void upload.upload(state.blob)}
                >
                  Retry upload
                </Button>
                <Button
                  size="s"
                  kind="ghost"
                  disabled={disabled}
                  onClick={upload.cancel}
                >
                  Cancel upload
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {upload.cropDialog}
    </section>
  );
}
