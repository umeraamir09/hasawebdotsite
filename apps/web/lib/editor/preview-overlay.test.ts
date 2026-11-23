// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorOverlay } from "./preview-overlay";

let root: HTMLElement;
let overlay: ReturnType<typeof createEditorOverlay>;
const act = vi.fn();
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  if (!globalThis.CSS?.escape)
    vi.stubGlobal("CSS", { escape: (value: string) => value });
  root = document.createElement("div");
  root.innerHTML = `
    <section data-component="profile" tabindex="0"><h1>Owner</h1></section>
    <section data-component="text" data-component-id="story" tabindex="0"><h2>Story</h2></section>
    <section data-component="projects" data-component-id="projects" tabindex="0"><h2>Projects</h2></section>`;
  document.body.appendChild(root);
  act.mockReset();
  overlay = createEditorOverlay({ root, act });
});
afterEach(() => {
  overlay.dispose();
  root.remove();
  vi.unstubAllGlobals();
});

const layer = () => document.querySelector<HTMLElement>(".hw-outline");
const toolbar = () =>
  document.querySelector<HTMLElement>(".hw-outline-actions");
const button = (name: string) => {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(".hw-outline button"),
  ].find((item) => item.getAttribute("aria-label") === name);
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const selectedTag = () =>
  [...document.querySelectorAll<HTMLElement>(".hw-outline-tag")].find(
    (tag) => !tag.hidden,
  )?.textContent;
const section = (id: string) => {
  const found = root.querySelector<HTMLElement>(`[data-component-id="${id}"]`);
  if (!found) throw new Error(`No section ${id}`);
  return found;
};

describe("canvas outline", () => {
  it("stays hidden until the editor selects, so setup Review shows none", () => {
    section("story").dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
    const parts = [...(layer()?.children ?? [])] as HTMLElement[];
    expect(parts.length).toBe(5);
    expect(parts.every((part) => part.hidden)).toBe(true);
  });

  it("outlines the selection with its tag and actions", () => {
    overlay.select({ kind: "component", id: "story" }, true);
    expect(selectedTag()).toBe("Story");
    expect(toolbar()?.hidden).toBe(false);
    expect(toolbar()?.getAttribute("aria-label")).toBe("Story actions");
    expect(button("Move Story up").disabled).toBe(true);
    expect(button("Move Story down").disabled).toBe(false);
    button("Move Story down").click();
    button("Remove Story").click();
    expect(act.mock.calls).toEqual([
      ["down", "story"],
      ["remove", "story"],
    ]);

    overlay.select({ kind: "component", id: "projects" }, true);
    expect(selectedTag()).toBe("Projects");
    expect(button("Move Projects down").disabled).toBe(true);
    expect(button("Move Projects up").disabled).toBe(false);
  });

  it("shows only the tag for the profile and while the dock holds the actions", () => {
    overlay.select({ kind: "profile" }, true);
    expect(selectedTag()).toBe("Profile");
    expect(toolbar()?.hidden).toBe(true);
    overlay.select({ kind: "component", id: "story" }, false);
    expect(selectedTag()).toBe("Story");
    expect(toolbar()?.hidden).toBe(true);
  });

  it("moves a focused section with Alt and an arrow key and refocuses it", () => {
    overlay.select({ kind: "profile" }, true);
    const projects = section("projects");
    projects.focus();
    projects.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(act).toHaveBeenCalledWith("up", "projects");
    // The renderer re-renders the moved section; the outline restores focus.
    root.insertBefore(projects, section("story"));
    (document.activeElement as HTMLElement | null)?.blur();
    overlay.refresh();
    expect(document.activeElement).toBe(projects);
  });

  it("puts the actions right after the selected section in the tab order", () => {
    overlay.select({ kind: "component", id: "story" }, true);
    const story = section("story");
    story.focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    story.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("Move Story down"));
    const back = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    button("Move Story down").dispatchEvent(back);
    expect(document.activeElement).toBe(story);
  });
});
