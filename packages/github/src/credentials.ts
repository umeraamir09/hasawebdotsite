const encoder = new TextEncoder();

export function credentialBinding(
  portfolioId: string,
  appId: string,
  githubUserId: string,
  operationId: string,
) {
  return JSON.stringify([
    "hasaweb-activity-v1",
    portfolioId,
    appId,
    githubUserId,
    operationId,
  ]);
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

export type GrantDeletion = "deleted" | "retry" | "uncertain";
export type GrantTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export async function deleteActivityGrant(
  transport: GrantTransport,
  app: { id: string; secret: string },
  token: string,
): Promise<GrantDeletion> {
  try {
    const response = await transport(
      `https://api.github.com/applications/${encodeURIComponent(app.id)}/grant`,
      {
        method: "DELETE",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Basic ${btoa(`${app.id}:${app.secret}`)}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "hasaweb-activity",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({ access_token: token }),
      },
    );
    // Do not interpret 401/404 as proof of grant-wide deletion.
    return response.status === 204 ? "deleted" : "retry";
  } catch {
    // The provider may still be processing the request. No automatic lock expiry.
    return "uncertain";
  }
}
