export type Provider = "github" | "google";
export const providerNames = { github: "GitHub", google: "Google" } as const;
export type Owner = {
  user: { id: string; name: string };
  portfolio: { id: string } | null;
};

export async function readOwner(signal?: AbortSignal): Promise<Owner | null> {
  const response = await fetch("/api/owner", {
    cache: "no-store",
    signal: signal ?? null,
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Could not check your session");
  return response.json() as Promise<Owner>;
}
export async function startSignIn(provider: Provider) {
  const origin = window.location.origin;
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      callbackURL: `${origin}/editor`,
      errorCallbackURL: `${origin}/sign-in?provider=${provider}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Could not start sign-in");
  const data = (await response.json()) as { url: string };
  const url = new URL(data.url);
  const expected =
    provider === "github"
      ? "https://github.com"
      : "https://accounts.google.com";
  if (url.origin !== expected) throw new Error("Invalid sign-in destination");
  window.location.assign(url.href);
}
export function authErrorMessage(error: string | null) {
  if (!error) return null;
  if (["access_denied", "user_cancelled", "cancelled"].includes(error))
    return "Sign-in was cancelled. Choose a provider to try again.";
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
