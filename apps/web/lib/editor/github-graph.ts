import { clearSample } from "@hasaweb/schema";
import { z } from "zod";
import type { DraftController } from "../draft/controller";

// Browser adapter for the owner-only public GitHub graph setup routes. Every
// response is parsed strictly. Provider detail never reaches this code: the
// server returns closed error codes only.

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
let cached: { revision: number; value: unknown } | null = null;
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

export async function loadGraphPreview(
  signal: AbortSignal,
  send: typeof fetch = fetch,
): Promise<GraphPreviewData> {
  if (cached?.revision === revision) return cached.value as GraphPreviewData;
  const at = revision;
  let value: GraphPreviewData = null;
  try {
    const { graph } = previewSchema.parse(
      await call("/preview", { signal }, send),
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
  if (at === revision) cached = { revision: at, value };
  return value;
}

/** Writes the fetched account's canonical username into the draft component. */
export function setGitHubUsername(
  controller: DraftController,
  componentId: string,
  username: string,
): boolean {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "github") return false;
  if (component.data.username === username) return true;
  controller.update(
    clearSample(
      {
        ...draft,
        components: draft.components.map((item) =>
          item.id === componentId && item.type === "github"
            ? { ...item, data: { ...item.data, username } }
            : item,
        ),
      },
      `components.${componentId}`,
    ),
  );
  return true;
}
