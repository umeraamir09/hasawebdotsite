"use client";

import {
  type AddressAvailability,
  type AddressState,
  requestedSubdomainSchema,
} from "@hasaweb/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DraftController } from "../lib/draft/controller";
import { DraftFailure } from "../lib/draft/types";

export const addressPath = ["requestedSubdomain"];

// `action` names the control that confirms the reservation: the editor's
// Save address button or the guide's Continue button.
export function addressMessages(action: string) {
  return {
    address_unavailable: "That address is unavailable. Choose another name.",
    address_reserved: "That name is reserved. Choose another name.",
    address_locked: "Your published address is permanent.",
    available: `Available now. ${action} to reserve it.`,
    reserved: "That name is reserved. Choose another name.",
    unavailable: "That address is unavailable. Choose another name.",
    held: "Reserved for your portfolio. Your site is still private.",
    claimed: "Your published address is permanent.",
  } as Record<string, string>;
}

export type AddressTone = "info" | "success" | "error";

// The last known outcome for the name in the field, for controls that show
// it as a pill. `local` is an edit nothing has checked yet.
export type AddressResult =
  | "local"
  | "checking"
  | "invalid"
  | "available"
  | "unavailable"
  | "reserved"
  | "held"
  | "claimed"
  | "check_failed"
  | "save_failed";

// Shared address field state for the editor control and the guide's Address
// step. Typing is local raw input; only `reserve()` sends the explicit
// confirmation, and only a registry read proves the hold.
export function useAddressReservation(
  controller: DraftController,
  {
    action = "Save address",
    idle = "Save your address to reserve it. Your site stays private.",
  }: { action?: string; idle?: string } = {},
) {
  const messages = useMemo(() => addressMessages(action), [action]);
  const state = useStore(controller.store);
  const [registry, setRegistry] = useState<AddressState>(null);
  const [message, setMessage] = useState(idle);
  const [outcome, setOutcome] = useState<AddressResult>("local");
  const [busy, setBusy] = useState(false);
  const input = state.inputs[JSON.stringify(addressPath)];
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
  const status =
    value && !valid
      ? "Enter a valid address name."
      : reservationMessage && registry?.name !== value
        ? idle
        : message;
  const tone: AddressTone =
    value && !valid
      ? "error"
      : [
            messages.address_unavailable,
            messages.address_reserved,
            messages.unavailable,
          ].includes(status)
        ? "error"
        : [messages.available, messages.held].includes(status)
          ? "success"
          : "info";
  const held = registry?.state === "held" && registry.name === value && !input;
  const result: AddressResult =
    value && !valid
      ? "invalid"
      : (outcome === "held" || outcome === "claimed") &&
          registry?.name !== value
        ? "local"
        : outcome;
  const revision = state.confirmed?.revision;
  useEffect(() => {
    if (revision === undefined) return;
    let active = true;
    void controller
      .addressState()
      .then((current) => {
        if (!active) return;
        setRegistry(current);
        if (current && current.name === currentValue.current) {
          setMessage(messages[current.state] ?? "");
          setOutcome(current.state);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [controller, revision, messages]);
  function change(next: string) {
    availabilityQuery.current++;
    controller.setInput(addressPath, next);
    setMessage("Your change is local until you save this address.");
    setOutcome("local");
  }
  async function check(): Promise<AddressAvailability["status"] | null> {
    if (!valid || busy || locked) return null;
    const checked = value;
    const query = ++availabilityQuery.current;
    setOutcome("checking");
    try {
      const result = await controller.addressAvailability(checked);
      // A newer check for the same name may own the message, but this
      // result still answers its caller while the name is unchanged.
      if (currentValue.current !== checked) return null;
      if (availabilityQuery.current === query) {
        setMessage(messages[result.status] ?? "");
        setOutcome(result.status);
      }
      return result.status;
    } catch {
      if (availabilityQuery.current === query) {
        setMessage("Couldn't check this address. Try again.");
        setOutcome("check_failed");
      }
      return null;
    }
  }
  // Resolves true only after the registry confirms this owner's hold on the
  // exact name. Every failure keeps the previous reservation and raw input.
  async function reserve() {
    availabilityQuery.current++;
    const name = value;
    setBusy(true);
    try {
      await controller.confirmAddress(name);
      const current = await controller.addressState();
      setRegistry(current);
      const confirmed = Boolean(current && current.name === name);
      setMessage(
        confirmed && current
          ? (messages[current.state] ?? "")
          : "Couldn't verify the reservation. Retry the interrupted save.",
      );
      setOutcome(confirmed && current ? current.state : "save_failed");
      return confirmed;
    } catch (error) {
      setMessage(
        error instanceof DraftFailure && messages[error.code]
          ? (messages[error.code] ?? "")
          : "Address save interrupted. Use the draft recovery controls to continue.",
      );
      setOutcome(
        error instanceof DraftFailure && error.code === "address_unavailable"
          ? "unavailable"
          : error instanceof DraftFailure && error.code === "address_reserved"
            ? "reserved"
            : "save_failed",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    value,
    valid,
    locked,
    held,
    busy,
    registry,
    status,
    tone,
    result,
    change,
    check,
    reserve,
  };
}
