export function installSite(root: ParentNode): () => void {
  const cleanups: (() => void)[] = [];
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-theme-toggle]",
  )) {
    const document = button.ownerDocument;
    const view = document.defaultView;
    const system = view?.matchMedia("(prefers-color-scheme: dark)");
    let explicit: "light" | "dark" | undefined;
    try {
      const stored = view?.localStorage.getItem("hasaweb-color-mode");
      if (stored === "light" || stored === "dark") explicit = stored;
    } catch {}
    const sync = () => {
      const mode = explicit ?? (system?.matches ? "dark" : "light");
      document.documentElement.dataset.colorMode = mode;
      const dark = mode === "dark";
      button.textContent = dark ? "Light mode" : "Dark mode";
    };
    const toggle = () => {
      explicit =
        document.documentElement.dataset.colorMode === "dark"
          ? "light"
          : "dark";
      try {
        view?.localStorage.setItem("hasaweb-color-mode", explicit);
      } catch {}
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
