"use client";

import { type AddressState, requestedSubdomainSchema } from "@hasaweb/schema";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { DraftFailure } from "../lib/draft/types";

const path = ["requestedSubdomain"];
const messages: Record<string, string> = {
  address_unavailable: "That address is unavailable. Choose another name.",
  address_reserved: "That name is reserved. Choose another name.",
  address_locked: "Your published address is permanent.",
  available: "Available now. Save address to reserve it.",
  reserved: "That name is reserved. Choose another name.",
  unavailable: "That address is unavailable. Choose another name.",
  held: "Reserved for your portfolio. Your site is still private.",
  claimed: "Your published address is permanent.",
};
export function AddressControl({
  controller,
  disabled = false,
}: {
  controller: DraftController;
  disabled?: boolean;
}) {
  const state = useStore(controller.store);
  const id = useId();
  const [registry, setRegistry] = useState<AddressState>(null);
  const [message, setMessage] = useState(
    "Save your address to reserve it. Your site stays private.",
  );
  const [busy, setBusy] = useState(false);
  const input = state.inputs[JSON.stringify(path)];
  const value =
    registry?.state === "claimed"
      ? registry.name
      : typeof input?.value === "string"
        ? input.value
        : (state.working?.requestedSubdomain ?? "");
  const availabilityQuery = useRef(0);
  const currentValue = useRef(value);
  currentValue.current = value;
  const valid = requestedSubdomainSchema.safeParse(value).success;
  const locked = registry?.state === "claimed";
  const reservationMessage =
    message === messages.held || message === messages.claimed;
  const statusMessage =
    reservationMessage && registry?.name !== value
      ? "Save your address to reserve it. Your site stays private."
      : message;
  const revision = state.confirmed?.revision;
  useEffect(() => {
    if (revision === undefined) return;
    let active = true;
    void controller
      .addressState()
      .then((current) => {
        if (!active) return;
        setRegistry(current);
        if (current && current.name === currentValue.current)
          setMessage(messages[current.state] ?? "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [controller, revision]);
  async function availability() {
    if (!valid || busy || locked) return;
    const checked = value;
    const query = ++availabilityQuery.current;
    try {
      const result = await controller.addressAvailability(checked);
      if (
        currentValue.current === checked &&
        availabilityQuery.current === query
      )
        setMessage(messages[result.status] ?? "");
    } catch {
      if (availabilityQuery.current === query)
        setMessage("Couldn't check this address. Try again.");
    }
  }
  async function save() {
    availabilityQuery.current++;
    setBusy(true);
    try {
      await controller.confirmAddress(value);
      const current = await controller.addressState();
      setRegistry(current);
      setMessage(
        current && current.name === value
          ? (messages[current.state] ?? "")
          : "Couldn't verify the reservation. Retry the interrupted save.",
      );
    } catch (error) {
      setMessage(
        error instanceof DraftFailure && messages[error.code]
          ? (messages[error.code] ?? "")
          : "Address save interrupted. Use the draft recovery controls to continue.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="address-control"
      aria-label="Portfolio address"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy && !disabled && !locked) void save();
      }}
    >
      <h2>Your address</h2>
      <label htmlFor={id}>Address name</label>
      <div className="address-input">
        <input
          id={id}
          value={value}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={`${id}-help ${id}-status`}
          aria-invalid={Boolean(value && !valid)}
          disabled={disabled || busy || locked}
          onChange={(event) => {
            availabilityQuery.current++;
            controller.setInput(path, event.target.value);
            setMessage("Your change is local until you save this address.");
          }}
          onBlur={() => void availability()}
        />
        <span>.hasaweb.site</span>
      </div>
      <p id={`${id}-help`}>
        Use 3 to 30 lowercase letters, numbers, or internal hyphens.
      </p>
      <p id={`${id}-status`} role="status" aria-live="polite">
        {value && !valid ? "Enter a valid address name." : statusMessage}
      </p>
      {registry && registry.name !== value && (
        <p>Current reservation: {registry.name}.hasaweb.site</p>
      )}
      <button type="submit" disabled={disabled || busy || !valid || locked}>
        {busy ? "Saving address..." : "Save address"}
      </button>
    </form>
  );
}
