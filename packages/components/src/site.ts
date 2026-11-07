export type VisitorMode = "light" | "dark";
// Where the visitor's explicit light/dark choice lives. Public pages use
// per-origin storage, so the choice follows the visitor across that
// portfolio's pages. The preview passes an in-memory store instead.
export type ModeStore = {
  read(): VisitorMode | undefined;
  write(mode: VisitorMode): void;
};
export const COLOR_MODE_KEY = "hasaweb-color-mode";

export function storedModeStore(view: Window | null | undefined): ModeStore {
  return {
    read() {
      try {
        const stored = view?.localStorage.getItem(COLOR_MODE_KEY);
        if (stored === "light" || stored === "dark") return stored;
      } catch {}
      return undefined;
    },
    write(mode) {
      try {
        view?.localStorage.setItem(COLOR_MODE_KEY, mode);
      } catch {}
    },
  };
}

// Runs synchronously from the render-blocking platform script in <head>,
// before the body is parsed, so a stored choice is present at first paint.
export function applyStoredMode(document: Document): void {
  const stored = storedModeStore(document.defaultView).read();
  if (stored) document.documentElement.dataset.colorMode = stored;
}

// The owner's saved initial mode is a server-rendered attribute. System, or
// no attribute, follows the visitor's preference.
function initialMode(
  document: Document,
  system: MediaQueryList | undefined,
): VisitorMode {
  const initial = document.documentElement.dataset.initialMode;
  if (initial === "light" || initial === "dark") return initial;
  return system?.matches ? "dark" : "light";
}

export function installSite(
  root: Pick<ParentNode, "querySelectorAll">,
  options: { store?: ModeStore } = {},
): () => void {
  const cleanups: (() => void)[] = [];
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-theme-toggle]",
  )) {
    const document = button.ownerDocument;
    const view = document.defaultView;
    const system = view?.matchMedia("(prefers-color-scheme: dark)");
    const store = options.store ?? storedModeStore(view);
    let explicit = store.read();
    const sync = () => {
      const mode = explicit ?? initialMode(document, system);
      document.documentElement.dataset.colorMode = mode;
      const dark = mode === "dark";
      button.textContent = dark ? "Light mode" : "Dark mode";
    };
    const toggle = () => {
      explicit =
        document.documentElement.dataset.colorMode === "dark"
          ? "light"
          : "dark";
      store.write(explicit);
      sync();
    };
    button.addEventListener("click", toggle);
    system?.addEventListener("change", sync);
    cleanups.push(() => {
      button.removeEventListener("click", toggle);
      system?.removeEventListener("change", sync);
    });
    sync();
  }
  for (const image of root.querySelectorAll<HTMLImageElement>(
    ".pf-image img",
  )) {
    const slot = image.closest<HTMLElement>(".pf-image");
    const settle = () => {
      const success = image.complete && image.naturalWidth > 0;
      if (slot) {
        slot.dataset.assetState = success ? "ready" : "unavailable";
        const status = slot.querySelector(".pf-image-status");
        if (status) status.textContent = success ? "" : "Image unavailable";
      }
    };
    image.addEventListener("load", settle);
    image.addEventListener("error", settle);
    cleanups.push(() => {
      image.removeEventListener("load", settle);
      image.removeEventListener("error", settle);
    });
    if (image.complete) settle();
    else if (slot) {
      slot.dataset.assetState = "loading";
      const status = slot.querySelector(".pf-image-status");
      if (status) status.textContent = "Image loading";
    }
  }
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
