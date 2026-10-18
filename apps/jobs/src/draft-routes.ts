import {
  legacyValidation,
  ownerDrafts,
  privateJson,
  publicAttempt,
  SaveError,
} from "@hasaweb/db";
import {
  type OwnerSaveAction,
  ownerSaveActions,
  SAVE_REQUEST_BYTES,
} from "@hasaweb/schema";
import type { Hono } from "hono";
import type { OwnerBindings } from "./owner-api";

async function readBody(request: Request): Promise<unknown> {
  if (!request.body)
    throw new SaveError(400, "Missing JSON body", "invalid_input");
  const reader = request.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > SAVE_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new SaveError(413, "Request exceeds byte limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof SaveError) throw error;
    throw new SaveError(400, "Malformed JSON or UTF-8", "invalid_input");
  } finally {
    reader.releaseLock();
  }
}
export function addDraftRoutes(app: Hono<OwnerBindings>) {
  for (const recovery of [false, true]) {
    const path = recovery ? "/api/owner/draft/recovery" : "/api/owner/draft";
    app.get(path, async (c) => {
      const identity = c.get("identity");
      const body = await ownerDrafts(c.env.DB, identity).read(recovery);
      const response = new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Robots-Tag": "noindex",
          Vary: "Cookie",
        },
      });
      if (recovery)
        response.headers.set(
          "Content-Disposition",
          'attachment; filename="portfolio-recovery.json"',
        );
      return response;
    });
    app.all(path, () => privateJson({ error: "invalid_input" }, 405));
  }
  app.get("/api/owner/progress", async (c) =>
    privateJson(await ownerDrafts(c.env.DB, c.get("identity")).metadata()),
  );
  app.all("/api/owner/progress", () =>
    privateJson({ error: "invalid_input" }, 405),
  );
  app.post("/api/owner/draft/:action", async (c) => {
    const name = c.req.param("action");
    if (!Object.hasOwn(ownerSaveActions, name))
      return privateJson({ error: "not_found" }, 404);
    const action = name as OwnerSaveAction,
      raw = await readBody(c.req.raw);
    const identity = c.get("identity"),
      drafts = ownerDrafts(c.env.DB, identity);
    const recovery = drafts.saves("content"),
      validation = legacyValidation(c.env.DB, identity);
    try {
      let result: unknown;
      switch (action) {
        case "patch": {
          const v = ownerSaveActions.patch.parse(raw);
          result = await drafts
            .saves(v.context)
            .change(
              v.change,
              v.revision,
              v.context === "setup" ? v.progress : undefined,
            );
          break;
        }
        case "progress": {
          const v = ownerSaveActions.progress.parse(raw);
          result = await drafts
            .saves("setup")
            .saveProgress(v.revision, v.progress);
          break;
        }
        case "begin": {
          const v = ownerSaveActions.begin.parse(raw);
          result = await drafts
            .saves(v.context)
            .begin(v.revision, v.context === "setup" ? v.progress : undefined);
          break;
        }
        case "pending":
          ownerSaveActions.pending.parse(raw);
          result = publicAttempt(await recovery.pending());
          break;
        case "status":
          result = publicAttempt(
            await recovery.status(ownerSaveActions.status.parse(raw).id),
          );
          break;
        case "resume":
          result = publicAttempt(
            await recovery.resume(ownerSaveActions.resume.parse(raw).id),
          );
          break;
        case "abort":
          result = await recovery.abort(ownerSaveActions.abort.parse(raw).id);
          break;
        case "cleanup":
          ownerSaveActions.cleanup.parse(raw);
          result = await recovery.cleanup();
          break;
        case "validation-begin":
          result = await validation.begin(
            ownerSaveActions["validation-begin"].parse(raw).revision,
          );
          break;
        case "validation-step": {
          const v = ownerSaveActions["validation-step"].parse(raw);
          result = await validation.step(v.id, v.sequence);
          break;
        }
        case "validation-correct": {
          const v = ownerSaveActions["validation-correct"].parse(raw);
          result = await validation.correct(v.id, v.sequence, v.path, v.value);
          break;
        }
        default: {
          // Context comes from the stored attempt, never a continuation body.
          const v = ownerSaveActions[action].parse(raw);
          const attempt = await recovery.status(v.id);
          if (attempt.context === "validation") {
            if (action !== "commit")
              throw new SaveError(
                422,
                "Use validation actions for this attempt",
              );
            result = await validation.commit(v.id, v.sequence);
            break;
          }
          const saves = drafts.saves(attempt.context);
          switch (action) {
            case "change":
              result = await saves.change(
                (v as ReturnType<typeof ownerSaveActions.change.parse>).change,
                0,
                undefined,
                v.id,
                v.sequence,
              );
              break;
            case "string-start":
              result = await saves.stringStart(
                v.id,
                v.sequence,
                (
                  v as ReturnType<
                    (typeof ownerSaveActions)["string-start"]["parse"]
                  >
                ).path,
              );
              break;
            case "piece":
              result = await saves.stringPiece(
                v.id,
                v.sequence,
                (v as ReturnType<typeof ownerSaveActions.piece.parse>).text,
              );
              break;
            case "string-finish":
              result = await saves.stringFinish(v.id, v.sequence);
              break;
            case "commit":
              result = await saves.commit(v.id, v.sequence);
              break;
          }
        }
      }
      return privateJson(result);
    } catch (error) {
      if (error instanceof SaveError)
        return privateJson({ error: error.code }, error.status);
      // Storage failures stay private and retryable. Validation errors never
      // include submitted content, schema internals or exception messages.
      const storage =
        error instanceof Error &&
        (error.message.startsWith("D1_") || error.message.includes("D1_ERROR"));
      return privateJson(
        { error: storage ? "storage_unavailable" : "invalid_input" },
        storage ? 503 : 422,
      );
    }
  });
  app.all("/api/owner/draft/:action", () =>
    privateJson({ error: "invalid_input" }, 405),
  );
}
