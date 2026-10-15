/** Public deletion precedes purge. Failed purges deliberately reject for retry. */
export async function withdraw(
  bucket: Pick<R2Bucket, "delete">,
  key: string,
  publicUrl: string,
  purge: (url: string) => Promise<void>,
) {
  await bucket.delete(key);
  await purge(publicUrl);
}
