import { collectDraftAssetReferences, markSample } from "@hasaweb/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeDraft } from "../../../../packages/schema/src/fixtures.test-support";
import { resolvePreviewImages } from "./browser";

const uuid = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function images() {
  const draft = completeDraft();
  for (const [index, reference] of collectDraftAssetReferences(
    draft,
  ).entries()) {
    let at: unknown = draft;
    for (const part of reference.path.slice(0, -1)) {
      if (at === null || typeof at !== "object" || !(part in at))
        throw new Error("Missing fixture reference");
      at = Reflect.get(at, part);
    }
    if (at === null || typeof at !== "object")
      throw new Error("Missing fixture image");
    Reflect.set(at, reference.path.at(-1) ?? "assetId", uuid(index + 1));
  }
  return draft;
}

afterEach(() => vi.unstubAllGlobals());
describe("private preview image preparation", () => {
  it("reads only the exact images requested by the shared display projection", async () => {
    const draft = images();
    const projects = draft.components.find(
      (component) => component.type === "projects",
    );
    if (!projects) throw new Error("Missing fixture projects");
    const sampled = markSample(
      markSample(draft, "profile.avatar"),
      `components.${projects.id}`,
    );
    const fetcher = vi.fn(
      async () =>
        new Response("pixels", { headers: { "Content-Type": "image/webp" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("location", new URL("https://hasaweb.site"));
    const options = await resolvePreviewImages({
      ownerId: "owner",
      draft: sampled,
      signal: new AbortController().signal,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      `/api/assets/${draft.profile.banner?.assetId}?purpose=banner`,
      expect.objectContaining({
        headers: { "X-Expected-Owner-Id": "owner" },
        cache: "no-store",
      }),
    ]);
    expect(
      options.resolveAsset({
        assetId: draft.profile.banner?.assetId ?? "",
        purpose: "banner",
      }).state,
    ).toBe("ready");
    expect(
      options.resolveAsset({
        assetId: draft.profile.avatar?.assetId ?? "",
        purpose: "avatar",
      }).state,
    ).toBe("unavailable");
    expect(
      options.resolveAsset({
        assetId: draft.profile.banner?.assetId ?? "",
        purpose: "avatar",
      }).state,
    ).toBe("unavailable");
  });
  it("limits concurrent reads and excludes case-study bodies, disabled photos and SEO images", async () => {
    const draft = images();
    const projects = draft.components.find(
      (component) => component.type === "projects",
    );
    const entry = projects?.data.entries[0];
    if (!projects || !entry) throw new Error("Missing fixture project");
    projects.data.entries = Array.from({ length: 10 }, (_, index) => ({
      ...structuredClone(entry),
      id: `project-${index}`,
      image: { assetId: uuid(index + 100), alt: "Project" },
    }));
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn(async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("location", new URL("https://hasaweb.site"));
    await resolvePreviewImages({
      ownerId: "owner",
      draft,
      signal: new AbortController().signal,
    });
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(maximum).toBeLessThanOrEqual(4);
  });
  it("cancels before issuing any asset request", async () => {
    const signal = AbortSignal.abort(new Error("superseded"));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      resolvePreviewImages({ ownerId: "owner", draft: images(), signal }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
