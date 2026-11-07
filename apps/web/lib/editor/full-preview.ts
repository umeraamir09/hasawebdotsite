import { mountPreviewPage } from "@hasaweb/components/browser";
import {
  type PreviewPageModel,
  projectPreviewPage,
} from "@hasaweb/components/model";
import { draftSchema } from "@hasaweb/schema";
import { resolvePreviewImages } from "../assets/browser";
import { readOwner } from "../auth-client";
import { createDraftTransport } from "../draft/transport";

const BASE = "/preview";

// `/preview/resume` previews `/resume`, `/preview/projects/x` previews
// `/projects/x` and `/preview` previews the portfolio page.
export function previewPath(pathname: string): string {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : "";
  const trimmed = path.length > 1 ? path.replace(/\/$/, "") : path;
  return trimmed || "/";
}

function sessionStorageOrNull() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

// Opens one page of the owner's saved draft. It renders what the server holds,
// never the editor's unsaved working copy, through the same display
// projection, renderer and `installSite` behavior as the live preview and the
// published pages. The owner is rechecked whenever the page returns to view,
// so a sign-out or a different account removes the display.
export async function openFullPreview(
  root: HTMLElement,
  pathname = location.pathname,
) {
  const path = previewPath(pathname);
  const storage = sessionStorageOrNull();
  const imageCache = new Map<string, string>();
  let identity: { ownerId: string; portfolioId: string } | null = null;
  let mounted: ReturnType<typeof mountPreviewPage> | null = null;
  let revision: number | null = null;
  let pending: AbortController | null = null;
  let closed = false;

  function clear() {
    mounted?.dispose();
    mounted = null;
    revision = null;
  }
  function message(text: string, link?: { href: string; label: string }) {
    clear();
    root.replaceChildren();
    const main = document.createElement("main");
    const heading = document.createElement("h1");
    heading.textContent = text;
    main.appendChild(heading);
    if (link) {
      const anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.label;
      const paragraph = document.createElement("p");
      paragraph.appendChild(anchor);
      main.appendChild(paragraph);
    }
    root.appendChild(main);
  }
  function stop(text: string) {
    closed = true;
    message(text, { href: "/sign-in", label: "Sign in" });
    dispose();
  }
  async function load() {
    if (closed) return;
    pending?.abort();
    const request = new AbortController();
    pending = request;
    try {
      const owner = await readOwner(request.signal);
      if (closed || request.signal.aborted) return;
      if (!owner?.portfolio) {
        stop("Sign in to open your private preview.");
        return;
      }
      const current = {
        ownerId: owner.user.id,
        portfolioId: owner.portfolio.id,
      };
      if (
        identity &&
        (identity.ownerId !== current.ownerId ||
          identity.portfolioId !== current.portfolioId)
      ) {
        stop("Your session changed. Reopen the preview from the editor.");
        return;
      }
      identity = current;
      const saved = await createDraftTransport(
        current.ownerId,
        current.portfolioId,
      ).read();
      if (closed || request.signal.aborted) return;
      // Nothing changed on the server since the last display.
      if (mounted && saved.revision === revision) return;
      const draft = draftSchema.safeParse(saved.draft);
      if (!draft.success) {
        message("Preview unavailable");
        return;
      }
      const assets = await resolvePreviewImages({
        ownerId: current.ownerId,
        draft: draft.data,
        signal: request.signal,
        cache: imageCache,
        caseStudies: path.startsWith("/projects/"),
      });
      if (closed || request.signal.aborted) return;
      const page: PreviewPageModel | undefined = projectPreviewPage(
        draft.data,
        path,
        assets,
      );
      if (!page) {
        message("Page unavailable", {
          href: BASE,
          label: "Back to portfolio",
        });
        revision = saved.revision;
        return;
      }
      if (mounted?.update(page)) {
        revision = saved.revision;
        return;
      }
      clear();
      root.replaceChildren();
      mounted = mountPreviewPage(root, page, {
        assetOrigins: assets.assetOrigins,
        pageBase: BASE,
        storage,
      });
      revision = saved.revision;
    } catch {
      if (!request.signal.aborted && !closed)
        message("Preview unavailable. Reload to try again.");
    } finally {
      if (pending === request) pending = null;
    }
  }
  function refresh() {
    if (document.visibilityState !== "hidden") void load();
  }
  function show(event: PageTransitionEvent) {
    if (event.persisted) void load();
  }
  function dispose() {
    closed = true;
    pending?.abort();
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", show);
    document.removeEventListener("visibilitychange", refresh);
  }
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", show);
  document.addEventListener("visibilitychange", refresh);
  await load();
  return dispose;
}
