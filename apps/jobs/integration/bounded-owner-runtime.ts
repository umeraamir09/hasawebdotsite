// Isolated integration entry; product routing cannot reach these fixture routes.
import { WorkerEntrypoint } from "cloudflare:workers";
import type { AuthEnvironment } from "@hasaweb/auth";
import type { SaveChange } from "@hasaweb/db";
import { boundedSaves, privateJson, SaveError } from "@hasaweb/db";
import { z } from "zod";
import jobs from "../src/index";
import { createOwnerRouter } from "../src/owner-api";
import { prepareBounded } from "./bounded-preparation";

const app = createOwnerRouter();
const progress = z.strictObject({
  step: z.enum(["address", "profile", "links", "review"]),
  enteredEditor: z.boolean(),
});
const number = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 1);
const path = z.array(z.union([z.string(), number])).max(64);
const change = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("set"), path, value: z.unknown() }),
  z.strictObject({
    op: z.literal("append"),
    path,
    values: z.array(z.unknown()).max(32),
  }),
  z.strictObject({ op: z.literal("remove"), path }),
]);
const actions = {
  begin: z.strictObject({ revision: number, progress }),
  patch: z.strictObject({ revision: number, progress, change }),
  change: z.strictObject({ id: z.string().uuid(), sequence: number, change }),
  "string-start": z.strictObject({
    id: z.string().uuid(),
    sequence: number,
    path,
  }),
  piece: z.strictObject({
    id: z.string().uuid(),
    sequence: number,
    text: z.string(),
  }),
  "string-finish": z.strictObject({ id: z.string().uuid(), sequence: number }),
  commit: z.strictObject({ id: z.string().uuid(), sequence: number }),
  abort: z.strictObject({ id: z.string().uuid() }),
  cleanup: z.strictObject({}),
};
app.post("/api/owner/bounded/:action", async (c) => {
  const action = c.req.param("action");
  if (!Object.hasOwn(actions, action)) return privateJson(null, 404);
  let text = "";
  const reader = c.req.raw.body?.getReader();
  if (!reader) return privateJson(null, 400);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0,
    oversized = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) oversized = true;
      if (!oversized) text += decoder.decode(value, { stream: true });
    }
    if (oversized) return privateJson(null, 413);
    text += decoder.decode();
  } catch {
    return privateJson(null, 400);
  } finally {
    reader.releaseLock();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return privateJson(null, 400);
  }
  const schema = actions[action as keyof typeof actions];
  const input = schema.safeParse(raw);
  if (!input.success) return privateJson(null, 422);
  const preparation = c.req.header("X-Fixture-Prepare");
  if (preparation) {
    const fixtureEnv = c.env as AuthEnvironment & { RUNTIME_KEY: string };
    if (c.req.header("X-Runtime-Key") !== fixtureEnv.RUNTIME_KEY)
      return privateJson(null, 404);
    await prepareBounded(
      new Request("https://hasaweb.site/__fixture/bounded-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: preparation,
      }),
      c.env.DB,
    );
  }
  const owner = c.get("owner");
  const saves = boundedSaves(c.env.DB, owner.identity, {
    table: "owner_runtime_fixture",
    owner: "user_id",
    draft: "draft",
    revision: "revision",
    progress: "progress",
  });
  // Explicit race injection exists only in this separately built fixture.
  if (c.req.header("X-Runtime-Revoke-At-Write") === "true")
    await c.env.DB.prepare("DELETE FROM session WHERE id=?")
      .bind(owner.identity.session.id)
      .run();
  try {
    switch (action) {
      case "begin": {
        const v = actions.begin.parse(raw);
        return privateJson(await saves.begin(v.revision, v.progress));
      }
      case "patch": {
        const v = actions.patch.parse(raw);
        return privateJson(
          await saves.change(v.change as SaveChange, v.revision, v.progress),
        );
      }
      case "change": {
        const v = actions.change.parse(raw);
        return privateJson(
          await saves.change(v.change as SaveChange, 0, {}, v.id, v.sequence),
        );
      }
      case "string-start": {
        const v = actions["string-start"].parse(raw);
        return privateJson(await saves.stringStart(v.id, v.sequence, v.path));
      }
      case "piece": {
        const v = actions.piece.parse(raw);
        return privateJson(await saves.stringPiece(v.id, v.sequence, v.text));
      }
      case "string-finish": {
        const v = actions["string-finish"].parse(raw);
        return privateJson(await saves.stringFinish(v.id, v.sequence));
      }
      case "commit": {
        const v = actions.commit.parse(raw);
        return privateJson(await saves.commit(v.id, v.sequence));
      }
      case "abort": {
        const v = actions.abort.parse(raw);
        return privateJson(await saves.abort(v.id));
      }
      case "cleanup":
        return privateJson(await saves.cleanup());
    }
  } catch (error) {
    return privateJson(
      {
        error:
          error instanceof SaveError ? error.message : "Invalid draft update",
      },
      error instanceof SaveError ? error.status : 422,
    );
  }
  return privateJson(null, 404);
});
export class RuntimeOwnerApi extends WorkerEntrypoint<AuthEnvironment> {
  fetch(request: Request) {
    return app.fetch(request, this.env, this.ctx);
  }
}
export default {
  async fetch(
    request: Request,
    env: AuthEnvironment & { RUNTIME_ENABLED: string; RUNTIME_KEY: string },
  ) {
    if (
      env.RUNTIME_ENABLED !== "true" ||
      request.headers.get("X-Runtime-Key") !== env.RUNTIME_KEY
    )
      return privateJson(null, 404);
    if (new URL(request.url).pathname === "/__fixture/bounded-prepare")
      return prepareBounded(request, env.DB);
    return jobs.fetch(request, env as never);
  },
};
