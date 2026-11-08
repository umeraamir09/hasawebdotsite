import {
  contributionLabel,
  GRAPH_SOURCE_PATH,
  graphLayout,
  graphUpdated,
  validGraphDays,
} from "./graph";
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
  for (const frame of root.querySelectorAll<HTMLElement>(".pf-avatar-frame"))
    cleanups.push(installAvatar(frame));
  for (const graph of root.querySelectorAll<HTMLElement>(
    "[data-github-graph][data-graph-source]",
  ))
    cleanups.push(installGraph(graph));
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

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
// The source wipe lasts 620 ms. The guard releases shortly after it even if
// no animationend arrives, as in the faithful source component.
const ERASE_GUARD_MS = 660;

// Face Reveal and the visitor pause/play control for one avatar. Every page
// load starts from the server markup: the original avatar, playing. State
// lives in the frame's data attributes, so a preview content update that
// keeps the same elements keeps the visitor's current state.
function installAvatar(frame: HTMLElement): () => void {
  const view = frame.ownerDocument.defaultView;
  const reduced = view?.matchMedia(REDUCED_MOTION_QUERY);
  const reveal = frame.querySelector<HTMLButtonElement>(
    ":scope > button[data-face-reveal]",
  );
  const playback = frame.querySelector<HTMLButtonElement>(
    ":scope > [data-avatar-playback]",
  );
  const still = frame.querySelector<HTMLSourceElement>(
    ":scope > .pf-avatar-catDecoration > source",
  );
  let guard: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (guard !== undefined) clearTimeout(guard);
    guard = undefined;
    if (reveal) reveal.dataset.erasing = "false";
  };
  const showPortrait = (photo: boolean) => {
    if (!reveal) return;
    reveal.dataset.photo = String(photo);
    reveal.setAttribute("aria-label", photo ? "Show avatar" : "Reveal face");
  };
  const toggle = () => {
    if (!reveal || reveal.dataset.erasing === "true") return;
    showPortrait(reveal.dataset.photo !== "true");
    // Reduced motion switches the images immediately, without the wipe.
    if (reduced?.matches) return;
    reveal.dataset.erasing = "true";
    guard = setTimeout(settle, ERASE_GUARD_MS);
  };
  const erased = (event: AnimationEvent) => {
    if (event.animationName === "portrait-erase") settle();
  };
  // Pause shows the cleaned cat still or the stationary hands. Reduced
  // motion shows the same stills and takes priority over play, so the
  // control is hidden while it applies. Neither changes the portrait.
  const syncPlayback = () => {
    if (!frame.dataset.playback) return;
    const paused = frame.dataset.playback === "paused";
    if (still) still.media = paused ? "all" : REDUCED_MOTION_QUERY;
    if (playback) playback.hidden = reduced?.matches === true;
  };
  const togglePlayback = () => {
    frame.dataset.playback =
      frame.dataset.playback === "paused" ? "playing" : "paused";
    syncPlayback();
  };
  const motionChanged = () => {
    if (reduced?.matches) settle();
    syncPlayback();
  };
  // A page restored from the back/forward cache is a new visit: start again
  // from the original avatar.
  const restored = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    settle();
    showPortrait(false);
  };
  reveal?.addEventListener("click", toggle);
  reveal?.addEventListener("animationend", erased);
  playback?.addEventListener("click", togglePlayback);
  reduced?.addEventListener("change", motionChanged);
  view?.addEventListener("pageshow", restored);
  // A preview update can reinstall mid-wipe; release that wipe as usual.
  if (reveal?.dataset.erasing === "true")
    guard = setTimeout(settle, ERASE_GUARD_MS);
  syncPlayback();
  return () => {
    if (guard !== undefined) clearTimeout(guard);
    reveal?.removeEventListener("click", toggle);
    reveal?.removeEventListener("animationend", erased);
    playback?.removeEventListener("click", togglePlayback);
    reduced?.removeEventListener("change", motionChanged);
    view?.removeEventListener("pageshow", restored);
  };
}

function graphMessage(graph: HTMLElement, state: string, message: string) {
  const document = graph.ownerDocument;
  const paragraph = document.createElement("p");
  paragraph.className = "pf-muted";
  paragraph.textContent = message;
  graph.dataset.state = state;
  graph.replaceChildren(paragraph);
}

// Draws the same markup as the React `GitHubGraph` view from one validated
// JSON response. Text only goes through textContent, and a response that is
// not exactly the expected shape shows the unavailable state.
export function drawGraph(graph: HTMLElement, body: unknown): boolean {
  const data = body as {
    available?: unknown;
    fetchedAt?: unknown;
    days?: unknown;
  } | null;
  if (
    data?.available !== true ||
    typeof data.fetchedAt !== "string" ||
    !validGraphDays(data.days)
  ) {
    graphMessage(graph, "unavailable", "Contribution graph unavailable.");
    return false;
  }
  const document = graph.ownerDocument;
  const layout = graphLayout(data.days);
  const chart = document.createElement("div");
  chart.className = "pf-graph-chart";
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", layout.label);
  for (const week of layout.weeks) {
    const column = document.createElement("div");
    column.className = "pf-graph-week";
    for (const cell of week) {
      const day = document.createElement("span");
      day.className = "pf-graph-day";
      day.setAttribute("data-level", cell ? String(cell.level) : "blank");
      if (cell) day.title = contributionLabel(cell.count, cell.date);
      column.appendChild(day);
    }
    chart.appendChild(column);
  }
  const updated = document.createElement("p");
  updated.className = "pf-muted pf-graph-updated";
  updated.textContent = graphUpdated(data.fetchedAt);
  graph.dataset.state = "ready";
  graph.removeAttribute("aria-live");
  graph.replaceChildren(chart, updated);
  return true;
}

// Published pages carry only a placeholder. Counts are live data, so the
// visitor's browser asks this origin's graph endpoint, never another host.
function installGraph(graph: HTMLElement): () => void {
  const view = graph.ownerDocument.defaultView;
  if (
    graph.dataset.graphSource !== GRAPH_SOURCE_PATH ||
    !view ||
    typeof view.fetch !== "function"
  ) {
    graphMessage(graph, "unavailable", "Contribution graph unavailable.");
    return () => {};
  }
  const controller = new AbortController();
  view
    .fetch(GRAPH_SOURCE_PATH, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      if (!controller.signal.aborted) drawGraph(graph, body);
    })
    .catch(() => {
      if (!controller.signal.aborted)
        graphMessage(graph, "unavailable", "Contribution graph unavailable.");
    });
  return () => controller.abort();
}
