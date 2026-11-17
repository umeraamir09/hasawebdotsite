import { describe, expect, it } from "vitest";
import {
  RecipientError,
  readRecipient,
  requestRecipient,
  verificationToken,
} from "./contact-recipient";

const TOKEN = "a".repeat(43);
const status = {
  recipient: { email: "me@example.com", state: "pending" },
  accountEmail: null,
};

describe("contact recipient adapter", () => {
  it("names the expected owner on every request", async () => {
    const seen: RequestInit[] = [];
    await readRecipient("owner-a", async (_url, init) => {
      seen.push(init ?? {});
      return Response.json(status);
    });
    await requestRecipient("owner-a", "me@example.com", async (url, init) => {
      expect(url).toBe("/api/owner/contact/recipient");
      seen.push(init ?? {});
      return Response.json(status);
    });
    expect(
      seen.map((init) => new Headers(init.headers).get("X-Expected-Owner-Id")),
    ).toEqual(["owner-a", "owner-a"]);
    expect(seen[1]?.body).toBe('{"email":"me@example.com"}');
  });

  it("returns closed codes with the current status", async () => {
    const error = await requestRecipient("o", "x@example.com", async () =>
      Response.json({ error: "limited", ...status }, { status: 429 }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecipientError);
    expect(error).toMatchObject({ code: "limited", status });
    await expect(
      readRecipient("o", async () =>
        Response.json({ error: "?" }, { status: 500 }),
      ),
    ).rejects.toMatchObject({ code: "unavailable", status: null });
    await expect(
      readRecipient("o", async () => new Response(null, { status: 401 })),
    ).rejects.toMatchObject({ code: "signed_out" });
  });

  it("reads only a well-formed token from the fragment", () => {
    expect(verificationToken(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(verificationToken("#token=short")).toBeNull();
    expect(verificationToken("")).toBeNull();
  });
});
