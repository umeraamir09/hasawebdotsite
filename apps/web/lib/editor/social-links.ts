import {
  type DraftDoc,
  draftSchema,
  emailSchema,
  type SocialLink,
  webUrlSchema,
} from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import type { DraftState } from "../draft/types";
import { moveById } from "./components";
import { readEditorField } from "./fields";

export function validLinkDestination(kind: string, value: string): boolean {
  return (kind === "email" ? emailSchema : webUrlSchema).safeParse(value)
    .success;
}

export function hasQualifyingProfileLink(
  draft: Pick<DraftDoc, "links">,
): boolean {
  return draft.links.some(
    (link) =>
      link.showInProfile &&
      link.label.trim().length > 0 &&
      validLinkDestination(link.kind, link.value),
  );
}

export function readSocialPlacement(
  state: DraftState,
  link: SocialLink,
  placement: "showInProfile" | "showInSocialComponent",
): boolean {
  const input =
    state.inputs[JSON.stringify(["links", { id: link.id }, placement])];
  return typeof input?.value === "boolean" ? input.value : link[placement];
}

export function addSocialLink(
  controller: DraftController,
  email?: string,
): string | null {
  const draft = controller.store.getState().working;
  if (!draft) return null;
  const existing = email
    ? draft.links.find((link) => link.kind === "email" && link.value === email)
    : undefined;
  if (existing) {
    controller.edit(["links", { id: existing.id }, "showInProfile"], true);
    return existing.id;
  }
  const link: SocialLink = {
    id: crypto.randomUUID(),
    label: email ? "Email" : "",
    kind: email ? "email" : "website",
    value: email ?? "",
    showInProfile: true,
    showInSocialComponent: false,
  };
  const next = draftSchema.safeParse({
    ...draft,
    links: [...draft.links, link],
  });
  if (!next.success) return null;
  controller.update(next.data);
  return link.id;
}

export function editSocialDestination(
  controller: DraftController,
  id: string,
  field: "kind" | "value",
  value: string,
): boolean {
  const state = controller.store.getState();
  const draft = state.working;
  const link = draft?.links.find((item) => item.id === id);
  if (!draft || !link) return false;
  const kindPath = ["links", { id }, "kind"];
  const valuePath = ["links", { id }, "value"];
  const kind = field === "kind" ? value : readEditorField(state, kindPath);
  const destination =
    field === "value" ? value : readEditorField(state, valuePath);
  const next = draftSchema.safeParse({
    ...draft,
    links: draft.links.map((item) =>
      item.id === id ? { ...item, kind, value: destination } : item,
    ),
  });
  if (!next.success) {
    controller.setInput(kindPath, kind);
    controller.setInput(valuePath, destination);
    return false;
  }
  controller.update(next.data);
  controller.clearInput(kindPath);
  controller.clearInput(valuePath);
  return true;
}

export function moveSocialLink(
  controller: DraftController,
  id: string,
  offset: -1 | 1,
) {
  const draft = controller.store.getState().working;
  if (!draft) return;
  const index = draft.links.findIndex((link) => link.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= draft.links.length) return;
  const links = [...draft.links];
  const [entry] = links.splice(index, 1);
  if (!entry) return;
  links.splice(target, 0, entry);
  controller.update({ ...draft, links });
}

export function removeSocialLink(controller: DraftController, id: string) {
  const draft = controller.store.getState().working;
  if (!draft) return;
  controller.update({
    ...draft,
    links: draft.links.filter((link) => link.id !== id),
  });
  for (const input of Object.values(controller.store.getState().inputs)) {
    const [root, selector] = input.path;
    if (root === "links" && typeof selector === "object" && selector.id === id)
      controller.clearInput(input.path);
  }
}

export type LinkPlacement = "showInProfile" | "showInSocialComponent";
export type PastedLink = Pick<SocialLink, "kind" | "value" | "label">;

