import { emailSchema } from "@hasaweb/schema";

export async function profileSuggestions({
  ownerId,
  portfolioId,
  signal,
}: {
  ownerId: string;
  portfolioId: string;
  signal: AbortSignal;
}): Promise<{ name: string; photoAvailable: boolean }> {
  const response = await fetch("/api/owner?include=profile-suggestions", {
    headers: { "X-Expected-Owner-Id": ownerId },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Suggestion unavailable");
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("user" in result) ||
    !result.user ||
    typeof result.user !== "object" ||
    !("id" in result.user) ||
    result.user.id !== ownerId ||
    !("portfolio" in result) ||
    !result.portfolio ||
    typeof result.portfolio !== "object" ||
    !("id" in result.portfolio) ||
    result.portfolio.id !== portfolioId ||
    !("profileSuggestions" in result) ||
    !result.profileSuggestions ||
    typeof result.profileSuggestions !== "object" ||
    !("name" in result.profileSuggestions) ||
    typeof result.profileSuggestions.name !== "string" ||
    !("photoAvailable" in result.profileSuggestions) ||
    typeof result.profileSuggestions.photoAvailable !== "boolean"
  )
    throw new Error("Suggestion identity changed");
  return {
    name: result.profileSuggestions.name,
    photoAvailable: result.profileSuggestions.photoAvailable,
  };
}

// The account email the owner may choose to show as a public link.
export async function accountEmailSuggestion({
  ownerId,
  portfolioId,
  signal,
}: {
  ownerId: string;
  portfolioId: string;
  signal: AbortSignal;
}): Promise<string> {
  const response = await fetch("/api/owner?include=email-suggestion", {
    cache: "no-store",
    headers: { "X-Expected-Owner-Id": ownerId },
    signal,
  });
  if (!response.ok) throw new Error("Suggestion unavailable");
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("emailSuggestion" in result) ||
    !("user" in result) ||
    !result.user ||
    typeof result.user !== "object" ||
    !("id" in result.user) ||
    result.user.id !== ownerId ||
    !("portfolio" in result) ||
    !result.portfolio ||
    typeof result.portfolio !== "object" ||
    !("id" in result.portfolio) ||
    result.portfolio.id !== portfolioId
  )
    throw new Error("Suggestion identity changed");
  const email = emailSchema.safeParse(result.emailSuggestion);
  if (!email.success) throw new Error("No email suggestion");
  return email.data;
}
