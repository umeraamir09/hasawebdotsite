"use client";

import { useEffect, useId, useRef, useState } from "react";
import { takeAddressSuggestion } from "../lib/address-suggestion";
import type { DraftController } from "../lib/draft/controller";
import { profileSuggestions } from "../lib/editor/provider-suggestions";
import { addressCandidates } from "../lib/guide/address-suggestions";
import {
  type AddressResult,
  useAddressReservation,
} from "./use-address-reservation";
import { Icon, StatusPill } from "./workbench";

const pills: Partial<
  Record<AddressResult, { status: "live" | "issue" | "pending"; label: string }>
> = {
  checking: { status: "pending", label: "Checking" },
  available: { status: "live", label: "Available" },
  held: { status: "live", label: "Yours" },
  unavailable: { status: "issue", label: "Taken" },
  reserved: { status: "issue", label: "Not available" },
  invalid: { status: "issue", label: "Invalid" },
  check_failed: { status: "issue", label: "Couldn't check" },
  save_failed: { status: "issue", label: "Not saved" },
};

const errors: Partial<Record<AddressResult, string>> = {
  invalid:
    "Use 3–30 lowercase letters, numbers or hyphens, with no hyphen at either end.",
  check_failed: "Check your connection, then press Enter to try again.",
  save_failed:
    "Your address wasn't saved. Press Enter to try again, or use the recovery choices below.",
};

// How many suggestion chips the step shows.
const SUGGESTIONS = 3;

// The Address step (Figma 471:11502, taken 460:10193): one large field with
// the inline .hasaweb.site suffix and an availability pill, then available
// names from the account name as chips. Typing is a local edit; Continue
// checks and reserves the name.
export function GuideAddress({
  formId,
  controller,
  disabled,
  onReserved,
}: {
  formId: string;
  controller: DraftController;
  disabled: boolean;
  onReserved(): Promise<void>;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const address = useAddressReservation(controller, { action: "Continue" });
  const { value, valid, busy, change, check, result } = address;
  // A name typed on the entry page fills an empty field once and is checked
  // like any typed name; only Continue reserves it.
  const [typed, setTyped] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The entry-page name is taken once, against the field as the step first shows it.
  useEffect(() => {
    const name = takeAddressSuggestion();
    if (name && !value) {
      change(name);
      setTyped(name);
    }
  }, []);
  useEffect(() => {
    if (typed === null || typed !== value) return;
    setTyped(null);
    void check();
  }, [typed, value, check]);

  // Names from the account name, shown only once the server says they are
  // available. Picking one is a typed edit.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const request = new AbortController();
    void (async () => {
      const account = await profileSuggestions({
        ...controller.identity,
        signal: request.signal,
      }).catch(() => null);
      if (!account || request.signal.aborted) return;
      const found: string[] = [];
      for (const name of addressCandidates(account.name)) {
        if (found.length === SUGGESTIONS || request.signal.aborted) break;
        const outcome = await controller
          .addressAvailability(name)
          .catch(() => null);
        if (outcome?.status === "available") found.push(name);
      }
      if (!request.signal.aborted) setSuggestions(found);
    })();
    return () => request.abort();
  }, [controller]);

  async function submit() {
    if (working || busy || disabled) return;
    if (!valid) {
      input.current?.focus();
      return;
    }
    setWorking(true);
    try {
      // A confirmed hold on this exact name needs no new reservation.
      if (!address.held) {
        const available = await check();
        if (available !== "available" && available !== "held") {
          input.current?.focus();
          return;
        }
        if (!(await address.reserve())) {
          input.current?.focus();
          return;
        }
      }
      await onReserved();
    } finally {
      setWorking(false);
    }
  }
  const pill = busy
    ? { status: "pending" as const, label: "Reserving" }
    : pills[result];
  const error = errors[result];
  const shown = suggestions.filter((name) => name !== value);
  return (
    <form
      id={formId}
      className="guide-answer"
      aria-label="Portfolio address"
      data-publication-field="address"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {/* The input is only as wide as the address, so a press anywhere in the
          field (icon, suffix, status, padding) moves focus into it. Keyboard
          users reach the input directly. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer convenience for the input inside; the input itself takes focus and keys. */}
      <div
        className="guide-big-field guide-address-field"
        data-invalid={pill?.status === "issue" ? "" : undefined}
        onMouseDown={(event) => {
          const field = input.current;
          if (!field || field.disabled || event.target === field) return;
          event.preventDefault();
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
        }}
      >
        <Icon name="globe" size={20} />
        <label htmlFor={id} className="wb-visually-hidden">
          Your address
        </label>
        <span className="guide-address-value" data-value={value || " "}>
          <input
            ref={input}
            id={id}
            name="address"
            value={value}
            size={1}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${id}-status${error ? ` ${id}-error` : ""}`}
            aria-invalid={pill?.status === "issue"}
            disabled={disabled || busy || working}
            onChange={(event) => change(event.target.value)}
            // Disabling the field during Continue blurs it; that submit
            // already runs its own availability check.
            onBlur={() => {
              if (!working) void check();
            }}
          />
        </span>
        <span className="guide-address-suffix" aria-hidden="true">
          .hasaweb.site
        </span>
        <span
          id={`${id}-status`}
          className="guide-big-field-status"
          role="status"
          aria-live="polite"
        >
          {pill && <StatusPill status={pill.status}>{pill.label}</StatusPill>}
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} className="guide-field-error">
          {error}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="guide-pills" aria-label="Suggested addresses">
          {shown.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="guide-pill"
                disabled={disabled || busy || working}
                onClick={() => {
                  change(name);
                  setTyped(name);
                  input.current?.focus();
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
