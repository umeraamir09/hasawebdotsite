import { type AuthEnvironment, currentSessionIdentity } from "@hasaweb/auth";
import {
  assertSaveSession,
  ownerSetup,
  privateJson,
  SaveError,
} from "@hasaweb/db";
import { setupCommandSchema } from "@hasaweb/schema";
import { type PrivateAssetEnvironment, resolvePrivateAsset } from "./assets";

async function commandBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SaveError(400, "Missing body", "invalid_input");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024)
        throw new SaveError(413, "Request too large", "byte_limit");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return setupCommandSchema.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(422, "Invalid command", "invalid_input");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function setupRequest(
  request: Request,
  env: AuthEnvironment & PrivateAssetEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !["/api/owner/setup/check", "/api/owner/setup/handoff"].includes(
      url.pathname,
    )
  )
    return null;
  try {
    if (url.origin !== env.APP_ORIGIN) return privateJson(null, 404);
    if (request.method !== "POST") return privateJson(null, 405);
    if (request.headers.get("Origin") !== env.APP_ORIGIN)
      return privateJson(null, 403);
    if (
      request.headers
        .get("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return privateJson(null, 415);
    const identity = await currentSessionIdentity(env, request.headers, {
      refresh: false,
    });
    if (!identity) return privateJson({ error: "unauthorized" }, 401);
    await assertSaveSession(env.DB, identity);
    const expected = request.headers.get("X-Expected-Owner-Id");
    if (!expected) return privateJson({ error: "invalid_input" }, 400);
    if (expected !== identity.user.id)
      return privateJson({ error: "owner_changed" }, 409);
    const command = await commandBody(request);
    const setup = ownerSetup(env.DB, identity, async (id, purpose) => {
      const resolved = await resolvePrivateAsset(env, identity, id, purpose);
      if (!resolved) return false;
      void resolved.object.body.cancel().catch(() => {});
      return true;
    });
    return privateJson(
      await (url.pathname.endsWith("/handoff")
        ? setup.handoff(command)
        : setup.validate(command)),
    );
  } catch (error) {
    if (error instanceof SaveError)
      return privateJson({ error: error.code }, error.status);
    return privateJson({ error: "storage_unavailable" }, 503);
  }
}
