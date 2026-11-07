import { isWebUrl } from "@hasaweb/schema";
import type { DisplayAsset } from "./model";

export function AssetImage({
  asset,
  kind = "image",
  className,
}: {
  asset: DisplayAsset;
  kind?: "image" | "avatar" | "face" | "banner";
  // Extra classes for the slot, such as the Face Reveal portrait layers.
  className?: string | undefined;
}) {
  const ready = asset.state === "ready" && isWebUrl(asset.url);
  return (
    <div
      className={`pf-image pf-image-${kind}${className ? ` ${className}` : ""}`}
      data-asset-state={
        ready
          ? "loading"
          : asset.state === "missing"
            ? "missing"
            : "unavailable"
      }
    >
      {ready && (
        <img
          src={asset.url}
          alt={asset.alt}
          width={kind === "banner" ? 1200 : 640}
          height={kind === "banner" ? 360 : 640}
          decoding="async"
        />
      )}
      <span className="pf-image-status" role="status">
        {ready
          ? "Image loading"
          : asset.state === "missing"
            ? "No image added"
            : "Image unavailable"}
      </span>
    </div>
  );
}
