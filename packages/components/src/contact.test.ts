import { describe, expect, it } from "vitest";
import { CONTACT_LIMITS, checkContactFields, FIELD_MESSAGES } from "./contact";

const valid = {
  name: "Ada Visitor",
  email: "ada@example.com",
  message: "Hello there.\nLine two.",
};

describe("contact form fields", () => {
  it("accepts complete fields and trims them", () => {
    expect(
      checkContactFields({
        name: "  Ada Visitor ",
        email: " ada@example.com ",
        message: "\nHello there.\nLine two.  ",
      }),
    ).toEqual({ values: valid, errors: {} });
  });
  it("reports each empty field", () => {
    expect(
      checkContactFields({ name: " ", email: "", message: "\n\t" }).errors,
    ).toEqual({ name: "required", email: "required", message: "required" });
  });
  it("rejects malformed and header-unsafe addresses", () => {
    for (const email of [
      "not an email",
      "a@b",
      "a@@b.com",
      "a@b.com,c@d.com",
      "a@b.com\nBcc: c@d.com",
      "<a@b.com>",
      "Ada <a@b.com>",
    ])
      expect(checkContactFields({ ...valid, email }).errors).toEqual({
        email: "invalid",
      });
  });
  it("enforces length limits by characters, and bytes for the address", () => {
    expect(
      checkContactFields({
        ...valid,
        name: "é".repeat(CONTACT_LIMITS.name),
        message: "😀".repeat(CONTACT_LIMITS.message),
      }).errors,
    ).toEqual({});
    expect(
      checkContactFields({
        name: "a".repeat(CONTACT_LIMITS.name + 1),
        email: `${"é".repeat(124)}@example.com`,
        message: "a".repeat(CONTACT_LIMITS.message + 1),
      }).errors,
    ).toEqual({ name: "too_long", email: "too_long", message: "too_long" });
  });
  it("keeps line breaks in messages but not control characters", () => {
    expect(
      checkContactFields({ ...valid, message: "a\u0000b" }).errors,
    ).toEqual({ message: "invalid" });
    expect(checkContactFields({ ...valid, name: "Ada\nBcc" }).errors).toEqual({
      name: "invalid",
    });
  });
  it("has a message for every field error", () => {
    for (const messages of Object.values(FIELD_MESSAGES))
      for (const text of Object.values(messages)) expect(text).toMatch(/\.$/);
  });
});
