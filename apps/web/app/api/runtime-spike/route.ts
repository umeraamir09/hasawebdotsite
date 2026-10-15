import { getCloudflareContext } from "@opennextjs/cloudflare";
import { spikeAuth } from "../../../spike/auth";

export const dynamic = "force-dynamic";
const LIMIT = 1_048_576;
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}
async function handle(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  // Double opt-in. This is an operator experiment, never a product endpoint.
  if (
    env.SPIKE_ENABLED !== "true" ||
    !env.SPIKE_KEY ||
    !env.BETTER_AUTH_SECRET ||
    request.headers.get("Authorization") !== `Bearer ${env.SPIKE_KEY}`
  )
    return reply(null, 404);
  const origin = env.SPIKE_ORIGIN;
  // Next.js reconstructs local request URLs with localhost. Validate the
  // authority header and the configured Origin rather than that internal URL.
  if (!origin || request.headers.get("host") !== new URL(origin).host)
    return reply(null, 404);
  if (request.method === "POST" && request.headers.get("Origin") !== origin)
    return reply(null, 403);
  const auth = spikeAuth(env.DB, env.BETTER_AUTH_SECRET, origin);
  const result = await auth.api.getSession({
    headers: request.headers,
    asResponse: true,
  });
  if (!result.ok)
    return reply({ dependency: "session", status: result.status }, 503);
  const identity = (await result.json()) as { user?: { id: string } } | null;
  if (!identity?.user) return reply(null, 401);
  const owner = await env.DB.prepare(
    "SELECT deleting, writes FROM spike_owner WHERE id = ?",
  )
    .bind(identity.user.id)
    .first<{ deleting: number; writes: number }>();
  if (!owner || owner.deleting) return reply(null, 403);
  let writes = owner.writes;
  if (request.method === "POST") {
    if (
      request.headers.get("Content-Type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      return reply(null, 415);
    // Bound bytes while reading, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply(null, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) {
        await reader.cancel();
        return reply(null, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload = new TextDecoder().decode(bytes);
    try {
      JSON.parse(payload);
    } catch {
      return reply(null, 400);
    }
    // No client-provided owner ID is used. This is a synthetic write, not draft saving.
    const update = await env.DB.prepare(
      "UPDATE spike_owner SET payload = ?, writes = writes + 1 WHERE id = ? AND deleting = 0",
    )
      .bind(payload, identity.user.id)
      .run()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        return {
          spikeError: /size|too large|too big/i.test(message)
            ? "size"
            : "write",
        };
      });
    if ("spikeError" in update)
      return reply({ dependency: "d1", category: update.spikeError }, 503);
    if (update.meta.changes !== 1) return reply(null, 403);
    writes++;
  }
  const response = reply({ authenticated: true, writes });
  for (const cookie of result.headers.getSetCookie())
    response.headers.append("Set-Cookie", cookie);
  return response;
}

async function guarded(request: Request) {
  try {
    return await handle(request);
  } catch {
    return reply(null, 503);
  }
}

export { guarded as GET, guarded as POST };
