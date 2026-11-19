import { describe, expect, it } from "vitest";
import {
  DeliveryError,
  readDelivery,
  sendTestMessage,
} from "./contact-delivery";

const status = {
  delivering: 1,
  test: { state: "sent", acceptedAt: 1 },
  failures: [{ acceptedAt: 1, failedAt: 2, notice: "deferred" }],
};

describe("contact delivery adapter", () => {
  it("names the expected owner and posts an empty test command", async () => {
    const seen: [string, RequestInit][] = [];
    const send = async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push([String(url), init ?? {}]);
      return Response.json(
        String(url).endsWith("/test") ? { ...status, outcome: "sent" } : status,
      );
    };
    expect(await readDelivery("owner-a", send)).toEqual(status);
    expect((await sendTestMessage("owner-a", send)).outcome).toBe("sent");
    expect(seen.map(([url]) => url)).toEqual([
      "/api/owner/contact/delivery",
      "/api/owner/contact/delivery/test",
    ]);
    expect(
      seen.map(([, init]) =>
        new Headers(init.headers).get("X-Expected-Owner-Id"),
      ),
    ).toEqual(["owner-a", "owner-a"]);
    expect(seen[1]?.[1].method).toBe("POST");
    expect(seen[1]?.[1].body).toBe("{}");
  });

  it("reports closed error codes with the current status", async () => {
    const failure = await sendTestMessage("owner-a", async () =>
      Response.json({ error: "limited", ...status }, { status: 429 }),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DeliveryError);
    expect((failure as DeliveryError).code).toBe("limited");
    expect((failure as DeliveryError).status).toEqual(status);
    const unknown = await readDelivery("owner-a", async () =>
      Response.json({ error: "provider said something" }, { status: 500 }),
    ).catch((error: unknown) => error);
    expect((unknown as DeliveryError).code).toBe("unavailable");
    const signedOut = await readDelivery(
      "owner-a",
      async () => new Response(null, { status: 401 }),
    ).catch((error: unknown) => error);
    expect((signedOut as DeliveryError).code).toBe("signed_out");
  });

  it("rejects responses that carry message content", async () => {
    await expect(
      readDelivery("owner-a", async () =>
        Response.json({
          ...status,
          failures: [{ ...status.failures[0], message: "secret" }],
        }),
      ),
    ).rejects.toThrow();
  });
});
