import { describe, expect, it, vi } from "vitest";
import { disconnectSignInMethod, linkReturnNotice } from "./sign-in-methods";

describe("connected sign-in methods", () => {
  it("reads only the fixed link outcome and known error codes", () => {
    expect(linkReturnNotice("")).toBe(null);
    expect(linkReturnNotice("?github=consent")).toBe(null);
    expect(linkReturnNotice("?account=connected")?.kind).toBe("success");
    expect(
      linkReturnNotice("?account=not-connected&error=access_denied")?.text,
    ).toMatch(/cancelled\. Nothing changed/);
    expect(
      linkReturnNotice(
        "?account=not-connected&error=account_already_linked_to_different_user",
      )?.text,
    ).toMatch(/different hasaweb\.site account/);
    expect(
      linkReturnNotice("?account=not-connected&error=email_does_not_match")
        ?.text,
    ).toMatch(/different email address/);
    const reflected = linkReturnNotice(
      "?account=not-connected&error=%3Cb%3Eprovider%3C%2Fb%3E&error_description=secret",
    );
    expect(reflected?.kind).toBe("error");
    expect(reflected?.text).not.toMatch(/provider|secret/);
  });

  it("sends the expected owner and maps outcomes", async () => {
    const send = vi.fn(async () => Response.json({ ok: true }));
    expect(await disconnectSignInMethod("owner-1", "github", send)).toBe(
      "disconnected",
    );
    expect(send).toHaveBeenCalledWith(
      "/api/owner/providers/disconnect",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Expected-Owner-Id": "owner-1" }),
        body: JSON.stringify({ provider: "github" }),
      }),
    );
    for (const [status, body, result] of [
      [409, { error: "last_method" }, "last_method"],
      [409, { error: "not_connected" }, "not_connected"],
      [409, { error: "owner_changed" }, "owner_changed"],
      [409, { error: "conflict" }, "failed"],
      [401, null, "signed_out"],
      [503, null, "failed"],
    ] as const)
      expect(
        await disconnectSignInMethod("owner-1", "google", async () =>
          Response.json(body, { status }),
        ),
      ).toBe(result);
    expect(
      await disconnectSignInMethod("owner-1", "google", async () => {
        throw new TypeError("offline");
      }),
    ).toBe("failed");
  });
});
