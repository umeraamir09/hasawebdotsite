const encoder = new TextEncoder();

export function credentialBinding(
  portfolioId: string,
  appId: string,
  githubUserId: string,
  operationId: string,
  cleanupKind: "grant" | "token" = "grant",
) {
  return JSON.stringify([
    cleanupKind === "token"
      ? "hasaweb-activity-token-cleanup-v1"
      : "hasaweb-activity-v1",
    portfolioId,
    appId,
    githubUserId,
    operationId,
  ]);
}

// Read only after decryption authenticates this purpose through AES-GCM AAD.
export function activityCleanupKind(binding: string): "grant" | "token" {
  const [purpose] = JSON.parse(binding);
  if (purpose === "hasaweb-activity-token-cleanup-v1") return "token";
  if (purpose === "hasaweb-activity-v1") return "grant";
  throw new Error("Invalid activity credential purpose");
}

export async function encryptActivityToken(
  key: CryptoKey,
  token: string,
  binding: string,
) {
  if (!token || token.length > 8192) throw new Error("Invalid activity token");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(binding) },
    key,
    encoder.encode(token),
  );
  return JSON.stringify({
    version: 1,
    iv: [...iv],
    cipher: [...new Uint8Array(cipher)],
  });
}

export async function decryptActivityToken(
  key: CryptoKey,
  envelope: string,
  binding: string,
) {
  const data = JSON.parse(envelope) as {
    version: number;
    iv: number[];
    cipher: number[];
  };
  if (
    data.version !== 1 ||
    !Array.isArray(data.iv) ||
    data.iv.length !== 12 ||
    !Array.isArray(data.cipher) ||
    data.cipher.length < 17 ||
    data.cipher.length > 8208 ||
    [...data.iv, ...data.cipher].some(
      (n) => !Number.isInteger(n) || n < 0 || n > 255,
    )
  )
    throw new Error("Invalid encrypted activity credential");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(data.iv),
        additionalData: encoder.encode(binding),
      },
      key,
      new Uint8Array(data.cipher),
    ),
  );
}

// "gone" means the provider proved this credential can no longer act: nothing
// it could delete remains. It releases cleanup exactly like "deleted".
export type GrantDeletion = "deleted" | "gone" | "retry" | "uncertain";
export type GrantTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const applicationRequest = (
  app: { id: string; secret: string },
  method: "DELETE" | "POST",
  token: string,
): RequestInit => ({
  method,
  // Workers reject "error". A redirect is a completed response that is not
  // proof of deletion, so it stays a retry.
  redirect: "manual",
  signal: AbortSignal.timeout(10_000),
  headers: {
    Authorization: `Basic ${btoa(`${app.id}:${app.secret}`)}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "hasaweb-activity",
    "X-GitHub-Api-Version": "2026-03-10",
  },
  body: JSON.stringify({ access_token: token }),
});

/**
 * Revokes one activity credential at GitHub. Only HTTP 204 confirms deletion.
 *
 * `providerRejected` marks a credential that GitHub already refused with 401
 * during a refresh (the owner revoked the app on GitHub, for example). Such a
 * token can never delete anything again, so a 404/422 from the delete is
 * followed by GitHub's token check, which documents 404 for an invalid token.
 * Both observations together release the cleanup as "gone". Without the
 * earlier 401, a 404 is never treated as proof (Phase 11D).
 */
export async function deleteActivityCredential(
  transport: GrantTransport,
  app: { id: string; secret: string },
  token: string,
  kind: "grant" | "token",
  options: { providerRejected?: boolean } = {},
): Promise<GrantDeletion> {
  const base = `https://api.github.com/applications/${encodeURIComponent(app.id)}`;
  let status: number;
  try {
    status = (
      await transport(
        `${base}/${kind}`,
        applicationRequest(app, "DELETE", token),
      )
    ).status;
  } catch {
    // The provider may still be processing the request. No automatic lock expiry.
    return "uncertain";
  }
  // Do not interpret 401/404 alone as proof of grant-wide deletion.
  if (status === 204) return "deleted";
  if (!options.providerRejected || (status !== 404 && status !== 422))
    return "retry";
  try {
    // The delete already completed without effect, so a failed read-only
    // check leaves an ordinary retry rather than an uncertain lock.
    const check = await transport(
      `${base}/token`,
      applicationRequest(app, "POST", token),
    );
    return check.status === 404 ? "gone" : "retry";
  } catch {
    return "retry";
  }
}

export function deleteActivityGrant(
  transport: GrantTransport,
  app: { id: string; secret: string },
  token: string,
) {
  return deleteActivityCredential(transport, app, token, "grant");
}
