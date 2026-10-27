export async function putBoundedStream(
  bucket: R2Bucket,
  key: string,
  input: ReadableStream<Uint8Array>,
  bytes: number,
  contentType = "text/html",
) {
  const reader = input.getReader(),
    fixed = new FixedLengthStream(bytes),
    writer = fixed.writable.getWriter();
  let count = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (reason: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    stop = reject;
  });
  const deadline = setTimeout(
    () => stop(new Error("Transfer total deadline")),
    30000,
  );
  const abort = (error: unknown) => {
    void reader.cancel(error).catch(() => {});
    void writer.abort(error).catch(() => {});
  };
  const put = Promise.resolve().then(() =>
    bucket.put(key, fixed.readable, {
      httpMetadata: { contentType, cacheControl: "private, no-store" },
    }),
  );
  const pump = (async () => {
    while (true) {
      timer = setTimeout(() => stop(new Error("Transfer idle deadline")), 5000);
      const part = await Promise.race([reader.read(), stopped]);
      if (timer !== undefined) clearTimeout(timer);
      if (part.done) break;
      count += part.value.byteLength;
      if (count > bytes) throw new Error("Transfer oversized");
      await Promise.race([writer.write(part.value), stopped]);
    }
    if (count !== bytes) throw new Error("Transfer truncated");
    await Promise.race([writer.close(), stopped]);
  })();
  void put.catch(abort);
  void pump.catch(abort);
  try {
    await Promise.race([Promise.all([put, pump]), stopped]);
  } catch (error) {
    abort(error);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    clearTimeout(deadline);
  }
}
