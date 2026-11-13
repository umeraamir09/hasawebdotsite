import { clearSample } from "@hasaweb/schema";
import { z } from "zod";
import type { DraftController } from "../draft/controller";

// Browser adapter for the owner-only GitHub graph routes (public setup and
// Phase 41 private activity). Every response is parsed strictly. Provider
// detail never reaches this code: the server returns closed error codes only.

const consentFailureSchema = z.enum([
  "cancelled",
  "wrong_account",
  "scope",
  "failed",
  "expired",
  "interrupted",
]);
export const privateStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("off") }),
  z.strictObject({ state: z.literal("authorizing") }),
  z.strictObject({
    state: z.literal("consent_failed"),
    reason: consentFailureSchema,
  }),
  z.strictObject({ state: z.literal("cleanup") }),
  z.strictObject({ state: z.literal("reconnect") }),
  z.strictObject({ state: z.literal("pending") }),
  z.strictObject({
    state: z.literal("ready"),
    fetchedAt: z.string(),
    total: z.number().int().nonnegative(),
    lastError: z.enum(["retry", "invalid"]).nullable(),
  }),
  z.strictObject({
    state: z.literal("error"),
    kind: z.enum(["retry", "invalid"]),
  }),
]);
export type GraphPrivateState = z.infer<typeof privateStateSchema>;

const statusSchema = z.strictObject({
  connection: z
    .strictObject({
      username: z.string().max(39),
      profileUrl: z.string().max(128),
      generation: z.number().int().nonnegative(),
    })
    .nullable(),
  public: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending") }),
    z.strictObject({
      state: z.literal("ready"),
      fetchedAt: z.string(),
      total: z.number().int().nonnegative(),
      lastError: z.enum(["retry", "invalid"]).nullable(),
    }),
    z.strictObject({ state: z.literal("restricted") }),
    z.strictObject({
      state: z.literal("error"),
      kind: z.enum(["retry", "invalid"]),
    }),
  ]),
  private: privateStateSchema,
  privateAvailable: z.boolean(),
  canDetect: z.boolean(),
});
export type GraphSetupStatus = z.infer<typeof statusSchema>;

export const graphFailureSchema = z.enum([
  "invalid_username",
  "not_found",
  "unavailable",
  "misconfigured",
  "too_soon",
  "conflict",
  "no_graph",
  "no_portfolio",
  "invalid_input",
  "already_authorized",
  "consent_busy",
  "private_unavailable",
]);
export type GraphSetupFailure = z.infer<typeof graphFailureSchema>;

export class GraphSetupError extends Error {
  constructor(readonly code: GraphSetupFailure) {
    super(code);
  }
}

const previewSchema = z.strictObject({
  graph: z
    .strictObject({
      username: z.string(),
      profileUrl: z.string(),
      available: z.boolean(),
      fetchedAt: z.string().nullable(),
      days: z.array(z.strictObject({ date: z.string(), count: z.number() })),
    })
    .nullable(),
});