// Known profile hosts. Any other address is a website.
const platforms: readonly (readonly [
  kind: string,
  label: string,
  hosts: readonly string[],
])[] = [
  ["github", "GitHub", ["github.com"]],
  ["linkedin", "LinkedIn", ["linkedin.com"]],
  ["bluesky", "Bluesky", ["bsky.app"]],
  ["x", "X", ["x.com", "twitter.com"]],
];

export function defaultLinkLabel(kind: string): string {
  if (kind === "email") return "Email";
  return platforms.find(([id]) => id === kind)?.[1] ?? "Website";
}

// Reads a pasted address: an email (with or without mailto:) or a web
// address, where a missing https:// is added. Returns null for anything else.
export function linkFromText(text: string): PastedLink | null {
  const raw = text.trim().replace(/^mailto:/i, "");
  if (emailSchema.safeParse(raw).success)
    return { kind: "email", value: raw, label: "Email" };
  const scheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
  const value = scheme ? raw : `https://${raw}`;
  if (!webUrlSchema.safeParse(value).success) return null;
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  if (!scheme && !host.includes(".")) return null;
  const platform = platforms.find(([, , hosts]) =>
    hosts.some((item) => host === item || host.endsWith(`.${item}`)),
  );
  const kind = platform?.[0] ?? "website";
  return { kind, value, label: defaultLinkLabel(kind) };
}

// The destination as a row shows it: the address without its scheme, www.
// or a trailing slash.
export function linkDisplay(kind: string, value: string): string {
  if (kind === "email") return value;
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

// Adds a link shown in one placement. A link already in the draft with the
// same destination is shown there instead of being added twice. Returns the
// link's id, or null when the draft cannot fit it.
export function addLinkTo(
  controller: DraftController,
  pasted: PastedLink,
  placement: LinkPlacement,
): string | null {
  const draft = controller.store.getState().working;
  if (!draft) return null;
  const existing = draft.links.find(
    (link) => link.kind === pasted.kind && link.value === pasted.value,
  );
  if (existing) {
    if (!existing[placement])
      controller.edit(["links", { id: existing.id }, placement], true);
    return existing.id;
  }
  const link: SocialLink = {
    id: crypto.randomUUID(),
    ...pasted,
    showInProfile: placement === "showInProfile",
    showInSocialComponent: placement === "showInSocialComponent",
  };
  const next = draftSchema.safeParse({
    ...draft,
    links: [...draft.links, link],
  });
  if (!next.success) return null;
  controller.update(next.data);
  return link.id;
}

// Edits a link's destination. A recognised address also sets the link's
// kind, and a label still at the old kind's default follows the new kind.
// With `complete`, a web address without https:// gets it (on blur).
export function editLinkDestination(
  controller: DraftController,
  id: string,
  text: string,
  { complete = false }: { complete?: boolean } = {},
): boolean {
  const state = controller.store.getState();
  const draft = state.working;
  const link = draft?.links.find((item) => item.id === id);
  if (!draft || !link) return false;
  const kindPath = ["links", { id }, "kind"];
  const valuePath = ["links", { id }, "value"];
  const detected = linkFromText(text);
  const exact = detected && (complete || detected.value === text.trim());
  const kind = exact ? detected.kind : readEditorField(state, kindPath);
  const value = exact ? detected.value : text;
  const label =
    exact && link.label === defaultLinkLabel(link.kind)
      ? detected.label
      : link.label;
  const next = draftSchema.safeParse({
    ...draft,
    links: draft.links.map((item) =>
      item.id === id ? { ...item, kind, value, label } : item,
    ),
  });
  if (!next.success) {
    controller.setInput(kindPath, kind);
    controller.setInput(valuePath, value);
    return false;
  }
  controller.update(next.data);
  controller.clearInput(kindPath);
  controller.clearInput(valuePath);
  return true;
}

export function moveSocialLinkTo(
  controller: DraftController,
  id: string,
  targetId: string,
) {
  const draft = controller.store.getState().working;
  if (!draft) return;
  controller.update({ ...draft, links: moveById(draft.links, id, targetId) });
}
