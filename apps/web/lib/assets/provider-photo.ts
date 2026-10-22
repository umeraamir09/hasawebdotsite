import { currentSessionIdentity, providerPhotoUrl } from "@hasaweb/auth";
import { privateAssets } from "@hasaweb/db";
import type { PrivateAssetEnvironment } from ".";
import {
  IMAGE_BYTES,
  signatureMatches,
  UploadError,
  uploadFormat,
} from "./formats";

export async function fetchProviderPhoto(
  url: string,
  signal: AbortSignal,
): Promise<Blob> {
  const allowed = providerPhotoUrl(url);
  if (!allowed) throw new UploadError(415);
  const source = await fetch(allowed, {
    redirect: "manual",
    credentials: "omit",
    headers: { Accept: "image/jpeg, image/png, image/webp" },
    signal,
  });
  const reader = source.body?.getReader();
  try {
    if (source.status !== 200 || !reader) throw new UploadError(502);
    const contentType = source.headers
      .get("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (
      !contentType ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType)
    )
      throw new UploadError(415);
    const declared = source.headers.get("Content-Length");
    if (
      declared &&
      (!/^[1-9]\d*$/.test(declared) || Number(declared) > IMAGE_BYTES)
    )
      throw new UploadError(413);
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > IMAGE_BYTES) throw new UploadError(413);
      parts.push(new Uint8Array(next.value));
    }
    signal.throwIfAborted();
    if (declared && bytes !== Number(declared)) throw new UploadError(400);
    const format = uploadFormat(
      new Headers({
        "Content-Type": contentType,
        "X-Asset-Purpose": "avatar",
        "X-Asset-Bytes": String(bytes),
      }),
    );
    const blob = new Blob(parts, { type: contentType });
    if (
      !signatureMatches(
        new Uint8Array(await blob.slice(0, 12).arrayBuffer()),
        format,
      )
    )
      throw new UploadError(415);
    return blob;
  } finally {
    await reader?.cancel().catch(() => {});
  }
}

export async function providerPhotoRequest(
  request: Request,
  env: PrivateAssetEnvironment,
  headers: Record<string, string>,
): Promise<Response> {
  const identity = await currentSessionIdentity(env, request.headers, {
    refresh: false,
  });
  if (!identity) throw new UploadError(401);
  const expected = request.headers.get("X-Expected-Owner-Id");
  if (!expected) throw new UploadError(400);
  if (expected !== identity.user.id) throw new UploadError(409);
  const repository = privateAssets(env.DB, identity);
  if (!(await repository.authorizedPortfolio())) throw new UploadError(401);
  const url = providerPhotoUrl(identity.user.image);
  if (!url) throw new UploadError(404);
  const photo = await fetchProviderPhoto(
    url,
    AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
  );
  if (!(await repository.authorizedPortfolio())) throw new UploadError(401);
  return new Response(photo, {
    headers: {
      ...headers,
      "Content-Type": photo.type,
      "Content-Length": String(photo.size),
    },
  });
}
