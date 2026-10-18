import {
  type DraftReadResult,
  type OwnerSaveAction,
  ownerSaveActions,
  type ProgressReadResult,
  SAVE_REQUEST_BYTES,
} from "@hasaweb/schema";
import { DraftFailure, type Transport } from "./types";

export function createDraftTransport(
  ownerId: string,
  portfolioId: string,
  send: typeof fetch = fetch,
): Transport {
  async function request(
    path: string,
    action?: OwnerSaveAction,
    body?: unknown,
  ) {
    const json = action
      ? JSON.stringify(ownerSaveActions[action].parse(body))
      : undefined;
    if (json && new TextEncoder().encode(json).byteLength > SAVE_REQUEST_BYTES)
      throw new DraftFailure("byte_limit");
    let response: Response;
    try {
      response = await send(path, {
        method: action ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "X-Expected-Owner-Id": ownerId,
          ...(action ? { "Content-Type": "application/json" } : {}),
        },
        ...(json ? { body: json } : {}),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new DraftFailure("network", Boolean(action));
    }
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new DraftFailure(
        (result?.error ??
          (response.status === 401
            ? "unauthorized"
            : "storage_unavailable")) as DraftFailure["code"],
        Boolean(action && response.status >= 500),
      );
    }
    return response;
  }
  return {
    async read() {
      try {
        const result = (await (
          await request("/api/owner/draft")
        ).json()) as DraftReadResult;
        if (result.portfolioId !== portfolioId)
          throw new DraftFailure("owner_changed");
        return result;
      } catch (error) {
        if (error instanceof DraftFailure) throw error;
        throw new DraftFailure("network");
      }
    },
    async action<T>(action: OwnerSaveAction, body: unknown) {
      const response = await request(
        `/api/owner/draft/${action}`,
        action,
        body,
      );
      try {
        return (await response.json()) as T;
      } catch {
        throw new DraftFailure("network", true);
      }
    },
    async readProgress() {
      try {
        const result = (await (
          await request("/api/owner/progress")
        ).json()) as ProgressReadResult;
        if (result.portfolioId !== portfolioId)
          throw new DraftFailure("owner_changed");
        return result;
      } catch (error) {
        if (error instanceof DraftFailure) throw error;
        throw new DraftFailure("network");
      }
    },
    async download() {
      return (await request("/api/owner/draft/recovery")).blob();
    },
  };
}
