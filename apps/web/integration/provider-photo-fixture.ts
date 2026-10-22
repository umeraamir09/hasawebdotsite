const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAB4AAAAKCAIAAAAsFXl4AAAAIklEQVR4nGN4baSGB8lt9caDVDxe4EEMo0aPGj1qNClGAwAvoHLExPS+kAAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);
export let providerRequests = 0;
export let releaseProviderPhoto = () => {};

// Replace external image HTTP only. Authentication, crop, D1 and R2 stay real.
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (
    !["avatars.githubusercontent.com", "lh3.googleusercontent.com"].includes(
      url.hostname,
    ) ||
    !url.pathname.startsWith("/fixture/")
  )
    throw new Error("Unexpected provider fixture egress");
  if (
    request.headers.has("cookie") ||
    request.headers.has("authorization") ||
    request.redirect !== "manual"
  )
    throw new Error(
      "Provider import forwarded credentials or allowed redirects",
    );
  const mode = url.pathname.split("/").at(-1);
  providerRequests++;
  if (mode === "timeout")
    await new Promise<never>((_resolve, reject) => {
      request.signal.addEventListener(
        "abort",
        () => reject(request.signal.reason),
        { once: true },
      );
    });
  if (mode === "revoke")
    await new Promise<void>((resolve, reject) => {
      releaseProviderPhoto = resolve;
      request.signal.addEventListener(
        "abort",
        () => reject(request.signal.reason),
        { once: true },
      );
    });
  if (mode === "slow")
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2000);
      request.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(request.signal.reason);
        },
        { once: true },
      );
    });
  if (mode === "redirect")
    return new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1/private" },
    });
  if (mode === "missing") return new Response(null, { status: 404 });
  const body =
    mode === "magic"
      ? new Uint8Array([1, 2, 3, 4])
      : mode === "decode"
        ? png.slice(0, 16)
        : png;
  return new Response(body, {
    headers: {
      "Content-Type": mode === "mime" ? "image/svg+xml" : "image/png",
      "Content-Length":
        mode === "oversize" ? String(5_242_881) : String(body.length),
    },
  });
};
