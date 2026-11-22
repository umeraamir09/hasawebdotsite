"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { focusableWithin } from "./focus";
import "./workbench.css";

export type PopoverTriggerProps = {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  "aria-haspopup": "dialog";
};

type PopoverProps = {
  /** Names the popover panel for assistive technology. */
  label: string;
  /** Renders the control that opens the popover, usually a Button. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
};

/**
 * Popover (Figma 414:9500): a non-modal panel under its trigger. Opening moves
 * focus into it; Escape closes it and returns focus to the trigger; a click
 * or focus outside closes it.
 */
export function Popover({
  label,
  trigger,
  children,
  align = "end",
  open: controlledOpen,
  onOpenChange,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }
  function closeOnEscape(event: KeyboardEvent) {
    if (!open || event.key !== "Escape") return;
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  }
  const closeFromOutside = useEffectEvent((target: EventTarget | null) => {
    if (!(target instanceof Node) || !anchorRef.current?.contains(target))
      setOpen(false);
  });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel) (focusableWithin(panel)[0] ?? panel).focus();
    const onOutside = (event: Event) => closeFromOutside(event.target);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open]);

  return (
    <span ref={anchorRef} className="wb-popover-anchor">
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen(!open),
        onKeyDown: closeOnEscape,
        "aria-expanded": open,
        "aria-controls": open ? id : undefined,
        "aria-haspopup": "dialog",
      })}
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className="wb-popover"
          data-align={align}
          onKeyDown={closeOnEscape}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}
