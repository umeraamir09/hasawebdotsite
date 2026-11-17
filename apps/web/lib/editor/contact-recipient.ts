import { z } from "zod";

// Browser adapter for the owner-only contact recipient routes (Phase 43).
// The address is the owner's own private data: every call names the expected
// owner, and responses are parsed strictly. Errors are closed codes.

const statusSchema = z.object({
  recipient: z
    .strictObject({
      email: z.string().max(254),
      state: z.enum(["verified", "pending", "unverified"]),
    })
    .nullable(),
  accountEmail: z.string().max(254).nullable(),
});
export type RecipientStatus = z.infer<typeof statusSchema>;

export const recipientFailureSchema = z.enum([
  "invalid_email",
  "account_email_unverified",
  "limited",
  "unavailable",
  "delivery_failed",
  "invalid_token",
  "expired_token",
  "owner_changed",
  "signed_out",
]);
export type RecipientFailure = z.infer<typeof recipientFailureSchema>;
export class RecipientError extends Error {
  constructor(
    readonly code: RecipientFailure,
    // The current recipient, when the server returned it with the error.
    readonly status: RecipientStatus | null = null,
  ) {
    super(code);
  }
}

async function call(
  ownerId: string,
  path: "" | "/account" | "/verify",
  body?: unknown,
  send: typeof fetch = fetch,
): Promise<RecipientStatus> {
  let response: Response;
  try {
    response = await send(`/api/owner/contact/recipient${path}`, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "X-Expected-Owner-Id": ownerId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new RecipientError("unavailable");
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return statusSchema.parse(json);
  if (response.status === 401) throw new RecipientError("signed_out");
  const error = z.object({ error: z.string() }).safeParse(json);
  const code = recipientFailureSchema.safeParse(
    error.success ? error.data.error : "",
  );
  const status = statusSchema.safeParse(json);
  throw new RecipientError(
    code.success ? code.data : "unavailable",
    status.success ? status.data : null,
  );
}

export const readRecipient = (ownerId: string, send?: typeof fetch) =>
  call(ownerId, "", undefined, send);
export const chooseAccountRecipient = (ownerId: string, send?: typeof fetch) =>
  call(ownerId, "/account", {}, send);
export const requestRecipient = (
  ownerId: string,
  email: string,
  send?: typeof fetch,
) => call(ownerId, "", { email }, send);
export const verifyRecipient = (
  ownerId: string,
  token: string,
  send?: typeof fetch,
) => call(ownerId, "/verify", { token }, send);

/** The token from a verification link's fragment, or null. */
export function verificationToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export const recipientMessages: Record<RecipientFailure, string> = {
  invalid_email: "Enter a valid email address.",
  account_email_unverified:
    "Your sign-in provider has not verified your account email. Enter an address to confirm instead.",
  limited: "Too many confirmation emails were sent today. Try again tomorrow.",
  unavailable: "Email isn't available right now. Try again later.",
  delivery_failed:
    "The confirmation email couldn't be sent. Check the address and try again.",
  invalid_token:
    "This link doesn't match a pending address for this account. Make sure you're signed in to the account that requested it, or send a new link.",
  expired_token: "This link has expired. Send a new link from the editor.",
  owner_changed:
    "You're signed in to a different account now. Reload to continue.",
  signed_out: "Sign in to continue.",
};
