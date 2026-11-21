import { requestedSubdomainSchema } from "@hasaweb/schema";

// Phase 50. A name typed on the entry page travels through sign-in in this
// tab's sessionStorage (the provider round trip returns to the same tab and
// origin) and prefills the setup guide's Address field once. It is only a
// suggestion: nothing checks or reserves it until the owner continues.
const KEY = "hasaweb-address-suggestion-v1";
const SUFFIX = ".hasaweb.site";

/** The address name in `raw`, or null when it is not a valid name. */
export function normalizeAddressSuggestion(raw: string): string | null {
  let name = raw.trim().toLowerCase();
  if (name.endsWith(SUFFIX)) name = name.slice(0, -SUFFIX.length);
  const parsed = requestedSubdomainSchema.safeParse(name);
  return parsed.success ? parsed.data : null;
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage can be disabled; the owner then types the name in setup.
    return null;
  }
}

export function storeAddressSuggestion(name: string, storage = session()) {
  try {
    storage?.setItem(KEY, name);
  } catch {
    // A full or blocked store only loses the convenience.
  }
}

/** Reads and removes the suggestion, so it prefills at most once. */
export function takeAddressSuggestion(storage = session()): string | null {
  try {
    const value = storage?.getItem(KEY) ?? null;
    storage?.removeItem(KEY);
    return value === null ? null : normalizeAddressSuggestion(value);
  } catch {
    return null;
  }
}
