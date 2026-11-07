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
  it("reuses successful resolutions for text edits and reads new asset IDs", async () => {
    const draft = images();
    const cache = new Map<string, string>();
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(null, {
          headers: {
            "Content-Type": url.endsWith("purpose=resume")
              ? "application/pdf"
              : "image/png",
          },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("location", new URL("https://hasaweb.site"));
    const prepare = () =>
      resolvePreviewImages({
        ownerId: "owner",
        draft,
        cache,
        signal: new AbortController().signal,
      });
    await prepare();
    const firstReads = fetcher.mock.calls.length;
    expect(firstReads).toBeGreaterThan(0);
    draft.profile.name = "Changed name";
    await prepare();
    expect(fetcher).toHaveBeenCalledTimes(firstReads);
    draft.profile.avatar = {
      assetId: uuid(999),
      alt: "Replacement",
      accepted: true,
    };
    const options = await prepare();
    expect(fetcher).toHaveBeenCalledTimes(firstReads + 1);
    expect(
      options.resolveAsset({ assetId: uuid(999), purpose: "avatar" }).state,
    ).toBe("ready");
    expect(
      options.resolveAsset({ assetId: uuid(999), purpose: "banner" }).state,
    ).toBe("unavailable");
    const removed = draft.profile.avatar.assetId;
    delete draft.profile.avatar;
    const withoutAvatar = await prepare();
    expect(fetcher).toHaveBeenCalledTimes(firstReads + 1);
    expect(
      withoutAvatar.resolveAsset({ assetId: removed, purpose: "avatar" }).state,
    ).toBe("unavailable");
    draft.profile.avatar = {
      assetId: removed,
      alt: "Restored",
      accepted: true,
    };
    await prepare();
    expect(fetcher).toHaveBeenCalledTimes(firstReads + 2);
  });
  it("retries failed resolutions rather than caching unavailability", async () => {
    const draft = images();
    const cache = new Map<string, string>();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("location", new URL("https://hasaweb.site"));
    const prepare = () =>
      resolvePreviewImages({
        ownerId: "owner",
        draft,
        cache,
        signal: new AbortController().signal,
      });
    await prepare();
    const failedReads = fetcher.mock.calls.length;
    fetcher.mockImplementation(
      async () =>
        new Response(null, { headers: { "Content-Type": "image/png" } }),
    );
    const options = await prepare();
    expect(fetcher).toHaveBeenCalledTimes(failedReads * 2);
    expect(
      options.resolveAsset({
        assetId: draft.profile.avatar?.assetId ?? "",
        purpose: "avatar",
      }).state,
    ).toBe("ready");
  });
  it("reads only the exact images requested by the shared display projection", async () => {
    const draft = images();
    const projects = draft.components.find(
      (component) => component.type === "projects",
    );
    if (!projects) throw new Error("Missing fixture projects");
    const resume = draft.components.find(
      (component) => component.type === "resume",
    );
    if (!resume) throw new Error("Missing fixture resume");
    const sampled = markSample(
      markSample(
        markSample(draft, "profile.avatar"),
        `components.${projects.id}`,
      ),
      `components.${resume.id}`,
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
    // Avatar, banner, ten project images and the resume PDF.
    expect(fetcher).toHaveBeenCalledTimes(13);
    expect(maximum).toBeLessThanOrEqual(4);
  });
  it("previews a resume only from a private PDF response", async () => {
    const draft = images();
    const resume = draft.components.find(
      (component) => component.type === "resume",
    );
    const assetId = resume?.type === "resume" ? resume.data.file?.assetId : "";
    if (!assetId) throw new Error("Missing fixture resume");
    vi.stubGlobal("location", new URL("https://hasaweb.site"));
    for (const [type, state] of [
      ["application/pdf", "ready"],
      ["image/png", "unavailable"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(null, { headers: { "Content-Type": type } }),
        ),
      );
      const options = await resolvePreviewImages({
        ownerId: "owner",
        draft,
        signal: new AbortController().signal,
      });
      expect(options.resolveAsset({ assetId, purpose: "resume" })).toEqual(
        state === "ready"
          ? {
              state,
              url: `https://hasaweb.site/api/assets/${assetId}?purpose=resume`,
              viewUrl: `https://hasaweb.site/api/assets/${assetId}/view?purpose=resume`,
            }
          : { state },
      );
    }
  });
  it("requests case-study images only for full-page previews", async () => {
    const draft = images();
    const requested: string[] = [];
    vi.stubGlobal("location", new URL("https://hasaweb.site"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        return new Response(null, { headers: { "Content-Type": "image/png" } });
      }),
    );
    await resolvePreviewImages({
      ownerId: "owner",
      draft,
      signal: new AbortController().signal,
    });
    expect(requested.filter((url) => url.includes("case_study"))).toEqual([]);
    requested.length = 0;
    const options = await resolvePreviewImages({
      ownerId: "owner",
      draft,
      signal: new AbortController().signal,
      caseStudies: true,
    });
    const urls = requested.filter((url) => url.includes("purpose=case_study"));
    expect(urls.length).toBeGreaterThan(0);
    const id = /assets\/([^?]+)/.exec(urls[0] ?? "")?.[1] ?? "";
    expect(
      options.resolveAsset({ assetId: id, purpose: "case_study" }),
    ).toEqual({
      state: "ready",
      url: `https://hasaweb.site/api/assets/${id}?purpose=case_study`,
    });
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