async function call(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
  send: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await send(`/api/owner/github${path}`, {
      method: init.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      ...(init.method === "POST"
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(init.body ?? {}),
          }
        : {}),
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GraphSetupError("unavailable");
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const error = z.object({ error: z.string() }).safeParse(body);
  const code = graphFailureSchema.safeParse(
    error.success ? error.data.error : "",
  );
  throw new GraphSetupError(code.success ? code.data : "unavailable");
}

export const readGraphStatus = async (send?: typeof fetch) =>
  statusSchema.parse(await call("", {}, send));
export const setupGraph = async (username: string, send?: typeof fetch) => {
  const status = statusSchema.parse(
    await call("/setup", { method: "POST", body: { username } }, send),
  );
  bumpGraphRevision();
  return status;
};
export const retryGraph = async (send?: typeof fetch) => {
  const status = statusSchema.parse(
    await call("/retry", { method: "POST" }, send),
  );
  bumpGraphRevision();
  return status;
};
/** Where GitHub's callback returns: the editor or the setup guide. */
export type ConsentReturn = "editor" | "setup";

/**
 * Starts private-activity consent and returns GitHub's authorize URL. The
 * caller saves the draft first and then navigates in the same tab. The
 * browser names only a fixed context; the server stores it with the attempt
 * and maps it to a fixed path.
 */
export async function startPrivateConsent(
  send?: typeof fetch,
  returnTo: ConsentReturn = "editor",
) {
  const body = z
    .strictObject({ url: z.string().url() })
    .parse(
      await call("/consent", { method: "POST", body: { returnTo } }, send),
    );
  return body.url;
}
/** Clears an unfinished or failed private request. Grants are unchanged. */
export async function choosePublicOnly(send?: typeof fetch) {
  await call("/public-only", { method: "POST" }, send);
  bumpGraphRevision();
}
/**
 * Withdraws private access now, without Publish, and queues revocation at
 * GitHub. Graph removal calls this before removing the draft component.
 */
export async function withdrawGraphAccess(send?: typeof fetch) {
  await call("/withdraw", { method: "POST" }, send);
  bumpGraphRevision();
}
export async function detectGraphUsername(send?: typeof fetch) {
  const body = z
    .strictObject({ login: z.string().nullable() })
    .parse(await call("/detect", { method: "POST" }, send));
  return body.login;
}

// The preview reads the owner-authorized public calendar for the selected
// account. A revision counter lets setup and Retry refresh an open preview
// without refetching after every keystroke.
let revision = 0;
let cached: {
  revision: number;
  includePrivate: boolean;
  value: unknown;
} | null = null;
const listeners = new Set<() => void>();
export function bumpGraphRevision() {
  revision++;
  cached = null;
  for (const listener of listeners) listener();
}
export const graphRevision = () => revision;
export function subscribeGraphRevision(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export type GraphPreviewData = {
  username: string;
  fetchedAt: string;
  days: { date: string; count: number }[];
} | null;

// `includePrivate` is the draft's own choice. The server still returns
// private counts only while a matching grant is currently valid.
export async function loadGraphPreview(
  signal: AbortSignal,
  includePrivate = false,
  send: typeof fetch = fetch,
): Promise<GraphPreviewData> {
  if (cached?.revision === revision && cached.includePrivate === includePrivate)
    return cached.value as GraphPreviewData;
  const at = revision;
  let value: GraphPreviewData = null;
  try {
    const { graph } = previewSchema.parse(
      await call(
        includePrivate ? "/preview?private=1" : "/preview",
        { signal },
        send,
      ),
    );
    if (graph?.available && graph.fetchedAt)
      value = {
        username: graph.username,
        fetchedAt: graph.fetchedAt,
        days: graph.days,
      };
  } catch {
    // A missing graph is an unavailable state, never a broken preview.
    if (signal.aborted) throw signal.reason;
  }
  if (at === revision) cached = { revision: at, includePrivate, value };
  return value;
}

function updateGraph(
  controller: DraftController,
  componentId: string,
  change: (data: { username: string; includePrivate: boolean }) => {
    username: string;
    includePrivate: boolean;
  },
): boolean {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "github") return false;
  const next = change(component.data);
  if (
    next.username === component.data.username &&
    next.includePrivate === component.data.includePrivate
  )
    return true;
  controller.update(
    clearSample(
      {
        ...draft,
        components: draft.components.map((item) =>
          item.id === componentId && item.type === "github"
            ? { ...item, data: next }
            : item,
        ),
      },
      `components.${componentId}`,
    ),
  );
  return true;
}

/**
 * Writes the fetched account's canonical username into the draft component.
 * A different account turns private activity off: it needs new permission.
 */
export function setGitHubUsername(
  controller: DraftController,
  componentId: string,
  username: string,
): boolean {
  return updateGraph(controller, componentId, (data) => ({
    username,
    includePrivate:
      data.username.toLowerCase() === username.toLowerCase()
        ? data.includePrivate
        : false,
  }));
}

/** The draft's private-activity choice. It goes live only with Publish. */
export function setGitHubPrivate(
  controller: DraftController,
  componentId: string,
  includePrivate: boolean,
): boolean {
  return updateGraph(controller, componentId, (data) => ({
    ...data,
    includePrivate,
  }));
}
