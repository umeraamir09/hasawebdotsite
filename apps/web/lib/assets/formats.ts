import type { AssetPurpose } from "@hasaweb/schema";

export const IMAGE_BYTES = 5_242_880;
export const PDF_BYTES = 10_485_760;
export function isAssetPurpose(value: string | null): value is AssetPurpose {
  return (
    value === "avatar" ||
    value === "banner" ||
    value === "face" ||
    value === "project" ||
    value === "case_study" ||
    value === "resume" ||
    value === "og"
  );
}
export type UploadFormat = {
  purpose: AssetPurpose;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  bytes: number;
};
export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly preserveObject = false,
  ) {
    super("Upload rejected");
  }
}
export function uploadFormat(headers: Headers): UploadFormat {
  const purpose = headers.get("X-Asset-Purpose");
  if (!isAssetPurpose(purpose)) throw new UploadError(400);
  const contentType = headers.get("Content-Type")?.toLowerCase();
  if (
    contentType !== "image/jpeg" &&
    contentType !== "image/png" &&
    contentType !== "image/webp" &&
    contentType !== "application/pdf"
  )
    throw new UploadError(415);
  if ((purpose === "resume") !== (contentType === "application/pdf"))
    throw new UploadError(415);
  const native = headers.get("Content-Length");
  const declared = headers.get("X-Asset-Bytes");
  const raw = native ?? declared;
  if (!raw || !/^[1-9]\d*$/.test(raw)) throw new UploadError(411);
  const bytes = Number(raw);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes > (purpose === "resume" ? PDF_BYTES : IMAGE_BYTES)
  )
    throw new UploadError(413);
  if (declared !== null && declared !== String(bytes))
    throw new UploadError(400);
  return { purpose, contentType, bytes };
}
export function signatureMatches(bytes: Uint8Array, format: UploadFormat) {
  const ascii = (start: number, value: string) =>
    [...value].every(
      (char, index) => bytes[start + index] === char.charCodeAt(0),
    );
  switch (format.contentType) {
    case "image/jpeg":
      return (
        bytes.length >= 3 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
      );
    case "image/png":
      return (
        bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every(
          (value, index) => bytes[index] === value,
        )
      );
    case "image/webp":
      return bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP");
    case "application/pdf":
      return (
        bytes.length >= 8 &&
        ascii(0, "%PDF-") &&
        (bytes[5] === 49 || bytes[5] === 50) &&
        bytes[6] === 46 &&
        bytes[7] !== undefined &&
        bytes[7] >= 48 &&
        bytes[7] <= 57
      );
  }
}
