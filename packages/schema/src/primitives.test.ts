import { describe, expect, it } from "vitest";
import { emailSchema, isSafeLink, isWebUrl, utf8Within } from "./primitives";
import { validateDraftValue } from "./updates";

describe("approved URL and email byte limits", () => {
  it("accepts exactly 2,048 URL bytes and rejects one more", () => {
    const prefix = "https://example.test/";
    const url = prefix + "x".repeat(2048 - prefix.length);
    expect(isWebUrl(url)).toBe(true);
    expect(isWebUrl(`${url}x`)).toBe(false);
    const unicode = `${prefix}${"é".repeat(Math.floor((2048 - prefix.length) / 2))}x`;
    expect(isWebUrl(unicode)).toBe(true);
    expect(isWebUrl(`${unicode}x`)).toBe(false);
  });
  it("accepts a 254-byte email and rejects 255 bytes in both link forms", () => {
    const email = `${"a".repeat(242)}@example.com`;
    expect(email.length).toBe(254);
    expect(emailSchema.safeParse(email).success).toBe(true);
    expect(emailSchema.safeParse(`a${email}`).success).toBe(false);
    expect(isSafeLink(`mailto:${email}`)).toBe(true);
    expect(isSafeLink(`mailto:a${email}`)).toBe(false);
    expect(utf8Within("é".repeat(127), 254)).toBe(true);
    expect(utf8Within(`${"é".repeat(127)}x`, 254)).toBe(false);
  });
  it("fits the maximum escaped URL in a bounded replacement", () => {
    const prefix = "https://example.test/";
    const url = prefix + '"'.repeat(2048 - prefix.length);
    expect(isWebUrl(url)).toBe(true);
    expect(
      validateDraftValue(
        ["components", 0, "data", "entries", 0, "demoUrl"],
        { '$."components"[0]': "projects" },
        url,
      ),
    ).toBe(JSON.stringify(url));
  });
});
