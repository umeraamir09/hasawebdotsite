"use client";

import { useId } from "react";
import type { DraftController } from "../lib/draft/controller";
import { useAddressReservation } from "./use-address-reservation";

export function AddressControl({
  controller,
  disabled = false,
}: {
  controller: DraftController;
  disabled?: boolean;
}) {
  const id = useId();
  const address = useAddressReservation(controller);
  const { value, valid, busy, locked, registry } = address;
  return (
    <form
      className="address-control"
      data-publication-field="address"
      aria-label="Portfolio address"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy && !disabled && !locked) void address.reserve();
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
          onChange={(event) => address.change(event.target.value)}
          onBlur={() => void address.check()}
        />
        <span>.hasaweb.site</span>
      </div>
      <p id={`${id}-help`}>
        Use 3 to 30 lowercase letters, numbers, or internal hyphens.
      </p>
      <p id={`${id}-status`} role="status" aria-live="polite">
        {address.status}
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
