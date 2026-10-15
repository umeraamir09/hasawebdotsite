import { privateJson } from "@hasaweb/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { appAuthRequest, ownerResponse } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const normalized = appAuthRequest(request, env);
    if (!normalized) return privateJson(null, 404);
    return await ownerResponse(normalized, env);
  } catch {
    return privateJson({ error: "authentication_unavailable" }, 503);
  }
}
