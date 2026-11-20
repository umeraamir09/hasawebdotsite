import { expect, it, vi } from "vitest";
import type { DraftController } from "./controller";
import { PublishFailure, siteRequest } from "./publish";
import { DraftFailure } from "./types";

const controller = {
  identity: { ownerId: "owner-a", portfolioId: "portfolio-a" },
} as DraftController;
const site = {
  portfolioId: "portfolio-a",
  status: "unpublished",
  url: "https://owner.hasaweb.site",
  withdrawal: { retrying: false },
};

it("unpublishes only the expected owner's portfolio and returns its kept address", async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json(site));
  await expect(siteRequest(controller, "unpublish", send)).resolves.toEqual(
    site,
  );
  const [url, init] = send.mock.calls[0] ?? [];
  expect(url).toBe("/api/owner/publication/unpublish");
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("X-Expected-Owner-Id")).toBe("owner-a");
  expect(JSON.parse(String(init?.body))).toEqual({
    portfolioId: "portfolio-a",
  });
});

it("rejects another portfolio's state and unknown fields", async () => {
  await expect(
    siteRequest(controller, "site", async () =>
      Response.json({ ...site, portfolioId: "portfolio-b" }),
    ),
  ).rejects.toEqual(new DraftFailure("owner_changed"));
  await expect(
    siteRequest(controller, "site", async () =>
      Response.json({ ...site, draft: {} }),
    ),
  ).rejects.toThrow();
});

it("maps session, ownership and state failures to their codes", async () => {
  const reply = (status: number, body: unknown) => async () =>
    Response.json(body, { status });
  await expect(
    siteRequest(controller, "unpublish", reply(401, { error: "unauthorized" })),
  ).rejects.toMatchObject({ code: "unauthorized" });
  await expect(
    siteRequest(
      controller,
      "unpublish",
      reply(409, { error: "owner_changed" }),
    ),
  ).rejects.toBeInstanceOf(DraftFailure);
  const notPublished = siteRequest(
    controller,
    "unpublish",
    reply(409, { error: "not_published" }),
  );
  await expect(notPublished).rejects.toBeInstanceOf(PublishFailure);
  await expect(notPublished).rejects.toMatchObject({ code: "not_published" });
  await expect(
    siteRequest(controller, "unpublish", reply(503, null)),
  ).rejects.toMatchObject({ code: "publication_unavailable" });
});
