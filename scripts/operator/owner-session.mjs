// A short-lived owner session for operator scripts that must act through the
// product's own owner routes (the example publisher, rerender). The script
// inserts one session row, signs its cookie with BETTER_AUTH_SECRET exactly
// as Better Auth does, and deletes the row when the run ends. Nothing else
// about the account changes.
import { createHmac, randomBytes, randomUUID } from "node:crypto";

const SESSION_MS = 15 * 60 * 1000;
const PUBLISH_LIMIT_MS = 10 * 60 * 1000;

export class OwnerSessionError extends Error {}

/** The Better Auth session cookie for a token, signed with the app secret. */
export function sessionCookie(token, secret, name) {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return `${name}=${encodeURIComponent(`${token}.${signature}`)}`;
}

/**
 * Runs `work(call)` with a session for `owner`, then deletes the session.
 * `call(path, { method, body, extra })` sends a same-origin owner request
 * with the session cookie and `X-Expected-Owner-Id`, and throws
 * `OwnerSessionError` on a non-2xx response.
 *
 * @template T
 * @param {{
 *   origin: string,
 *   secret: string,
 *   sql: (query: string, values?: unknown[]) => Promise<unknown>,
 *   owner: string,
 *   label: string,
 *   cookieName?: string,
 *   headers?: Record<string, string>,
 * }} options
 * @param {(call: (path: string, options?: { method?: string, body?: unknown, extra?: Record<string, string> }) => Promise<any>) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withOwnerSession(
  {
    origin,
    secret,
    sql,
    owner,
    label,
    cookieName = new URL(origin).protocol === "https:"
      ? "__Host-hasaweb.session_token"
      : "hasaweb-local.session_token",
    headers = {},
  },
  work,
) {
  if (!secret || secret.length < 32)
    throw new OwnerSessionError("BETTER_AUTH_SECRET is required");
  const token = randomBytes(24).toString("hex");
  const sessionId = `${label}-${randomBytes(8).toString("hex")}`;
  const now = Date.now();
  await sql(
    "INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    [sessionId, token, owner, now + SESSION_MS, now, now],
  );
  const cookie = sessionCookie(token, secret, cookieName);
  async function call(path, { method = "POST", body, extra = {} } = {}) {
    const response = await fetch(new URL(path, origin), {
      method,
      redirect: "manual",
      headers: {
        ...headers,
        Cookie: cookie,
        Origin: origin,
        "X-Expected-Owner-Id": owner,
        ...(body === undefined || body instanceof Uint8Array
          ? {}
          : { "Content-Type": "application/json" }),
        ...extra,
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (!response.ok)
      throw new OwnerSessionError(
        `${method} ${path}: ${response.status} ${result?.error ?? result?.code ?? text.slice(0, 200)}`,
      );
    return result;
  }
  try {
    return await work(call);
  } finally {
    await sql("DELETE FROM session WHERE id=?", [sessionId]);
  }
}

/**
 * Publishes one saved revision through the owner publication routes: start,
 * poll status, commit when ready, then read the site state.
 */
export async function publishRevision(
  call,
  { portfolioId, revision, pollMs = 750, limitMs = PUBLISH_LIMIT_MS },
) {
  const operationId = randomUUID();
  const end = Date.now() + limitMs;
  let operation = await call("/api/owner/publication/start", {
    body: { portfolioId, operationId, revision },
  });
  while (operation.stage !== "published") {
    if (operation.stage === "failed")
      throw new OwnerSessionError(
        `Publication failed: ${operation.error ?? "unknown"}`,
      );
    if (Date.now() >= end)
      throw new OwnerSessionError("Publication did not finish in time");
    if (operation.stage === "ready") {
      operation = await call("/api/owner/publication/commit", {
        body: { portfolioId, operationId },
      });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    operation = await call("/api/owner/publication/status", {
      body: { portfolioId, operationId },
    });
  }
  const site = await call("/api/owner/publication/site", {
    body: { portfolioId },
  });
  return { operation, site };
}
