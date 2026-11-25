import { requestedSubdomainSchema } from "@hasaweb/schema";

// Address names offered as chips on the Address step, derived from the
// account name: the words joined, hyphenated, then the first and last word.
// Only names that pass the address rules are returned; the step still checks
// each one's availability before showing it.
export function addressCandidates(name: string, exclude = ""): string[] {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const candidates = [
    words.join(""),
    words.join("-"),
    words[0] ?? "",
    words.length > 1 ? (words.at(-1) ?? "") : "",
  ].map((candidate) => candidate.slice(0, 30).replace(/-+$/, ""));
  return [...new Set(candidates)].filter(
    (candidate) =>
      candidate !== exclude &&
      requestedSubdomainSchema.safeParse(candidate).success,
  );
}
