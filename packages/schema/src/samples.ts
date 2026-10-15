import { type DraftDoc, draftSchema, type ProfileSampleField } from "./draft";
import { cloneJson } from "./json";

export const profileSampleKey = (field: ProfileSampleField): string =>
  `profile.${field}`;
export const componentSampleKey = (id: string): string => `components.${id}`;

export function markSample(draft: DraftDoc, key: string): DraftDoc {
  const next = cloneJson(draft);
  next.samples = { ...next.samples, [key]: true };
  return draftSchema.parse(next);
}

// Any edit within an optional sample clears the whole component marker, so its
// normal publication requirements apply. Removing it must clear its marker too.
export function clearSample(draft: DraftDoc, key: string): DraftDoc {
  const next = cloneJson(draft);
  delete next.samples[key];
  return draftSchema.parse(next);
}

export function isUntouchedSample(draft: DraftDoc, key: string): boolean {
  return Object.hasOwn(draft.samples, key);
}
