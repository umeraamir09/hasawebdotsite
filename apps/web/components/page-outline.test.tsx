// @vitest-environment jsdom
import type { PreviewSelection } from "@hasaweb/components/browser";
import { createComponent, type DraftDoc } from "@hasaweb/schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { completeDraft } from "../../../packages/schema/src/fixtures.test-support";
import type { DraftController } from "../lib/draft/controller";
import { type OutlineSelect, PageOutline } from "./page-outline";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 0;
  });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

function draftWithSections(): DraftDoc {
  const draft = completeDraft();
  draft.components = [
    { ...createComponent("text", "story"), data: { title: "Story", body: "" } },
    createComponent("skills", "skills"),
    createComponent("projects", "projects"),
  ] as DraftDoc["components"];
  return draft;
}
function fakeController(draft: DraftDoc) {
  const store = createStore(() => ({
    working: draft,
    suspended: false,
    error: null as string | null,
  }));
  const update = vi.fn((next: DraftDoc) => store.setState({ working: next }));
  return {
    controller: { store, update } as unknown as DraftController,
    store,
    update,
  };
}
function render(props: {
  controller: DraftController;
  selection: PreviewSelection;
  onSelect?: OutlineSelect;
  onRemove?(id: string): void;
}) {
  const node = (
    <PageOutline
      controller={props.controller}
      selection={props.selection}
      disabled={false}
      onSelect={props.onSelect ?? (() => {})}
      onRemove={props.onRemove ?? (() => {})}
      onAdded={() => {}}
    />
  );
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root?.render(node));
  return host;
}
function row(name: string) {
  const button = [
    ...(host?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((item) => item.getAttribute("aria-label") === name);
  if (!button) throw new Error(`No row ${name}`);
  return button;
}
function profileCard() {
  const card = host?.querySelector<HTMLButtonElement>(".page-outline-profile");
  if (!card) throw new Error("No profile card");
  return card;
}
function press(target: Element, key: string, altKey = false) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
const order = (draft: DraftDoc | undefined) =>
  draft?.components.map((component) => component.id);

describe("page outline", () => {
  it("shows the shared selection and reports rows chosen in the outline", () => {
    const { controller } = fakeController(draftWithSections());
    const onSelect = vi.fn<OutlineSelect>();
    render({ controller, selection: { kind: "profile" }, onSelect });
    expect(profileCard().getAttribute("aria-current")).toBe("true");
    expect(row("Story").getAttribute("aria-current")).toBeNull();

    act(() => row("Skills and technologies").click());
    expect(onSelect).toHaveBeenLastCalledWith(
      { kind: "component", id: "skills" },
      "pointer",
    );

    // A selection made on the canvas arrives as the same prop.
    render({
      controller,
      selection: { kind: "component", id: "projects" },
      onSelect,
    });
    expect(row("Projects").getAttribute("aria-current")).toBe("true");
    expect(profileCard().getAttribute("aria-current")).toBeNull();
  });

  it("moves the selection with the arrow keys and keeps focus on the chosen row", () => {
    const { controller } = fakeController(draftWithSections());
    const onSelect = vi.fn<OutlineSelect>();
    render({ controller, selection: { kind: "profile" }, onSelect });
    press(profileCard(), "ArrowDown");
    expect(onSelect).toHaveBeenLastCalledWith(
      { kind: "component", id: "story" },
      "keyboard",
    );
    expect(document.activeElement).toBe(row("Story"));
    press(row("Story"), "ArrowUp");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "profile" }, "keyboard");
  });

  it("reorders sections with Alt and the arrow keys and announces the position", () => {
    const { controller, store, update } = fakeController(draftWithSections());
    render({ controller, selection: { kind: "component", id: "story" } });
    press(row("Story"), "ArrowDown", true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(order(store.getState().working)).toEqual([
      "skills",
      "story",
      "projects",
    ]);
    expect(
      host?.querySelector('.page-outline > p[role="status"]')?.textContent,
    ).toBe("Story moved to position 2 of 3.");
    expect(document.activeElement).toBe(row("Story"));
    press(row("Story"), "ArrowDown", true);
    expect(order(store.getState().working)).toEqual([
      "skills",
      "projects",
      "story",
    ]);
    // Already last: nothing changes.
    press(row("Story"), "ArrowDown", true);
    expect(update).toHaveBeenCalledTimes(2);
    press(row("Projects"), "ArrowUp", true);
    expect(order(store.getState().working)).toEqual([
      "projects",
      "skills",
      "story",
    ]);
  });

  it("asks before removing with Delete and keeps the profile", () => {
    const { controller, update } = fakeController(draftWithSections());
    const onRemove = vi.fn();
    render({ controller, selection: { kind: "profile" }, onRemove });
    press(row("Projects"), "Delete");
    expect(onRemove).toHaveBeenCalledWith("projects");
    press(profileCard(), "Delete");
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
