import {
  type DraftDoc,
  draftSchema,
  emailSchema,
  type SocialLink,
  webUrlSchema,
} from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import type { DraftState } from "../draft/types";
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
