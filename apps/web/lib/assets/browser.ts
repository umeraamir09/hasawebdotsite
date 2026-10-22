import { projectPortfolioCancellable } from "@hasaweb/components/model";
import type { AssetPurpose, DraftDoc } from "@hasaweb/schema";
import { validateImageFile } from "./crop";

export function privateImageUrl(id: string, purpose: AssetPurpose) {
  return `/api/assets/${encodeURIComponent(id)}?purpose=${purpose}`;
}

export function uploadImage({
  blob,
  purpose,
  ownerId,
  signal,
  onProgress,
}: {
  blob: Blob;
  purpose: AssetPurpose;
  ownerId: string;
  signal: AbortSignal;
  onProgress(value: number): void;
}): Promise<string> {
  validateImageFile(blob);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const stop = () => request.abort();
    function done() {
      signal.removeEventListener("abort", stop);
    }
    function fail(message: string) {
      done();
      reject(new Error(message));
    }
    request.open("PUT", "/api/assets");
    request.timeout = 40_000;
    request.setRequestHeader("Content-Type", blob.type);
    request.setRequestHeader("X-Expected-Owner-Id", ownerId);
    request.setRequestHeader("X-Asset-Purpose", purpose);
    request.setRequestHeader("X-Asset-Bytes", String(blob.size));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () =>
      fail("Upload interrupted. Check your connection and retry.");
    request.ontimeout = () =>
      fail("Upload timed out. Check your connection and retry.");
    request.onabort = () =>
      fail("Upload cancelled. Your previous image is unchanged.");
    request.onload = () => {
      if (request.status !== 201) {
        fail(
          request.status === 413
            ? "Choose an image of 5 MiB or less."
            : request.status === 415
              ? "Choose a JPEG, PNG or WebP image."
              : request.status === 401 || request.status === 409
                ? "Your session changed. Sign in again before retrying."
                : "The upload could not finish. Retry the upload.",
        );
        return;
      }
      try {
        const value: unknown = JSON.parse(request.responseText);
        if (
          !isReadyUpload(value, {
            purpose,
            contentType: blob.type,
            bytes: blob.size,
          })
        )
          throw new Error("Invalid upload receipt");
        done();
        resolve(value.id);
      } catch {
        fail("The upload was not confirmed. Retry the upload.");
      }
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) {
      done();
      reject(new Error("Upload cancelled."));
      return;
    }
    request.send(blob);
  });
}

function isReadyUpload(
  value: unknown,
  expected: { purpose: AssetPurpose; contentType: string; bytes: number },
): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    /^[a-f0-9-]{36}$/.test(value.id) &&
    "status" in value &&
    value.status === "ready" &&
    "purpose" in value &&
    value.purpose === expected.purpose &&
    "contentType" in value &&
    value.contentType === expected.contentType &&
    "bytes" in value &&
    value.bytes === expected.bytes
  );
}

export async function readPrivateImage({
  id,
  purpose,
  ownerId,
  signal,
}: {
  id: string;
  purpose: AssetPurpose;
  ownerId: string;
  signal: AbortSignal;
}): Promise<Blob> {
  const response = await fetch(privateImageUrl(id, purpose), {
    headers: { "X-Expected-Owner-Id": ownerId },
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(
      "This image is unavailable. Select the original file to replace it.",
    );
  const blob = await response.blob();
  validateImageFile(blob);
  return blob;
}

export async function resolvePreviewImages({
  ownerId,
  draft,
  signal,
}: {
  ownerId: string;
  draft: DraftDoc;
  signal: AbortSignal;
}) {
  const requested = new Map<
    string,
    { assetId: string; purpose: AssetPurpose }
  >();
  await projectPortfolioCancellable(
    draft,
    {
      assetOrigins: [],
      resolveAsset: (asset) => {
        if (/^[a-f0-9-]{36}$/.test(asset.assetId))
          requested.set(`${asset.purpose}:${asset.assetId}`, asset);
        return { state: "unavailable" };
      },
    },
    signal,
  );
  const images = [...requested.values()];
  const ready = new Map<string, string>();
  let next = 0;
  async function read() {
    while (next < images.length) {
      const image = images[next++];
      if (!image) return;
      const { assetId, purpose } = image;
      if (signal.aborted) throw signal.reason;
      try {
        const response = await fetch(privateImageUrl(assetId, purpose), {
          headers: { "X-Expected-Owner-Id": ownerId },
          cache: "no-store",
          signal,
        });
        const type = response.headers.get("Content-Type");
        if (
          response.ok &&
          ["image/jpeg", "image/png", "image/webp"].includes(type ?? "")
        )
          ready.set(
            `${purpose}:${assetId}`,
            new URL(privateImageUrl(assetId, purpose), location.origin).href,
          );
        await response.body?.cancel();
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, images.length) }, read));
  return {
    assetOrigins: [location.origin],
    resolveAsset: ({
      assetId,
      purpose,
    }: {
      assetId: string;
      purpose: AssetPurpose;
    }) => {
      const url = ready.get(`${purpose}:${assetId}`);
      return url
        ? { state: "ready" as const, url }
        : { state: "unavailable" as const };
    },
  };
}
