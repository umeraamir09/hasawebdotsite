import type { DraftDoc } from "@hasaweb/schema";

export function missingProfileFields(draft: DraftDoc): string[] {
  return [
    ...(!draft.profile.name.trim() || draft.samples["profile.name"]
      ? ["name"]
      : []),
    ...(!draft.profile.bio.trim() || draft.samples["profile.bio"]
      ? ["bio"]
      : []),
    ...(!draft.profile.avatar?.accepted || draft.samples["profile.avatar"]
      ? ["avatar"]
      : []),
    ...(!draft.profile.banner || draft.samples["profile.banner"]
      ? ["banner"]
      : []),
  ];
}
