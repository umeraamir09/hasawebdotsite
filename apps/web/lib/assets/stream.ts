import { signatureMatches, UploadError, type UploadFormat } from "./formats";

export type AssetBucket = Pick<R2Bucket, "put" | "get" | "delete">;
const IDLE_MS = 5_000;
const TOTAL_MS = 30_000;

export function storeUpload(
  request: Request,
  bucket: AssetBucket,
  key: string,
  format: UploadFormat,
) {
  if (request.signal.aborted) {
    if (request.body && !request.body.locked)
      void request.body.cancel().catch(() => {});
    throw new UploadError(408);
  }
  if (!request.body) throw new UploadError(400);
  const reader = request.body.getReader();
  const stream = new FixedLengthStream(format.bytes);
  const writer = stream.writable.getWriter();
  let timer: ReturnType<typeof setTimeout>;
  let rejectStopped: (reason: Error) => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  const cancel = () => rejectStopped(new UploadError(408));
  request.signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(cancel, TOTAL_MS);
  let written = 0;
  const put = Promise.resolve()
    .then(() =>
      bucket.put(key, stream.readable, {
        httpMetadata: { contentType: format.contentType },
        onlyIf: { etagDoesNotMatch: "*" },
      }),
    )
    .then((object) => {
      if (!object) throw new UploadError(409, true);
      return object;
    });
  const pump = async () => {
    const prefix = new Uint8Array(12);
    let prefixBytes = 0;
    let verified = false;
    while (true) {
      timer = setTimeout(cancel, IDLE_MS);
      const next = await Promise.race([reader.read(), stopped]);
      clearTimeout(timer);
      if (next.done) break;
      written += next.value.byteLength;
      if (written > format.bytes) throw new UploadError(413);
      if (!verified) {
        const needed = Math.min(12 - prefixBytes, next.value.length);
        prefix.set(next.value.subarray(0, needed), prefixBytes);
        prefixBytes += needed;
        if (prefixBytes === 12) {
          if (!signatureMatches(prefix, format)) throw new UploadError(415);
          verified = true;
          await Promise.race([writer.write(prefix), stopped]);
          if (needed < next.value.length)
            await Promise.race([
              writer.write(next.value.subarray(needed)),
              stopped,
            ]);
        }
      } else await Promise.race([writer.write(next.value), stopped]);
    }
    if (written !== format.bytes) throw new UploadError(400);
    if (!verified) {
      const bytes = prefix.subarray(0, prefixBytes);
      if (!signatureMatches(bytes, format)) throw new UploadError(415);
      await Promise.race([writer.write(bytes), stopped]);
    }
    await Promise.race([writer.close(), stopped]);
    return written;
  };
  const abort = (error: unknown) => {
    void reader.cancel(error).catch(() => {});
    void writer.abort(error).catch(() => {});
  };
  // Observe both branches even when storage rejects before it consumes bytes.
  const pumping = pump();
  void put.catch(abort);
  void pumping.catch(abort);
  const complete = Promise.race([Promise.all([put, pumping]), stopped])
    .then(([_object, bytes]) => bytes)
    .catch((error: unknown) => {
      abort(error);
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      clearTimeout(deadline);
      request.signal.removeEventListener("abort", cancel);
    });
  return { complete, settled: Promise.allSettled([put, pumping]) };
}
