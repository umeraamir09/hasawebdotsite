// Isolated Phase 11A storage and routes. Never imported by the product entry.
import { WorkerEntrypoint } from "cloudflare:workers";
import type { AuthEnvironment } from "@hasaweb/auth";
import { privateJson } from "@hasaweb/db";
import { DRAFT_MAX_BYTES, draftSchema } from "@hasaweb/schema";
import { z } from "zod";
import { completeDraft } from "../../../packages/schema/src/fixtures.test-support";
import jobs from "../src/index";
import { createOwnerRouter } from "../src/owner-api";

const envelope = z.strictObject({
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  progress: z.strictObject({
    step: z.enum(["address", "profile", "links", "review"]),
    enteredEditor: z.boolean(),
  }),
  draft: z.unknown(),
});
const app = createOwnerRouter();
const maxBody = DRAFT_MAX_BYTES + 4096;

async function readBody(request: Request) {
  const length = request.headers.get("Content-Length");
  if (length && Number(length) > maxBody) return null;
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBody) {
        await reader.cancel();
        return null;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join("")) as unknown;
  } finally {
    reader.releaseLock();
  }
}

app.post("/api/owner/runtime/:operation", async (c) => {
  const operation = c.req.param("operation");
  if (!["validate", "save"].includes(operation)) return privateJson(null, 404);
  let raw: unknown;
  try {
    raw = await readBody(c.req.raw);
  } catch {
    return privateJson(null, 400);
  }
  if (raw === null) return privateJson(null, 413);
  const input = envelope.safeParse(raw);
  if (!input.success) return privateJson(null, 422);
  const parsed = draftSchema.safeParse(input.data.draft);
  if (!parsed.success) return privateJson(null, 422);
  if (operation === "validate") return privateJson({ ok: true });
  const identity = c.get("owner").identity;
  // A fixture-only race proves the mutation rechecks authorization after parsing.
  if (c.req.header("X-Runtime-Revoke-At-Write") === "true")
    await c.env.DB.prepare("DELETE FROM session WHERE id = ?")
      .bind(identity.session.id)
      .run();
  const result = await c.env.DB.prepare(`
    UPDATE owner_runtime_fixture
    SET draft = ?, progress = ?, revision = revision + 1
    WHERE user_id = ? AND revision = ?
      AND (json_extract(progress, '$.enteredEditor') = 0 OR json_extract(?, '$.enteredEditor') = 1)
      AND EXISTS (SELECT 1 FROM session s JOIN user u ON u.id = s.user_id
        WHERE s.id = ? AND s.user_id = owner_runtime_fixture.user_id
          AND s.expires_at > ? AND u.deleting_at IS NULL)
    RETURNING revision
  `)
    .bind(
      JSON.stringify(parsed.data),
      JSON.stringify(input.data.progress),
      identity.user.id,
      input.data.revision,
      JSON.stringify(input.data.progress),
      identity.session.id,
      Date.now(),
    )
    .first<{ revision: number }>();
  return result ? privateJson(result) : privateJson(null, 409);
});

export class RuntimeOwnerApi extends WorkerEntrypoint<AuthEnvironment> {
  fetch(request: Request) {
    return app.fetch(request, this.env, this.ctx);
  }
}

export default {
  async fetch(
    request: Request,
    env: AuthEnvironment & { RUNTIME_KEY: string; RUNTIME_ENABLED: string },
  ) {
    if (
      env.RUNTIME_ENABLED !== "true" ||
      request.headers.get("X-Runtime-Key") !== env.RUNTIME_KEY
    )
      return privateJson(null, 404);
    // Fixture creation is outside every measured window.
    if (new URL(request.url).pathname === "/__fixture/drafts") {
      const small = completeDraft();
      small.profile.bio = "Fixture ".repeat(1024);
      const large = completeDraft();
      const prototype = large.components.find(
        (component) => component.type === "text",
      );
      if (prototype?.type !== "text") throw new Error("Missing text fixture");
      for (let i = 0; i < 192; i++)
        large.components.push({
          ...prototype,
          id: `fixture-text-${i}`,
          data: {
            title: `Section ${i}`,
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "A paragraph. ".repeat(300) },
                  ],
                },
              ],
            },
          },
        });
      large.profile.bio = "";
      const bytes = new TextEncoder().encode(JSON.stringify(large)).byteLength;
      large.profile.bio = "x".repeat(DRAFT_MAX_BYTES - bytes);
      return privateJson({ small, large });
    }
    return jobs.fetch(request, env as never);
  },
};
