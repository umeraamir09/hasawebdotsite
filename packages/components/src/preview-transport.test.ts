import { DRAFT_MAX_BYTES, draftSchema, URL_MAX_BYTES } from "@hasaweb/schema";
import { expect, it } from "vitest";
import { completeDraft } from "../../schema/src/fixtures.test-support";
import {
  PREVIEW_MAX_BYTES,
  parsePortfolioModel,
  projectPortfolio,
  projectPortfolioCancellable,
} from "./model";
import { encodePreview, PREVIEW_CHUNK_BYTES } from "./preview-transport";

const unavailable = {
  assetOrigins: [],
  resolveAsset: () => ({ state: "unavailable" as const }),
};

it("encodes normalized Unicode and escaped strings in bounded chunks", async () => {
  const draft = completeDraft();
  draft.profile.bio = `${"x".repeat(4095)}\r\n${"x".repeat(4095)}👋\u0000\uD800`;
  const signal = new AbortController().signal;
  const model = await projectPortfolioCancellable(draft, unavailable, signal);
  const chunks = await encodePreview(model, signal);
  expect(chunks.every((chunk) => chunk.byteLength <= PREVIEW_CHUNK_BYTES)).toBe(
    true,
  );
  const bytes = new Uint8Array(
    chunks.reduce((n, chunk) => n + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(
    projectPortfolio(draft, unavailable),
  );
});
it("retains exact-limit long strings and a dense projected model above the old node limit", async () => {
  const draft = completeDraft();
  draft.profile.bio = "";
  draft.profile.bio = "x".repeat(
    DRAFT_MAX_BYTES -
      new TextEncoder().encode(JSON.stringify(draft)).byteLength,
  );
  expect(draftSchema.safeParse(draft).success).toBe(true);
  const model = projectPortfolio(draft, unavailable);
  expect(parsePortfolioModel(model)?.profile.bio).toHaveLength(
    draft.profile.bio.length,
  );
  const projects = draft.components.find(
    (component) => component.type === "projects",
  );
  if (projects?.type !== "projects")
    throw new Error("Projects fixture missing");
  draft.profile.bio = "";
  projects.data.entries = Array.from({ length: 3100 }, (_, i) => ({
    id: `p${i}`,
    title: "",
    summary: "",
    technologies: Array.from({ length: 80 }, () => ""),
    contribution: "",
  }));
  expect(draftSchema.safeParse(draft).success).toBe(true);
  const projected = projectPortfolio(draft, unavailable);
  expect(parsePortfolioModel(projected)).toBeDefined();
  const chunks = await encodePreview(projected, new AbortController().signal);
  expect(chunks.reduce((n, chunk) => n + chunk.byteLength, 0)).toBeLessThan(
    PREVIEW_MAX_BYTES,
  );
}, 30_000);
it("cancels preparation during an oversized text value and dense rows", async () => {
  const draft = completeDraft();
  draft.profile.bio = "x".repeat(1_000_000);
  const model = projectPortfolio(draft, unavailable);
  const abort = new AbortController();
  const encoded = encodePreview(model, abort.signal);
  setTimeout(() => abort.abort(), 0);
  await expect(encoded).rejects.toThrow();
  const skills = draft.components.find(
    (component) => component.type === "skills",
  );
  if (skills?.type !== "skills") throw new Error("Skills fixture missing");
  skills.data.entries = Array.from({ length: 12000 }, (_, i) => ({
    id: `s${i}`,
    name: "",
  }));
  const projectionAbort = new AbortController();
  const projected = projectPortfolioCancellable(
    draft,
    unavailable,
    projectionAbort.signal,
  );
  setTimeout(() => projectionAbort.abort(), 0);
  await expect(projected).rejects.toThrow();
});
it("does not expand unresolved, foreign-purpose or oversized asset URLs", () => {
  const draft = completeDraft();
  const model = projectPortfolio(draft, {
    assetOrigins: ["https://assets.example"],
    resolveAsset: ({ purpose }) =>
      purpose === "avatar"
        ? {
            state: "ready",
            url: `https://assets.example/${"x".repeat(URL_MAX_BYTES)}`,
          }
        : { state: "unavailable" },
  });
  expect(model.profile.avatar.state).toBe("unavailable");
  expect(model.profile.banner.state).toBe("unavailable");
});

it("fits asset-heavy drafts using the existing full URL limit and escaped URL bytes", async () => {
  const draft = completeDraft();
  const projects = draft.components.find(
    (component) => component.type === "projects",
  );
  if (projects?.type !== "projects")
    throw new Error("Projects fixture missing");
  const minimal = {
    id: "a",
    title: "",
    summary: "",
    technologies: [],
    contribution: "",
    image: { assetId: "a" },
  };
  expect(new TextEncoder().encode(JSON.stringify(minimal)).byteLength).toBe(94);
  projects.data.entries = Array.from({ length: 5000 }, (_, index) => ({
    ...minimal,
    id: `p${index}`,
    technologies: [],
  }));
  draft.profile.bio = "";
  draft.profile.bio = "x".repeat(
    DRAFT_MAX_BYTES -
      new TextEncoder().encode(JSON.stringify(draft)).byteLength,
  );
  expect(draftSchema.safeParse(draft).success).toBe(true);
  const prefix = "https://assets.example/";
  const url = prefix + '"'.repeat(URL_MAX_BYTES - prefix.length);
  const model = projectPortfolio(draft, {
    assetOrigins: ["https://assets.example"],
    resolveAsset: ({ assetId, purpose }) =>
      purpose === "project" && assetId === "a"
        ? { state: "ready", url }
        : { state: "unavailable" },
  });
  const projectedProjects = model.components.find(
    (component) => component.type === "projects",
  );
  if (projectedProjects?.type !== "projects")
    throw new Error("Projects projection missing");
  expect(projectedProjects.data.entries[0]?.image).toMatchObject({
    state: "ready",
    url,
  });
  expect(parsePortfolioModel(model)).toBeDefined();
  const chunks = await encodePreview(model, new AbortController().signal);
  expect(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  ).toBeLessThan(PREVIEW_MAX_BYTES);
}, 30_000);
