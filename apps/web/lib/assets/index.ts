import { type AuthEnvironment, currentSessionIdentity } from "@hasaweb/auth";
import {
  failPrivateAsset,
  type PrivateAsset,
  privateAssets,
  type SessionIdentity,
} from "@hasaweb/db";
import type { AssetPurpose } from "@hasaweb/schema";
import { UploadError, uploadFormat } from "./formats";
import { type AssetBucket, storeUpload } from "./stream";

export type PrivateAssetEnvironment = AuthEnvironment & {
  DRAFT_BUCKET: AssetBucket;
};
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex",
  Vary: "Cookie",
};
const response = (status: number) => new Response(null, { status, headers });
export function privateAssetKey(row: Pick<PrivateAsset, "portfolioId" | "id">) {
  return `draft/${row.portfolioId}/${row.id}`;
}

// Callers supply a library-verified identity. This repeats persisted access and
// checks object existence. It does not authorize a publication source transfer.
export async function resolvePrivateAsset(
  env: PrivateAssetEnvironment,
  identity: SessionIdentity,
  id: string,
  purpose: AssetPurpose,
) {
  const row = await privateAssets(env.DB, identity).ready(id, purpose);
  if (!row) return null;
  const object = await env.DRAFT_BUCKET.get(privateAssetKey(row));
  if (!object) return null;
  if (object.size !== row.bytes) {
    void object.body.cancel().catch(() => {});
    return null;
  }
  const current = await privateAssets(env.DB, identity).ready(id, purpose);
  if (!current) {
    void object.body.cancel().catch(() => {});
    return null;
  }
  return { asset: current, object };
}

export async function privateAssetRequest(
  request: Request,
  env: PrivateAssetEnvironment,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== "/api/assets" &&
    !url.pathname.startsWith("/api/assets/")
  )
    return null;
  const read = request.method === "GET";
  const upload = request.method === "PUT" && url.pathname === "/api/assets";
  try {
    if (!env.APP_ORIGIN || url.origin !== env.APP_ORIGIN) return response(404);
    if (!read && !upload) return response(405);
    if (upload && request.headers.get("Origin") !== env.APP_ORIGIN)
      throw new UploadError(403);
    const identity = await currentSessionIdentity(env, request.headers, {
      refresh: false,
    });
    if (!identity) throw new UploadError(401);
    const expected = request.headers.get("X-Expected-Owner-Id");
    if ((upload && !expected) || (expected && expected !== identity.user.id))
      throw new UploadError(409);
    if (read) {
      const id = url.pathname.slice("/api/assets/".length);
      if (!/^[a-f0-9-]{36}$/.test(id)) return response(404);
      const row = await privateAssets(env.DB, identity).ready(id);
      if (!row) return response(404);
      const resolved = await resolvePrivateAsset(env, identity, id, row.kind);
      if (!resolved) return response(404);
      return new Response(resolved.object.body, {
        headers: {
          ...headers,
          "Content-Type": resolved.asset.contentType,
          "Content-Length": String(resolved.asset.bytes),
          ...(resolved.asset.contentType === "application/pdf"
            ? { "Content-Disposition": 'attachment; filename="resume.pdf"' }
            : {}),
        },
      });
    }
    const format = uploadFormat(request.headers);
    const repository = privateAssets(env.DB, identity);
    const row = await repository.createPending({
      id: crypto.randomUUID(),
      kind: format.purpose,
      contentType: format.contentType,
      bytes: 0,
    });
    if (!row) throw new UploadError(409);
    let settled: Promise<unknown> = Promise.resolve();
    try {
      const transfer = storeUpload(
        request,
        env.DRAFT_BUCKET,
        privateAssetKey(row),
        format,
      );
      settled = transfer.settled;
      const bytes = await transfer.complete;
      let uncertain = false;
      try {
        await repository.finalize(row.id, bytes);
      } catch {
        uncertain = true;
        // A lost D1 response can hide a committed ready transition.
        // Resolve the persisted state before changing status or deleting bytes.
      }
      const ready = await repository.ready(row.id, format.purpose);
      if (!ready) throw new UploadError(uncertain ? 503 : 401);
      return Response.json(
        {
          id: ready.id,
          purpose: ready.kind,
          contentType: ready.contentType,
          bytes: ready.bytes,
          status: ready.status,
        },
        { status: 201, headers },
      );
    } catch (error) {
      try {
        const state = await failPrivateAsset(env.DB, row);
        if (
          (state?.status === "failed" || !state) &&
          !(error instanceof UploadError && error.preserveObject)
        ) {
          ctx.waitUntil(
            settled
              .then(() => env.DRAFT_BUCKET.delete(privateAssetKey(row)))
              .catch(() => {}),
          );
        }
      } catch {
        // Leave uncertain metadata and bytes private for later reconciliation.
      }
      throw error;
    }
  } catch (error) {
    // The HTTP runtime disposes unread bodies. Canceling them here can reset
    // the connection before the client receives the rejection.
    return response(
      read ? 404 : error instanceof UploadError ? error.status : 503,
    );
  }
}
