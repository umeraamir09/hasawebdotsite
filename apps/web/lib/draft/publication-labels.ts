import {
  componentRegistry,
  type DraftDoc,
  type PublicationIssue,
} from "@hasaweb/schema";

// Owner-facing names for publication issues, shared by the editor checklist
// and the setup guide's Review.
export function publicationFieldLabel(
  issue: PublicationIssue,
  draft: DraftDoc | null,
) {
  const [root, index] = issue.path;
  const last = String(issue.path.at(-1));
  const fields: Record<string, string> = {
    name: "name",
    bio: "bio",
    avatar: "avatar",
    banner: "banner",
    label: "link label",
    value: "link destination",
    title: "title",
    summary: "summary",
    entries: "entries",
    categories: "categories",
    role: "role",
    organization: "organization",
    startDate: "start date",
    endDate: "end date",
    description: "description",
    body: "text",
    caseStudy: "case study",
    file: "resume PDF",
    recipientId: "contact recipient",
    username: "GitHub account",
    image: "image",
    assetId: "image",
  };
  if (root === "requestedSubdomain") return "portfolio address";
  if (root === "links")
    return issue.path.length === 1 ? "profile link" : (fields[last] ?? "link");
  if (root === "appearance") return last === "themeId" ? "theme" : "font";
  if (root === "seo")
    return issue.path[1] === "title"
      ? "page title"
      : issue.path[1] === "description"
        ? "sharing description"
        : "sharing image";
  if (root === "profile")
    return index === "decorationId"
      ? "avatar decoration"
      : index === "faceReveal"
        ? "Face Reveal image"
        : String(index);
  const component =
    root === "components" && typeof index === "number"
      ? draft?.components[index]
      : undefined;
  return component
    ? `${componentRegistry[component.type].picker.title.toLowerCase()} ${fields[last] ?? "details"}`
    : "section details";
}
export function publicationIssueLabel(
  issue: PublicationIssue,
  draft: DraftDoc | null,
) {
  const field = publicationFieldLabel(issue, draft);
  const message = {
    required: `Complete your ${field}`,
    address: "Reserve or restore your address",
    catalog: `Choose an approved ${field}`,
    asset: `Replace the unavailable ${field}`,
    github: "Connect your GitHub account",
    recipient: "Verify your contact recipient",
    case_study_url:
      "Reload the editor to restore this case study's published address",
  } satisfies Record<PublicationIssue["code"], string>;
  return message[issue.code];
}
