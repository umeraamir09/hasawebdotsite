"use client";

import type { PublicationSite } from "@hasaweb/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftController } from "../draft/controller";
import {
  PublishFailure,
  siteRequest,
  unpublishMessages,
} from "../draft/publish";
import { DraftFailure } from "../draft/types";

/**
 * The portfolio's public state, shared by the top bar, the Publish popover
 * and the Share panel. A failed read keeps the last known state.
 */
export function usePublicationSite(controller: DraftController) {
  const [site, setSite] = useState<PublicationSite | null>(null);
  const alive = useRef(true);
  const refresh = useCallback(
    () =>
      siteRequest(controller, "site")
        .then((next) => {
          if (alive.current) setSite(next);
        })
        .catch(() => {}),
    [controller],
  );
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  // Resolves to null on success or to the message to show.
  const unpublish = useCallback(async (): Promise<string | null> => {
    try {
      const next = await siteRequest(controller, "unpublish");
      if (alive.current) setSite(next);
      return null;
    } catch (cause) {
      return (
        unpublishMessages[
          cause instanceof DraftFailure || cause instanceof PublishFailure
            ? cause.code
            : "publication_unavailable"
        ] ??
        unpublishMessages.publication_unavailable ??
        "Retry Unpublish."
      );
    }
  }, [controller]);
  return { site, refresh, unpublish };
}

export type PublicationSiteState = ReturnType<typeof usePublicationSite>;

/** The public host once the address is claimed, else the requested one. */
export function siteHost(
  site: PublicationSite | null,
  requested: string | undefined,
): string | null {
  if (site?.url) return new URL(site.url).host;
  return requested ? `${requested}.hasaweb.site` : null;
}
