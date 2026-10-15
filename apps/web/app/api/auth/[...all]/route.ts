import { privateJson } from "@hasaweb/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { appAuthRequest, authResponse } from "../../../../lib/auth";

export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const normalized = appAuthRequest(request, env);
    if (!normalized) return privateJson(null, 404);
    return await authResponse(normalized, env);
  } catch {
    return privateJson({ error: "authentication_unavailable" }, 503);
  }
}

export { handle as GET, handle as POST };
