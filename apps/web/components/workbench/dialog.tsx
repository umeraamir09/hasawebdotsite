"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./controls";
import { focusableWithin } from "./focus";
import "./workbench.css";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Desktop width in px; the mobile sheet is always full width. */
  width?: number | undefined;
  closeLabel?: string | undefined;
};

/**
 * Dialog: the centered gallery modal on desktop (Figma 431:15279) and a
 * bottom sheet at 640 px and below (433:18313). It traps Tab, closes on
 * Escape or a scrim click, and returns focus to where it was when it closes.
 */
export function Dialog({ open, ...props }: DialogProps) {
  return open ? <DialogLayer {...props} /> : null;
}

// Open dialogs, innermost last. Only the innermost one keeps focus.
const openLayers: HTMLElement[] = [];

function DialogLayer({
  onClose,
  title,
  children,
  width,
  closeLabel = "Close",
}: Omit<DialogProps, "open">) {
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Read during render, before an autoFocus child can move focus.
  const [returnTo] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const scheme =
    returnTo?.closest("[data-wb-scheme]")?.getAttribute("data-wb-scheme") ??
    undefined;

  useEffect(() => {
    const layer = layerRef.current;
    const dialog = dialogRef.current;
    const body = bodyRef.current;
    if (!layer || !dialog || !body) return;
    openLayers.push(layer);
    document.documentElement.classList.add("wb-scroll-lock");
    if (!dialog.contains(document.activeElement))
      (
        dialog.querySelector<HTMLElement>("[data-autofocus]") ??
        focusableWithin(body)[0] ??
        focusableWithin(dialog)[0] ??
        dialog
      ).focus();

    const keepFocusInside = (event: FocusEvent) => {
      if (openLayers.at(-1) !== layer) return;
      if (event.target instanceof Node && layer.contains(event.target)) return;
      (focusableWithin(dialog)[0] ?? dialog).focus();
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      openLayers.splice(openLayers.indexOf(layer), 1);
      if (openLayers.length === 0)
        document.documentElement.classList.remove("wb-scroll-lock");
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [returnTo]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = focusableWithin(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      ref={layerRef}
      className="workbench wb-dialog-layer"
      data-wb-scheme={scheme}
    >
      <div className="wb-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="wb-dialog"
        style={
          width === undefined
            ? undefined
            : ({ "--wb-dialog-width": `${width}px` } as CSSProperties)
        }
        onKeyDown={onKeyDown}
      >
        <span className="wb-dialog-handle" aria-hidden="true" />
        <div className="wb-dialog-header">
          <h2 className="wb-dialog-title" id={titleId}>
            {title}
          </h2>
          <IconButton icon="x" label={closeLabel} onClick={onClose} />
        </div>
        <div ref={bodyRef} className="wb-dialog-body">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
