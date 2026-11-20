import { z } from "zod";
import { type Provider, providerOrigins } from "./auth-client";

// Connected sign-in providers in the editor (Phase 47). Listing and
// disconnecting are owner routes; connecting starts the provider's OAuth flow
// through the auth handler with the fixed editor returns.

export const LINK_RETURN_PARAM = "account";
const methodsSchema = z.strictObject({
  providers: z.array(
    z.strictObject({
      provider: z.enum(["github", "google"]),
      connected: z.boolean(),
    }),
  ),
});
export type SignInMethod = z.infer<typeof methodsSchema>["providers"][number];

export async function readSignInMethods(
  send: typeof fetch = fetch,
): Promise<SignInMethod[]> {
  const response = await send("/api/owner/providers", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not read sign-in methods");
  return methodsSchema.parse(await response.json()).providers;
}

export type DisconnectResult =
  | "disconnected"
  | "last_method"
  | "not_connected"
  | "owner_changed"
  | "signed_out"
  | "failed";

export async function disconnectSignInMethod(
  ownerId: string,
  provider: Provider,
  send: typeof fetch = fetch,
): Promise<DisconnectResult> {
  let response: Response;
  try {
    response = await send("/api/owner/providers/disconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Expected-Owner-Id": ownerId,
      },
      body: JSON.stringify({ provider }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return "failed";
  }
  if (response.ok) return "disconnected";
  if (response.status === 401) return "signed_out";
  const body: unknown = await response.json().catch(() => null);
  const error =
    body && typeof body === "object" && "error" in body ? body.error : null;
  if (
    error === "last_method" ||
    error === "not_connected" ||
    error === "owner_changed"
  )
    return error;
  return "failed";
}

/** Starts the provider's OAuth flow; the provider returns to the editor. */
export async function connectSignInMethod(provider: Provider) {
  const origin = window.location.origin;
  const response = await fetch("/api/auth/link-social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      callbackURL: `${origin}/editor?${LINK_RETURN_PARAM}=connected`,
      errorCallbackURL: `${origin}/editor?${LINK_RETURN_PARAM}=not-connected`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Could not start connecting");
  const url = new URL(((await response.json()) as { url: string }).url);
  if (url.origin !== providerOrigins[provider])
    throw new Error("Invalid provider destination");
  window.location.assign(url.href);
}

/**
 * The notice for a link return. Only the fixed outcome and Better Auth's
 * error code are read; provider descriptions are never shown.
 */
export function linkReturnNotice(search: string) {
  const params = new URLSearchParams(search);
  const outcome = params.get(LINK_RETURN_PARAM);
  if (outcome === "connected")
    return {
      kind: "success" as const,
      text: "Sign-in method connected. You can now sign in with it.",
    };
  if (outcome !== "not-connected") return null;
  const error = params.get("error");
  const text =
    error === "access_denied"
      ? "Connecting was cancelled. Nothing changed."
      : error === "email_does_not_match"
        ? "That Google account uses a different email address. Connect the Google account that uses your hasaweb.site account's email."
        : error === "account_already_linked_to_different_user"
          ? "That account already signs in to a different hasaweb.site account, so it wasn't connected."
          : error === "unable_to_link_account" ||
              error === "email_not_verified" ||
              error === "email_not_found"
            ? "We couldn't connect that account. Check that its email address is verified with the provider, then try again."
            : "Connecting didn't finish. Nothing changed. Try again.";
  return { kind: "error" as const, text };
}
