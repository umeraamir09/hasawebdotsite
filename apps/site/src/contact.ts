import {
  CONTACT_LIMITS,
  type ContactResponse,
  checkContactFields,
  TURNSTILE_ORIGIN,
} from "@hasaweb/components/contact";
import {
  acceptSubmission,
  contactPortfolio,
  countVisitorAttempt,
} from "@hasaweb/db/contact-submission";

// `/_/contact` on a portfolio host (Phase 44). GET tells the published form
// whether it can send and which Turnstile site key to use. POST accepts one
// visitor message: 202 only after the allowance is reserved and the outbox row
// exists. Every other outcome is a closed error code, so the form never claims
// success it does not have. Responses never contain the recipient.

export type ContactEnv = {
  DB: D1Database;
  APP_ENV?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  // Local and test fixtures only: a stand-in for Turnstile's siteverify API.
  TURNSTILE_VERIFY_ORIGIN?: string;
};
export type Turnstile = "passed" | "blocked" | "unavailable";

const MAX_BODY_BYTES = 32 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const development = (env: ContactEnv) =>
  env.APP_ENV === "local" || env.APP_ENV === "test";

function reply(
  status: number,
  body: ContactResponse | { siteKey: string | null },
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      ...extra,
    },
  });
}
const retryAfter = (ms: number) => ({
  "Retry-After": String(Math.max(1, Math.ceil(ms / 1000))),
});

/** Turnstile's server-side check of one single-use token. */
export async function verifyTurnstile(
  env: ContactEnv,
  token: string,
  remoteIp: string | null,
  host: string,
  transport: typeof fetch = (input, init) => fetch(input, init),
): Promise<Turnstile> {
  if (!env.TURNSTILE_SECRET) return "unavailable";
  const origin =
    development(env) && env.TURNSTILE_VERIFY_ORIGIN
      ? new URL(env.TURNSTILE_VERIFY_ORIGIN).origin
      : TURNSTILE_ORIGIN;
  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    idempotency_key: crypto.randomUUID(),
  });
  if (remoteIp) form.set("remoteip", remoteIp);
  let outcome: {
    success?: unknown;
    hostname?: unknown;
    action?: unknown;
    "error-codes"?: unknown;
  };
  try {
    const response = await transport(`${origin}/turnstile/v0/siteverify`, {
      method: "POST",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "unavailable";
    outcome = await response.json();
  } catch {
    // Timeouts and network failures are ours, not the visitor's: retry later.
    return "unavailable";
  }
  if (outcome.success !== true)
    return Array.isArray(outcome["error-codes"]) &&
      outcome["error-codes"].includes("internal-error")
      ? "unavailable"
      : "blocked";
  // Test keys report a placeholder host; production tokens must come from
  // this portfolio's form, so a token solved elsewhere cannot be replayed.
  if (
    !development(env) &&
    (outcome.hostname !== host || outcome.action !== "contact")
  )
    return "blocked";
  return "passed";
}

async function visitorKey(portfolioId: string, ip: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${portfolioId}\n${ip}`),
  );
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type Body = { name: string; email: string; message: string; token: string };
function parseBody(text: string): Body | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ["name", "email", "message", "token"];
  if (
    Object.keys(record).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof record[key] !== "string")
  )
    return null;
  return record as Body;
}

export async function serveContact(
  request: Request,
  env: ContactEnv,
  name: string,
  { now = Date.now, turnstile = verifyTurnstile } = {},
): Promise<Response> {
  try {
    return await handle(request, env, name, now, turnstile);
  } catch {
    // D1 or the platform failed. Nothing was accepted; the visitor may retry.
    return reply(503, { error: "failed" }, retryAfter(30_000));
  }
}

async function handle(
  request: Request,
  env: ContactEnv,
  name: string,
  now: () => number,
  turnstile: typeof verifyTurnstile,
): Promise<Response> {
  const host = new URL(request.url).host;
  if (request.method === "GET" || request.method === "HEAD") {
    if (!(await contactPortfolio(env.DB, name)))
      return reply(404, { error: "unavailable" });
    return reply(200, { siteKey: env.TURNSTILE_SITE_KEY ?? null });
  }
  if (request.method !== "POST")
    return reply(405, { error: "invalid_request" }, { Allow: "GET, POST" });
  // Same-origin JSON only: a page elsewhere cannot post as this form.
  if (request.headers.get("Origin") !== `https://${host}`)
    return reply(403, { error: "invalid_request" });
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    return reply(415, { error: "invalid_request" });
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES)
    return reply(413, { error: "invalid_request" });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    return reply(413, { error: "invalid_request" });
  const body = parseBody(text);
  if (!body) return reply(400, { error: "invalid_request" });
  const { values, errors } = checkContactFields(body);
  if (Object.keys(errors).length)
    return reply(422, { error: "invalid_fields", fields: errors });
  const portfolioId = await contactPortfolio(env.DB, name);
  if (!portfolioId) return reply(404, { error: "unavailable" });
  // Every complete attempt counts, including ones Turnstile then blocks.
  const ip = request.headers.get("CF-Connecting-IP");
  const at = now();
  if (
    !(await countVisitorAttempt(
      env.DB,
      portfolioId,
      await visitorKey(portfolioId, ip ?? "unknown"),
      at,
    ))
  )
    return reply(
      429,
      { error: "limited" },
      retryAfter(HOUR_MS - (at % HOUR_MS)),
    );
  if (!body.token || body.token.length > CONTACT_LIMITS.token)
    return reply(403, { error: "blocked" });
  const check = await turnstile(env, body.token, ip, host);
  if (check === "blocked") return reply(403, { error: "blocked" });
  if (check === "unavailable")
    return reply(503, { error: "unavailable" }, retryAfter(60_000));
  const result = await acceptSubmission(env.DB, {
    portfolioId,
    ...values,
    now: at,
  });
  if (result.status === "accepted") return reply(202, { status: "accepted" });
  if (result.status === "limited")
    return reply(
      429,
      { error: "limited" },
      retryAfter(24 * HOUR_MS - (at % (24 * HOUR_MS))),
    );
  return reply(503, { error: "unavailable" }, retryAfter(HOUR_MS));
}
