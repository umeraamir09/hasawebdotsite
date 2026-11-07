import type { DraftDoc } from "@hasaweb/schema";

// Pure draft transforms for the optional avatar decoration and Face Reveal.
// Each returns a new draft and leaves the input untouched.

/** Selects a catalog decoration, or removes the selection when `id` is null. */
export function withDecoration(draft: DraftDoc, id: string | null): DraftDoc {
  const profile = { ...draft.profile };
  // Removal omits the key. A null or empty ID would fail the draft schema and
  // publication catalog validation.
  if (id === null) delete profile.decorationId;
  else profile.decorationId = id;
  return { ...draft, profile };
}

/** Turns Face Reveal on or off. A ready second photo is kept either way. */
export function withFaceRevealEnabled(
  draft: DraftDoc,
  enabled: boolean,
): DraftDoc {
  return {
    ...draft,
    profile: {
      ...draft.profile,
      faceReveal: { ...draft.profile.faceReveal, enabled },
    },
  };
}

/** Removes the second photo; the enabled setting is unchanged. */
export function withoutFaceImage(draft: DraftDoc): DraftDoc {
  const faceReveal = { ...draft.profile.faceReveal };
  delete faceReveal.image;
  return { ...draft, profile: { ...draft.profile, faceReveal } };
}

/** True when the owner has turned Face Reveal on without a second photo. */
export function faceRevealIncomplete(draft: DraftDoc): boolean {
  const { enabled, image } = draft.profile.faceReveal;
  return enabled && !image;
}
