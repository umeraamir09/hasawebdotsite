import { projectPortfolioCancellable } from "@hasaweb/components/model";
import {
  type AssetPurpose,
  collectDraftAssetReferences,
  type DraftDoc,
} from "@hasaweb/schema";
import { loadGraphPreview } from "../editor/github-graph";
import { profileSuggestions } from "../editor/provider-suggestions";
import { validateImageFile } from "./crop";

export async function readProviderPhoto({
  ownerId,
  portfolioId,
  signal,
}: {
  ownerId: string;
  portfolioId: string;
  signal: AbortSignal;
}): Promise<Blob> {
  const suggestion = await profileSuggestions({ ownerId, portfolioId, signal });
  if (!suggestion.photoAvailable)
    throw new Error(
      "Your account has no supported photo. Upload an image instead.",
    );
  const response = await fetch("/api/assets/provider-photo", {
    headers: { "X-Expected-Owner-Id": ownerId },
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(
      "Your account photo could not be imported. Try again or upload an image instead.",
    );
  const blob = await response.blob();
  validateImageFile(blob);
  return blob;
}

export function privateImageUrl(id: string, purpose: AssetPurpose) {
  return `/api/assets/${encodeURIComponent(id)}?purpose=${purpose}`;
}
// The inline variant of a private resume PDF, for the embedded viewer.
export function privateResumeViewUrl(id: string) {
  return `/api/assets/${encodeURIComponent(id)}/view?purpose=resume`;
}

type UploadOptions = {
  blob: Blob;
  purpose: AssetPurpose;
  ownerId: string;
  signal: AbortSignal;
  onProgress(value: number): void;
};
export function uploadImage(options: UploadOptions): Promise<string> {
  validateImageFile(options.blob);
  return uploadAsset(options);
}
export const RESUME_BYTES = 10_485_760;
// Accept a PDF chosen without a reported type, as some platforms supply.
export async function resumeFile(file: File | Blob): Promise<Blob> {
  const named = "name" in file && /\.pdf$/i.test(file.name);
  if (file.type !== "application/pdf" && !(file.type === "" && named))
    throw new Error("Choose a PDF file.");
  if (!file.size) throw new Error("This PDF is empty. Choose another file.");
  if (file.size > RESUME_BYTES)
    throw new Error("Choose a PDF of 10 MiB or less.");
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== "%PDF-")
    throw new Error("This file is not a readable PDF. Choose another file.");
  return file.type === "application/pdf"
    ? file
    : new Blob([file], { type: "application/pdf" });
}
export function uploadResume(
  options: Omit<UploadOptions, "purpose">,
): Promise<string> {
  return uploadAsset({ ...options, purpose: "resume" });
}
function uploadAsset({
  blob,
  purpose,
  ownerId,
  signal,
  onProgress,
}: UploadOptions): Promise<string> {
  const pdf = purpose === "resume";
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
      fail(
        `Upload cancelled. Your previous ${pdf ? "resume" : "image"} is unchanged.`,
      );
    request.onload = () => {
      if (request.status !== 201) {
        fail(
          request.status === 413
            ? pdf
              ? "Choose a PDF of 10 MiB or less."
              : "Choose an image of 5 MiB or less."
            : request.status === 415
              ? pdf
                ? "Choose a PDF file."
                : "Choose a JPEG, PNG or WebP image."
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
  cache = new Map<string, string>(),
  caseStudies = false,
}: {
  ownerId: string;
  draft: DraftDoc;
  signal: AbortSignal;
  cache?: Map<string, string>;
  // Case-study pages need their body images. The editor's live preview shows
  // only the portfolio page and skips them.
  caseStudies?: boolean;
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
  if (caseStudies)
    for (const reference of collectDraftAssetReferences(draft))
      if (
        reference.kind === "case_study" &&
        /^[a-f0-9-]{36}$/.test(reference.assetId)
      )
        requested.set(`case_study:${reference.assetId}`, {
          assetId: reference.assetId,
          purpose: "case_study",
        });
  const images = [...requested.values()];
  const ready = new Map<string, string>();
  let next = 0;
  async function read() {
    while (next < images.length) {
      const image = images[next++];
      if (!image) return;
      const { assetId, purpose } = image;
      if (signal.aborted) throw signal.reason;
      const key = `${purpose}:${assetId}`;
      const cached = cache.get(key);
      if (cached) {
        ready.set(key, cached);
        continue;
      }
      try {
        const response = await fetch(privateImageUrl(assetId, purpose), {
          headers: { "X-Expected-Owner-Id": ownerId },
          cache: "no-store",
          signal,
        });
        const type = response.headers.get("Content-Type");
        if (
          response.ok &&
          (purpose === "resume"
            ? type === "application/pdf"
            : ["image/jpeg", "image/png", "image/webp"].includes(type ?? ""))
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
  signal.throwIfAborted();
  cache.clear();
  for (const [key, url] of ready) cache.set(key, url);
  // The owner-authorized public calendar, only when a graph needs it.
  const graph = draft.components.some(
    (item) => item.type === "github" && item.data.username,
  )
    ? await loadGraphPreview(signal)
    : null;
  return {
    graph,
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
        ? {
            state: "ready" as const,
            url,
            ...(purpose === "resume"
              ? {
                  viewUrl: new URL(
                    privateResumeViewUrl(assetId),
                    location.origin,
                  ).href,
                }
              : {}),
          }
        : { state: "unavailable" as const };
    },
  };
}
