import { type AccountEntry, accountEntryResponseSchema } from "@hasaweb/schema";
export type Provider = "github" | "google";
export const providerNames = { github: "GitHub", google: "Google" } as const;
// Where sign-in and connecting may send the browser.
export const providerOrigins = {
  github: "https://github.com",
  google: "https://accounts.google.com",
} as const satisfies Record<Provider, string>;
export type Owner = {
  user: { id: string; name: string };
  portfolio: { id: string } | null;
};
export async function resolveAccountEntry(
  signal?: AbortSignal,
): Promise<(Owner & { entry: AccountEntry }) | null> {
  const response = await fetch("/api/owner/entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal: signal ?? null,
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Could not open your portfolio");
  const result: unknown = await response.json();
  return accountEntryResponseSchema.parse(result);
}

export async function readOwner(signal?: AbortSignal): Promise<Owner | null> {
  const response = await fetch("/api/owner", {
    cache: "no-store",
    signal: signal ?? null,
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Could not check your session");
  return response.json() as Promise<Owner>;
}
export async function startSignIn(
  provider: Provider,
  mode: "normal" | "draft-recovery" = "normal",
) {
  const origin = window.location.origin;
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      callbackURL: `${origin}${mode === "draft-recovery" ? "/auth/recovery" : "/auth/entry"}`,
      errorCallbackURL:
        mode === "draft-recovery"
          ? `${origin}/auth/recovery/error`
          : `${origin}/sign-in?provider=${provider}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Could not start sign-in");
  const data = (await response.json()) as { url: string };
  const url = new URL(data.url);
  if (url.origin !== providerOrigins[provider])
    throw new Error("Invalid sign-in destination");
  window.location.assign(url.href);
}
export function authErrorMessage(error: string | null) {
  if (!error) return null;
  if (["access_denied", "user_cancelled", "cancelled"].includes(error))
    return "Sign-in was cancelled. Choose a provider to try again.";
  // Only the account hook refuses a link at sign-in: most often a provider
  // the owner disconnected, which links again only through Connect.
  if (error === "unable_to_link_account")
    return "This sign-in method isn't connected to your account. Sign in another way, then connect it again in your editor's Sharing settings.";
  if (
    [
      "account_not_linked",
      "email_doesn't_match",
      "email_not_verified",
    ].includes(error)
  )
    return "We couldn't connect this provider to your account. Try your original provider and check that your email is verified.";
  if (
    [
      "email_not_found",
      "unable_to_get_user_info",
      "user_email_not_found",
    ].includes(error)
  )
    return "Your provider didn't share an email address. Check your provider's email settings, then try again.";
  return "Sign-in didn't finish. Choose a provider to try again.";
}

// Ends the session and leaves for sign-in. Local draft recovery is kept.
export async function signOutOwner() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Sign-out failed");
  window.location.replace("/sign-in");
}
