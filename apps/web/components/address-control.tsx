"use client";

import { useId } from "react";
import type { DraftController } from "../lib/draft/controller";
import { useAddressReservation } from "./use-address-reservation";
import { Button, Icon } from "./workbench";

// The address field: in the Share panel before the first Publish, and in the
// Publish popover's first-publish state (Figma 414:9548), where `compact`
// lets the popover's "Your address" title name it.
export function AddressControl({
  controller,
  disabled = false,
  compact = false,
}: {
  controller: DraftController;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  // The popover's field has no Save button; Enter reserves the name.
  const address = useAddressReservation(
    controller,
    compact
      ? {
          action: "Press Enter",
          idle: "Press Enter to reserve it. Your site stays private.",
        }
      : undefined,
  );
  const { value, valid, busy, locked, registry, tone } = address;
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
      <div
        className="wb-field"
        data-invalid={tone === "error" ? "" : undefined}
      >
        <label
          className={compact ? "wb-visually-hidden" : "wb-field-label"}
          htmlFor={id}
        >
          {compact ? "Your address" : "Address name"}
        </label>
        <div className="wb-field-box">
          <input
            id={id}
            className="wb-field-input"
            value={value}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${id}-status`}
            aria-invalid={Boolean(value && !valid)}
            disabled={disabled || busy || locked}
            onChange={(event) => address.change(event.target.value)}
            onBlur={() => void address.check()}
          />
          <span className="wb-field-trail address-suffix">.hasaweb.site</span>
        </div>
      </div>
      <p
        id={`${id}-status`}
        className="address-status"
        data-tone={tone}
        role="status"
        aria-live="polite"
      >
        {tone === "success" && <Icon name="check-circle" size={14} />}
        {tone === "error" && <Icon name="alert" size={14} />}
        {address.status}
      </p>
      {registry && registry.name !== value && (
        <p className="address-status">
          Current reservation: {registry.name}.hasaweb.site
        </p>
      )}
      {!locked && !compact && (
        <Button
          type="submit"
          size="s"
          disabled={disabled || busy || !valid}
          className="address-save"
        >
          {busy ? "Saving address..." : "Save address"}
        </Button>
      )}
    </form>
  );
}
