import {
  assignCaseStudySlug,
  type ComponentOf,
  caseStudyAddressesSchema,
  type DraftDoc,
  draftSchema,
  type PublishedCaseStudy,
  reconcileCaseStudySlugs,
} from "@hasaweb/schema";
import { z } from "zod";
import type { DraftController } from "../draft/controller";
import { DraftFailure } from "../draft/types";

type Project = ComponentOf<"projects">["data"]["entries"][number];

// Live case-study slugs are frozen by the last successful Publish. The server
// check rejects any draft that changes them, so the editor reads them first.
export async function readCaseStudyAddresses(
  controller: DraftController,
  send: typeof fetch = fetch,
): Promise<PublishedCaseStudy[]> {
  const response = await send("/api/owner/publication/case-studies", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Expected-Owner-Id": controller.identity.ownerId,
    },
    body: JSON.stringify({ portfolioId: controller.identity.portfolioId }),
    signal: AbortSignal.timeout(30000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401) throw new DraftFailure("unauthorized");
  const error = z.object({ error: z.string() }).safeParse(body);
  if (error.success && error.data.error === "owner_changed")
    throw new DraftFailure("owner_changed");
  if (!response.ok) throw new Error("Case-study addresses unavailable");
  const result = caseStudyAddressesSchema.parse(body);
  if (result.portfolioId !== controller.identity.portfolioId)
    throw new DraftFailure("owner_changed");
  return result.addresses;
}

function updateEntries(
  controller: DraftController,
  componentId: string,
  change: (entries: Project[]) => Project[] | null,
): boolean {
  const draft = controller.store.getState().working;
  const component = draft?.components.find((item) => item.id === componentId);
  if (!draft || component?.type !== "projects") return false;
  const entries = change(component.data.entries);
  if (!entries) return false;
  const samples = { ...draft.samples };
  delete samples[`components.${componentId}`];
  const next = draftSchema.safeParse({
    ...draft,
    samples,
    components: draft.components.map((item) =>
      item.id === componentId ? { ...component, data: { entries } } : item,
    ),
  } satisfies DraftDoc);
  if (!next.success) return false;
  controller.update(next.data);
  return true;
}

export function addCaseStudy(
  controller: DraftController,
  componentId: string,
  projectId: string,
  published: readonly PublishedCaseStudy[],
): boolean {
  return updateEntries(controller, componentId, (entries) => {
    const entry = entries.find((item) => item.id === projectId);
    if (!entry || entry.caseStudy) return null;
    const slug = assignCaseStudySlug(entry, entries, published);
    return entries.map((item) =>
      item.id === projectId
        ? { ...item, caseStudy: { slug, body: { type: "doc", content: [] } } }
        : item,
    );
  });
}

export function removeCaseStudy(
  controller: DraftController,
  componentId: string,
  projectId: string,
) {
  const removed = updateEntries(controller, componentId, (entries) =>
    entries.map((item) => {
      if (item.id !== projectId) return item;
      const { caseStudy: _caseStudy, ...rest } = item;
      return rest;
    }),
  );
  if (!removed) return false;
  for (const input of Object.values(controller.store.getState().inputs)) {
    const [root, section, , , entry, field] = input.path;
    if (
      root === "components" &&
      typeof section === "object" &&
      section.id === componentId &&
      typeof entry === "object" &&
      entry.id === projectId &&
      field === "caseStudy"
    )
      controller.clearInput(input.path);
  }
  return true;
}

// Regenerates an unfrozen slug after the project title changes. A frozen slug
// is returned unchanged, so title edits after first publication keep the URL.
export function syncCaseStudySlug(
  controller: DraftController,
  componentId: string,
  projectId: string,
  published: readonly PublishedCaseStudy[],
) {
  return updateEntries(controller, componentId, (entries) => {
    const entry = entries.find((item) => item.id === projectId);
    if (!entry?.caseStudy) return null;
    const slug = assignCaseStudySlug(entry, entries, published);
    if (slug === entry.caseStudy.slug) return null;
    return entries.map((item) =>
      item.id === projectId && item.caseStudy
        ? { ...item, caseStudy: { ...item.caseStudy, slug } }
        : item,
    );
  });
}

// Restores frozen slugs and moves any unfrozen slug off a still-live URL. This
// repairs drafts saved by a stale tab before the latest Publish.
export function reconcileCaseStudies(
  controller: DraftController,
  componentId: string,
  published: readonly PublishedCaseStudy[],
) {
  return updateEntries(controller, componentId, (entries) => {
    const slugs = reconcileCaseStudySlugs(entries, published);
    if (
      entries.every(
        (item) => !item.caseStudy || slugs.get(item.id) === item.caseStudy.slug,
      )
    )
      return null;
    return entries.map((item) => {
      const slug = slugs.get(item.id);
      return item.caseStudy && slug
        ? { ...item, caseStudy: { ...item.caseStudy, slug } }
        : item;
    });
  });
}
