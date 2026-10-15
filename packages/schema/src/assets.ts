import type { DraftDoc } from "./draft";

export type AssetPurpose =
  | "avatar"
  | "banner"
  | "face"
  | "project"
  | "case_study"
  | "resume"
  | "og";
export interface DraftAssetReference {
  assetId: string;
  kind: AssetPurpose;
  path: (string | number)[];
}

// This collects all private draft references, including disabled Face Reveal
// photos and untouched samples. It is not a publication manifest. Publication
// must first omit samples and exclude the disabled photo, then check ownership,
// asset kind and ready status against the authoritative asset repository.
export function collectDraftAssetReferences(
  draft: DraftDoc,
): DraftAssetReference[] {
  const references: DraftAssetReference[] = [];
  function add(
    assetId: string | undefined,
    kind: AssetPurpose,
    path: (string | number)[],
  ) {
    if (assetId) references.push({ assetId, kind, path });
  }
  add(draft.profile.avatar?.assetId, "avatar", [
    "profile",
    "avatar",
    "assetId",
  ]);
  add(draft.profile.banner?.assetId, "banner", [
    "profile",
    "banner",
    "assetId",
  ]);
  add(draft.profile.faceReveal.image?.assetId, "face", [
    "profile",
    "faceReveal",
    "image",
    "assetId",
  ]);
  add(draft.seo.ogImage?.assetId, "og", ["seo", "ogImage", "assetId"]);
  draft.components.forEach((component, index) => {
    const base = ["components", index, "data"];
    if (component.type === "resume")
      add(component.data.file?.assetId, "resume", [...base, "file", "assetId"]);
    if (component.type !== "projects") return;
    component.data.entries.forEach((project, entryIndex) => {
      const entry = [...base, "entries", entryIndex];
      add(project.image?.assetId, "project", [...entry, "image", "assetId"]);
      project.caseStudy?.body.content.forEach((node, nodeIndex) => {
        if (node.type === "image")
          add(node.attrs.assetId, "case_study", [
            ...entry,
            "caseStudy",
            "body",
            "content",
            nodeIndex,
            "attrs",
            "assetId",
          ]);
      });
    });
  });
  return references;
}
