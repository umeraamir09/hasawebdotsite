import {
  attachPreviewBridge,
  mountPreview,
  type PreviewIdentity,
} from "@hasaweb/components/browser";
import { readOwner } from "../auth-client";

export async function openEditorPreview(root: HTMLElement) {
  const requestedChannel = new URLSearchParams(location.hash.slice(1)).get(
    "channel",
  );
  if (
    window.parent === window ||
    !requestedChannel ||
    requestedChannel.length > 128
  )
    return () => {};
  const channel = requestedChannel;
  let identity: PreviewIdentity | null = null;
  let stopMount: (() => void) | null = null;
  let closed = false;
  let generation = 0;
  let pending: AbortController | null = null;

  function unmount() {
    generation++;
    pending?.abort();
    pending = null;
    stopMount?.();
    stopMount = null;
  }
  function dispose() {
    if (closed) return;
    closed = true;
    unmount();
    window.removeEventListener("focus", reauthorize);
    window.removeEventListener("pageshow", show);
    document.removeEventListener("visibilitychange", reauthorize);
    window.removeEventListener("pagehide", hide);
  }
  function fail(message: string) {
    window.parent.postMessage(
      { protocol: 1, channel, kind: "unavailable" },
      location.origin,
    );
    dispose();
    root.textContent = message;
  }
  async function authorize(mount: boolean) {
    if (closed) return;
    pending?.abort();
    const request = new AbortController();
    pending = request;
    const expected = generation;
    try {
      const owner = await readOwner(request.signal);
      if (
        closed ||
        request.signal.aborted ||
        expected !== generation ||
        !root.isConnected
      )
        return;
      if (!owner?.portfolio) {
        fail("Sign in to open your private preview.");
        return;
      }
      const current = {
        ownerId: owner.user.id,
        portfolioId: owner.portfolio.id,
      };
      if (
        identity &&
        (current.ownerId !== identity.ownerId ||
          current.portfolioId !== identity.portfolioId)
      ) {
        fail("Your session changed. Reopen the editor to preview.");
        return;
      }
      identity = current;
      if (!mount || stopMount) return;
      const preview = mountPreview(
        root,
        {
          profile: {
            name: "",
            bio: "",
            avatar: { state: "missing" },
            banner: { state: "missing" },
            decoration: "none",
            links: [],
          },
          components: [],
        },
        { assetOrigins: [location.origin] },
      );
      const detach = attachPreviewBridge({
        target: preview,
        root,
        parentWindow: window.parent,
        parentOrigin: location.origin,
        channel,
        identity,
      });
      stopMount = () => {
        detach();
        preview.dispose();
      };
    } catch {
      if (!request.signal.aborted && !closed)
        fail("Your private preview is unavailable. Reopen the editor.");
    } finally {
      if (pending === request) pending = null;
    }
  }
  function reauthorize() {
    if (stopMount && document.visibilityState !== "hidden")
      void authorize(false);
  }
  function show(event: PageTransitionEvent) {
    if (event.persisted) void authorize(true);
  }
  function hide(event: PageTransitionEvent) {
    if (event.persisted) unmount();
    else dispose();
  }
  window.addEventListener("focus", reauthorize);
  window.addEventListener("pageshow", show);
  document.addEventListener("visibilitychange", reauthorize);
  window.addEventListener("pagehide", hide);
  await authorize(true);
  return dispose;
}
