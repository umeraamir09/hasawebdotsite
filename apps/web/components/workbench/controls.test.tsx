// @vitest-environment jsdom
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Area,
  Button,
  Chip,
  Dialog,
  Field,
  FilterChip,
  IconButton,
  Popover,
  SectionRow,
  SegmentedControl,
  StatusPill,
  Toggle,
} from "./index";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}
function key(
  target: Element | null,
  name: string,
  init: KeyboardEventInit = {},
) {
  if (!target) throw new Error(`No target for ${name}`);
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}
function click(target: Element | null) {
  if (!(target instanceof HTMLElement)) throw new Error("No click target");
  act(() => target.click());
}
function byRole(role: string, name?: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>(`[role="${role}"], ${role}`),
  ].find(
    (element) =>
      name === undefined ||
      element.getAttribute("aria-label") === name ||
      element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No ${role} named ${name}`);
  return found;
}
const active = () => document.activeElement;
function twoButtons(view: HTMLElement) {
  const [first, second, ...rest] = view.querySelectorAll("button");
  if (!first || !second || rest.length > 0)
    throw new Error("Expected two buttons");
  return [first, second] as const;
}

describe("Button and IconButton", () => {
  it("are native buttons in the tab order that never submit by default", () => {
    const onClick = vi.fn();
    const view = render(
      <>
        <Button kind="primary" icon="plus" onClick={onClick}>
          Add section
        </Button>
        <IconButton icon="more" label="More actions" />
      </>,
    );
    const [button, iconButton] = twoButtons(view);
    expect(button.type).toBe("button");
    expect(button.tabIndex).toBe(0);
    expect(button.dataset.kind).toBe("primary");
    click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(iconButton.getAttribute("aria-label")).toBe("More actions");
    expect(iconButton.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("does not act while disabled", () => {
    const onClick = vi.fn();
    const view = render(
      <Button disabled onClick={onClick}>
        Publish
      </Button>,
    );
    click(view.querySelector("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Toggle", () => {
  it("is a switch that reports and flips its state", () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <Toggle aria-label="Face reveal" checked={on} onCheckedChange={setOn} />
      );
    }
    render(<Harness />);
    const toggle = byRole("switch", "Face reveal");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

describe("Field and Area", () => {
  it("labels the input and announces an error", () => {
    const view = render(
      <Field label="Address" trail=".hasaweb.site" error="Taken" />,
    );
    const input = view.querySelector("input");
    expect(view.querySelector("label")?.control).toBe(input);
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    const described = input?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toBe("Taken");
  });

  it("shows the live character count", () => {
    function Harness() {
      const [bio, setBio] = useState("Hi");
      return (
        <Area
          label="Bio"
          value={bio}
          maxLength={160}
          onChange={(event) => setBio(event.target.value)}
        />
      );
    }
    const view = render(<Harness />);
    const area = view.querySelector("textarea");
    const counter = document.getElementById(
      area?.getAttribute("aria-describedby") ?? "",
    );
    expect(counter?.textContent).toBe("2/160");
    act(() => {
      if (!area) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(area, "Hello");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(counter?.textContent).toBe("5/160");
  });
});

describe("Chip, FilterChip, StatusPill and SectionRow", () => {
  it("names the chip's remove button and calls it", () => {
    const onRemove = vi.fn();
    render(<Chip label="TypeScript" onRemove={onRemove} />);
    click(byRole("button", "Remove TypeScript"));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("exposes filter selection as a pressed state", () => {
    const view = render(
      <>
        <FilterChip selected>All</FilterChip>
        <FilterChip selected={false}>Animals</FilterChip>
      </>,
    );
    expect(
      [...view.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-pressed"),
      ),
    ).toEqual(["true", "false"]);
  });

  it("states the status in its label", () => {
    const view = render(<StatusPill status="live">Live</StatusPill>);
    expect(view.textContent).toBe("Live");
    expect(
      view.querySelector("[data-status]")?.getAttribute("data-status"),
    ).toBe("live");
  });

  it("marks the selected row and reads its issue", () => {
    const view = render(
      <>
        <SectionRow name="Projects" icon="grid" meta={3} selected />
        <SectionRow
          name="Contact"
          icon="grid"
          issueLabel="Needs an email address"
        />
      </>,
    );
    const [projects, contact] = twoButtons(view);
    expect(projects.getAttribute("aria-current")).toBe("true");
    expect(contact.hasAttribute("aria-current")).toBe(false);
    expect(contact.textContent).toContain("Needs an email address");
    expect(projects.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("SegmentedControl", () => {
  function Harness({ onChange }: { onChange?: (value: string) => void }) {
    const [mode, setMode] = useState("system");
    return (
      <SegmentedControl
        label="Mode"
        value={mode}
        onChange={(value) => {
          onChange?.(value);
          setMode(value);
        }}
        options={[
          { value: "light", label: "Light", icon: "sun" },
          { value: "dark", label: "Dark", icon: "moon" },
          { value: "system", label: "System", icon: "monitor" },
        ]}
      />
    );
  }
  const radios = () => [...document.querySelectorAll('[role="radio"]')];
  const checked = () =>
    radios().find((radio) => radio.getAttribute("aria-checked") === "true")
      ?.textContent;

  it("puts only the selected segment in the tab order", () => {
    render(<Harness />);
    expect(byRole("radiogroup", "Mode")).toBeTruthy();
    expect(radios().map((radio) => (radio as HTMLElement).tabIndex)).toEqual([
      -1, -1, 0,
    ]);
  });

  it("moves and selects with arrow keys, wrapping at both ends", () => {
    render(<Harness />);
    const group = byRole("radiogroup", "Mode");
    (radios()[2] as HTMLElement).focus();
    key(active(), "ArrowRight");
    expect(checked()).toBe("Light");
    expect(active()).toBe(radios()[0]);
    key(active(), "ArrowLeft");
    expect(checked()).toBe("System");
    key(active(), "ArrowUp");
    expect(checked()).toBe("Dark");
    key(active(), "ArrowDown");
    expect(checked()).toBe("System");
    key(group, "Home");
    expect(checked()).toBe("Light");
    key(group, "End");
    expect(checked()).toBe("System");
    expect(active()).toBe(radios()[2]);
  });

  it("ignores other keys and does not report an unchanged value", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    (radios()[2] as HTMLElement).focus();
    key(active(), "a");
    key(active(), "End");
    click(radios()[2] ?? null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps icon-only segments named", () => {
    render(
      <SegmentedControl
        label="Preview size"
        size="s"
        value="desktop"
        onChange={() => {}}
        options={[
          { value: "desktop", label: "Desktop", icon: "monitor" },
          { value: "mobile", label: "Mobile", icon: "phone" },
        ]}
      />,
    );
    expect(radios().map((radio) => radio.textContent)).toEqual([
      "Desktop",
      "Mobile",
    ]);
  });
});

describe("Popover", () => {
  function Harness() {
    return (
      <>
        <button type="button">Outside</button>
        <Popover
          label="Publish checklist"
          trigger={(props) => <Button {...props}>Publish</Button>}
        >
          <Button>Fix contact</Button>
          <Button kind="primary">Publish now</Button>
        </Popover>
      </>
    );
  }

  it("opens with focus inside and closes on Escape back to the trigger", () => {
    render(<Harness />);
    const trigger = byRole("button", "Publish");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.focus();
    click(trigger);
    const panel = byRole("dialog", "Publish checklist");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(active()?.textContent).toBe("Fix contact");
    key(active(), "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(active()).toBe(trigger);

    click(trigger);
    act(() => trigger.focus());
    key(trigger, "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes when the pointer or focus goes elsewhere", () => {
    render(<Harness />);
    const trigger = byRole("button", "Publish");
    click(trigger);
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    click(trigger);
    act(() => byRole("button", "Outside").focus());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("stays open for a pointer inside it", () => {
    render(<Harness />);
    click(byRole("button", "Publish"));
    act(() => {
      byRole("button", "Fix contact").dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      );
    });
    expect(byRole("dialog", "Publish checklist")).toBeTruthy();
  });
});

describe("Dialog", () => {
  function Harness({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <div data-wb-scheme="dark">
        <Button onClick={() => setOpen(true)}>Decoration</Button>
        <button type="button">Behind</button>
        <Dialog
          open={open}
          title="Decoration"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          <Button>Cat</Button>
          <Button>Hands</Button>
        </Dialog>
      </div>
    );
  }
  function open() {
    const trigger = byRole("button", "Decoration");
    trigger.focus();
    click(trigger);
    return trigger;
  }

  it("is a labelled modal that takes focus into its content", () => {
    render(<Harness />);
    open();
    const dialog = byRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
    ).toBe("Decoration");
    expect(active()?.textContent).toBe("Cat");
    expect(
      dialog.closest("[data-wb-scheme]")?.getAttribute("data-wb-scheme"),
    ).toBe("dark");
    expect(document.documentElement.classList).toContain("wb-scroll-lock");
  });

  it("traps Tab and Shift+Tab inside", () => {
    render(<Harness />);
    open();
    const close = byRole("button", "Close");
    const hands = byRole("button", "Hands");
    act(() => hands.focus());
    key(active(), "Tab");
    expect(active()).toBe(close);
    key(active(), "Tab", { shiftKey: true });
    expect(active()).toBe(hands);
  });

  it("pulls focus back if it lands behind the dialog", () => {
    render(<Harness />);
    open();
    act(() => byRole("button", "Behind").focus());
    expect(byRole("dialog").contains(active())).toBe(true);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = open();
    key(active(), "Escape");
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(active()).toBe(trigger);
    expect(document.documentElement.classList).not.toContain("wb-scroll-lock");
  });

  it("closes from the close button and the scrim", () => {
    render(<Harness />);
    const trigger = open();
    click(byRole("button", "Close"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(active()).toBe(trigger);

    open();
    click(document.querySelector(".wb-dialog-scrim"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
