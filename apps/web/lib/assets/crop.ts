import { IMAGE_BYTES } from "./formats";

export type CropPurpose = "avatar" | "banner";
export type CropPosition = { zoom: number; x: number; y: number };
export type ImageDimensions = { width: number; height: number };
export const initialCrop: CropPosition = { zoom: 1, x: 0.5, y: 0.5 };
export const cropSizes = {
  avatar: { width: 848, height: 880 },
  banner: { width: 1600, height: 480 },
} satisfies Record<CropPurpose, ImageDimensions>;

export function cropRectangle(
  image: ImageDimensions,
  purpose: CropPurpose,
  position: CropPosition,
) {
  const target = cropSizes[purpose];
  const ratio = target.width / target.height;
  const zoom = Math.min(4, Math.max(1, position.zoom));
  const width = Math.min(image.width, image.height * ratio) / zoom;
  const height = width / ratio;
  return {
    x: (image.width - width) * Math.min(1, Math.max(0, position.x)),
    y: (image.height - height) * Math.min(1, Math.max(0, position.y)),
    width,
    height,
  };
}

export type LocalImage = {
  element: HTMLImageElement;
  url: string;
  release(): void;
};

export function validateImageFile(file: Blob) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG or WebP image.");
  if (file.size > IMAGE_BYTES)
    throw new Error("Choose an image of 5 MiB or less.");
  if (file.size === 0)
    throw new Error("This image is empty. Choose another file.");
}

export async function openLocalImage(file: Blob): Promise<LocalImage> {
  validateImageFile(file);
  const url = URL.createObjectURL(file);
  const element = new Image();
  element.src = url;
  try {
    await element.decode();
    if (!element.naturalWidth || !element.naturalHeight)
      throw new Error("Image has no pixels");
    return { element, url, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      "This image could not be opened. Choose another JPEG, PNG or WebP file.",
    );
  }
}

export async function encodeCrop(
  image: LocalImage,
  purpose: CropPurpose,
  position: CropPosition,
): Promise<Blob> {
  const source = cropRectangle(
    { width: image.element.naturalWidth, height: image.element.naturalHeight },
    purpose,
    position,
  );
  const target = cropSizes[purpose];
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cropping is unavailable in this browser.");
  context.drawImage(
    image.element,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    target.width,
    target.height,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.92),
  );
  if (!blob) throw new Error("The crop could not be prepared. Try again.");
  validateImageFile(blob);
  return blob;
}
