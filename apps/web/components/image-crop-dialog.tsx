"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type CropPosition,
  type CropPurpose,
  cropRectangle,
  cropSizes,
  encodeCrop,
  initialCrop,
  type LocalImage,
} from "../lib/assets/crop";

export function ImageCropDialog({
  image,
  purpose,
  onApply,
  onCancel,
}: {
  image: LocalImage;
  purpose: CropPurpose;
  onApply(blob: Blob): void;
  onCancel(): void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const [position, setPosition] = useState<CropPosition>(initialCrop);
  const [encoding, setEncoding] = useState(false);
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; position: CropPosition } | null>(
    null,
  );
  const size = {
    width: image.element.naturalWidth,
    height: image.element.naturalHeight,
  };
  const rectangle = cropRectangle(size, purpose, position);
  const title =
    purpose === "avatar"
      ? "Adjust avatar"
      : purpose === "face"
        ? "Adjust Face Reveal photo"
        : purpose === "og"
          ? "Adjust sharing image"
          : "Adjust banner";
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      alive.current = false;
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  const bound = (value: number) => Math.min(1, Math.max(0, value));
  function zoom(value: number) {
    setPosition((current) => ({
      ...current,
      zoom: Math.max(1, Math.min(4, value)),
    }));
  }
  async function apply() {
    setEncoding(true);
    setError("");
    try {
      const blob = await encodeCrop(image, purpose, position);
      if (alive.current) onApply(blob);
    } catch (cause) {
      if (alive.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The crop could not be prepared. Try again.",
        );
        setEncoding(false);
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`image-crop-dialog image-crop-${purpose}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help ${id}-retention`}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        const destination = event.shiftKey
          ? document.activeElement === first && last
          : document.activeElement === last && first;
        if (destination) {
          event.preventDefault();
          destination.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <header className="image-crop-header">
        <h2 id={`${id}-title`}>{title}</h2>
        <button
          className="image-crop-icon"
          type="button"
          aria-label="Close crop dialog"
          onClick={onCancel}
        >
          <img src="/assets/crop/close.svg" width="20" height="20" alt="" />
        </button>
      </header>
      <div className="image-crop-stage">
        <button
          type="button"
          disabled={encoding}
          className="image-crop-boundary"
          style={{
            aspectRatio: `${cropSizes[purpose].width} / ${cropSizes[purpose].height}`,
          }}
          aria-label="Reposition image"
          aria-describedby={`${id}-help`}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.1 : 0.01;
            const dx =
              event.key === "ArrowLeft"
                ? step
                : event.key === "ArrowRight"
                  ? -step
                  : 0;
            const dy =
              event.key === "ArrowUp"
                ? step
                : event.key === "ArrowDown"
                  ? -step
                  : 0;
            if (!dx && !dy) return;
            event.preventDefault();
            if (!encoding)
              setPosition((current) => ({
                ...current,
                x: bound(current.x + dx),
                y: bound(current.y + dy),
              }));
          }}
          onPointerDown={(event) => {
            if (encoding) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, position };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || encoding) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const moveX =
              size.width === rectangle.width
                ? 0
                : (((event.clientX - start.x) / bounds.width) *
                    rectangle.width) /
                  (size.width - rectangle.width);
            const moveY =
              size.height === rectangle.height
                ? 0
                : (((event.clientY - start.y) / bounds.height) *
                    rectangle.height) /
                  (size.height - rectangle.height);
            setPosition({
              ...start.position,
              x: bound(start.position.x - moveX),
              y: bound(start.position.y - moveY),
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <img
            className="image-crop-source"
            src={image.url}
            alt=""
            draggable={false}
            style={{
              width: `${(size.width / rectangle.width) * 100}%`,
              height: `${(size.height / rectangle.height) * 100}%`,
              left: `${(-rectangle.x / rectangle.width) * 100}%`,
              top: `${(-rectangle.y / rectangle.height) * 100}%`,
            }}
          />
          <span className="image-crop-mask" />
        </button>
      </div>
      <p className="image-crop-help" id={`${id}-help`}>
        Drag to reposition, or focus the image and use the arrow keys. Hold
        Shift for larger moves.
      </p>
      <div className="image-crop-zoom">
        <button
          className="image-crop-icon"
          type="button"
          aria-label="Zoom out"
          disabled={encoding || position.zoom <= 1}
          onClick={() => zoom(position.zoom - 0.1)}
        >
          <img src="/assets/crop/zoom-out.svg" width="20" height="20" alt="" />
        </button>
        <label className="image-crop-sr" htmlFor={`${id}-zoom`}>
          Zoom
        </label>
        <input
          id={`${id}-zoom`}
          type="range"
          min="1"
          max="4"
          step="0.01"
          value={position.zoom}
          disabled={encoding}
          aria-valuetext={`${position.zoom.toFixed(1)} times`}
          onChange={(event) => zoom(event.target.valueAsNumber)}
        />
        <button
          className="image-crop-icon"
          type="button"
          aria-label="Zoom in"
          disabled={encoding || position.zoom >= 4}
          onClick={() => zoom(position.zoom + 0.1)}
        >
          <img src="/assets/crop/zoom-in.svg" width="20" height="20" alt="" />
        </button>
        <output>{position.zoom.toFixed(1)}×</output>
      </div>
      <p className="image-crop-retention" id={`${id}-retention`}>
        <img src="/assets/crop/information.svg" width="20" height="20" alt="" />
        Only the finished crop is saved. Reset uses this selection. To recover
        excluded areas after returning, reselect the original file.
      </p>
      {error && <p role="alert">{error}</p>}
      <footer className="image-crop-footer">
        <button
          className="image-crop-reset"
          type="button"
          disabled={encoding}
          onClick={() => setPosition(initialCrop)}
        >
          <img src="/assets/crop/reset.svg" width="20" height="20" alt="" />
          Reset
        </button>
        <div>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="image-crop-apply"
            type="button"
            disabled={encoding}
            onClick={() => void apply()}
          >
            {encoding ? "Preparing crop..." : "Apply crop"}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
