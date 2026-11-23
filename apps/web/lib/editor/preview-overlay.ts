import type {
  PreviewOverlayFactory,
  PreviewSelection,
} from "@hasaweb/components/browser";
import type { ComponentType } from "@hasaweb/schema";
import { iconShapes } from "../../components/workbench/icon-shapes";
import { sectionIcons, sectionTitle } from "./sections";

// The editor canvas outline (Figma 407:1232 hover, 411:3276 selected): a
// dashed box and tag on hover, and a solid box, tag and move up, move down and
// remove actions on the selection. It lives beside the preview root, so the
// renderer's markup stays exactly what visitors get.
const SECTION = "[data-component-id], [data-component=profile]";
const SVG = "http://www.w3.org/2000/svg";
const GAP = 4;

function icon(name: keyof typeof iconShapes, size: number) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const shape = iconShapes[name];
  for (const d of "paths" in shape ? shape.paths : []) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.458");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  for (const [cx, cy] of "dots" in shape ? shape.dots : []) {
    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "1.25");
    dot.setAttribute("fill", "currentColor");
    svg.appendChild(dot);
  }
  return svg;
}
function element(className: string, hidden = true) {
  const node = document.createElement("div");
  node.className = className;
  if (hidden) node.setAttribute("aria-hidden", "true");
  node.hidden = true;
  return node;
}
function typeOf(section: HTMLElement): ComponentType | "profile" {
  return (section.dataset.component ?? "profile") as ComponentType | "profile";
}
function labelOf(section: HTMLElement) {
  const type = typeOf(section);
  const title =
    type === "text"
      ? section.querySelector("h2")?.textContent?.trim()
      : undefined;
  return title || sectionTitle(type);
}

