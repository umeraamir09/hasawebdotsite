"use client";

import { useCallback, useState, type ComponentProps } from "react";

type ImageWithSkeletonProps = ComponentProps<"img"> & {
  // Absolutely positioned images already have a frame, such as the portrait.
  overlay?: boolean;
};

export function ImageWithSkeleton(props: ImageWithSkeletonProps) {
  return <LoadingImage key={`${props.src}-${props.srcSet}`} {...props} />;
}

function LoadingImage({
  overlay = false,
  className,
  ref,
  onLoad,
  onError,
  alt = "",
  ...props
}: ImageWithSkeletonProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const imageRef = useCallback(
    (image: HTMLImageElement | null) => {
      // A cached image can finish before React attaches its load handler.
      if (image?.complete) {
        setState(image.naturalWidth > 0 ? "loaded" : "error");
      }
      if (typeof ref === "function") return ref(image);
      if (ref) ref.current = image;
    },
    [ref],
  );
  const content = (
    <>
      <img
        {...props}
        ref={imageRef}
        className={className}
        alt={alt}
        data-image-state={state}
        onLoad={(event) => {
          setState("loaded");
          onLoad?.(event);
        }}
        onError={(event) => {
          setState("error");
          onError?.(event);
        }}
      />
      {state !== "loaded" ? (
        <span
          className={`image-skeleton ${overlay ? (className ?? "") : ""}`}
          data-image-state={state}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return overlay ? content : <span className="image-frame">{content}</span>;
}