export const createEditorOverlay: PreviewOverlayFactory = ({ root, act }) => {
  const layer = element("hw-outline", false);
  layer.hidden = false;
  const hoverBox = element("hw-outline-box");
  hoverBox.dataset.state = "hover";
  const selectedBox = element("hw-outline-box");
  selectedBox.dataset.state = "selected";
  const hoverTag = element("hw-outline-tag");
  const selectedTag = element("hw-outline-tag");
  const toolbar = element("hw-outline-actions", false);
  toolbar.setAttribute("role", "toolbar");
  const buttons = (["up", "down", "remove"] as const).map((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.appendChild(
      icon(
        action === "up"
          ? "arrow-up"
          : action === "down"
            ? "arrow-down"
            : "trash",
        16,
      ),
    );
    button.addEventListener("click", () => {
      const id = selected?.dataset.componentId;
      if (id && !button.disabled) act(action, id);
    });
    return button;
  });
  for (const button of buttons) toolbar.appendChild(button);
  for (const part of [hoverBox, selectedBox, hoverTag, selectedTag, toolbar])
    layer.appendChild(part);
  root.insertAdjacentElement("afterend", layer);

  let active = false;
  let actions = true;
  let selection: PreviewSelection | null = null;
  let selected: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let frame = 0;
  // A keyboard move keeps focus on the moved section once it re-renders.
  let refocus: string | null = null;

  function find(value: PreviewSelection | null) {
    if (!value) return null;
    return value.kind === "profile"
      ? root.querySelector<HTMLElement>("[data-component=profile]")
      : root.querySelector<HTMLElement>(
          `[data-component-id="${CSS.escape(value.id)}"]`,
        );
  }
  function setTag(tag: HTMLElement, section: HTMLElement) {
    const label = labelOf(section);
    if (tag.dataset.label === label && tag.dataset.type === typeOf(section))
      return;
    tag.dataset.label = label;
    tag.dataset.type = typeOf(section);
    const text = document.createElement("span");
    text.textContent = label;
    tag.replaceChildren(icon(sectionIcons[typeOf(section)], 12), text);
  }
  function place(
    box: HTMLElement,
    tag: HTMLElement,
    section: HTMLElement | null,
  ) {
    box.hidden = tag.hidden = !section;
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const left = Math.max(2, rect.left + scrollX - 6);
    const right = Math.min(width - 2, rect.right + scrollX + 6);
    const top = Math.max(2, rect.top + scrollY - 6);
    const bottom = rect.bottom + scrollY + 6;
    Object.assign(box.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
    setTag(tag, section);
    // Above the box when there is room, otherwise inside its top edge.
    const above = top - GAP - 20 >= 0;
    Object.assign(tag.style, {
      left: `${left}px`,
      top: `${above ? top - GAP - 20 : top + GAP}px`,
    });
    return { left, top, right, above };
  }
  function layout() {
    frame = 0;
    if (!active) return;
    selected = find(selection);
    if (hovered && !hovered.isConnected) hovered = null;
    const box = place(selectedBox, selectedTag, selected);
    place(hoverBox, hoverTag, hovered === selected ? null : hovered);
    const id = selected?.dataset.componentId;
    toolbar.hidden = !(box && id && actions);
    if (box && id && actions) {
      const label = labelOf(selected as HTMLElement);
      toolbar.setAttribute("aria-label", `${label} actions`);
      const sections = [...root.querySelectorAll<HTMLElement>(SECTION)].filter(
        (section) => section.dataset.componentId,
      );
      const index = sections.findIndex(
        (section) => section.dataset.componentId === id,
      );
      const [up, down, remove] = buttons as [
        HTMLButtonElement,
        HTMLButtonElement,
        HTMLButtonElement,
      ];
      up.setAttribute("aria-label", `Move ${label} up`);
      down.setAttribute("aria-label", `Move ${label} down`);
      remove.setAttribute("aria-label", `Remove ${label}`);
      up.disabled = index <= 0;
      down.disabled = index < 0 || index === sections.length - 1;
      const height = 34;
      Object.assign(toolbar.style, {
        left: `${Math.max(box.left, box.right - toolbar.offsetWidth)}px`,
        top: `${box.above ? Math.max(0, box.top - GAP - height) : box.top + GAP}px`,
      });
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(layout);
  }
  function hover(event: PointerEvent) {
    if (!active || event.pointerType === "touch") return;
    const section =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(SECTION)
        : null;
    if (section === hovered) return;
    hovered = section;
    schedule();
  }
  function leave() {
    hovered = null;
    schedule();
  }
  function keydown(event: KeyboardEvent) {
    if (!active || !(event.target instanceof HTMLElement)) return;
    const section = event.target;
    if (!section.matches(SECTION)) return;
    const id = section.dataset.componentId;
    if (
      event.altKey &&
      id &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      refocus = id;
      act(event.key === "ArrowUp" ? "up" : "down", id);
      return;
    }
    // The actions follow their section in the tab order.
    if (event.key === "Tab" && !event.shiftKey && section === selected) {
      const first = buttons.find((button) => !button.disabled);
      if (!toolbar.hidden && first) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  function toolbarKeys(event: KeyboardEvent) {
    if (event.key !== "Tab" || !selected) return;
    const enabled = buttons.filter((button) => !button.disabled);
    if (event.shiftKey && event.target === enabled[0]) {
      event.preventDefault();
      selected.focus();
    } else if (!event.shiftKey && event.target === enabled.at(-1)) {
      const after = [
        ...root.querySelectorAll<HTMLElement>(
          `${SECTION}, a[href], button, input, textarea, select`,
        ),
      ].find(
        (node) =>
          !selected?.contains(node) &&
          selected?.compareDocumentPosition(node) ===
            Node.DOCUMENT_POSITION_FOLLOWING,
      );
      if (after) {
        event.preventDefault();
        after.focus();
      }
    }
  }
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  root.addEventListener("pointerover", hover);
  root.addEventListener("pointerleave", leave);
  root.addEventListener("keydown", keydown);
  root.addEventListener("load", schedule, true);
  toolbar.addEventListener("keydown", toolbarKeys);
  addEventListener("resize", schedule);
  return {
    select(value, showActions) {
      active = true;
      selection = value;
      actions = showActions;
      layout();
    },
    refresh() {
      if (refocus) {
        find({ kind: "component", id: refocus })?.focus();
        refocus = null;
      }
      schedule();
    },
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      root.removeEventListener("pointerover", hover);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("keydown", keydown);
      root.removeEventListener("load", schedule, true);
      removeEventListener("resize", schedule);
      layer.remove();
    },
  };
};
