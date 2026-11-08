import { Portfolio, projectPortfolio } from "@hasaweb/components";
import { createComponent, createEmptyDraft } from "@hasaweb/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderFragment } from "./index";

const options = {
  assetOrigins: ["https://assets.example"],
  resolveAsset: () => ({ state: "unavailable" as const }),
};
function draftWithGraph(username = "Fixture-Owner", includePrivate = false) {
  const draft = createEmptyDraft({
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  });
  const github = createComponent("github", "graph");
  github.data = { username, includePrivate };
  draft.components = [github];
  return draft;
}
const days = [
  { date: "2026-11-01", count: 0 },
  { date: "2026-11-02", count: 6 },
  { date: "2026-11-03", count: 1 },
];
const html = (model: ReturnType<typeof projectPortfolio>) =>
  renderToStaticMarkup(<Portfolio model={model} />);
const preview = {
  username: "fixture-owner",
  fetchedAt: "2026-11-04T01:00:00Z",
  days,
};

describe("GitHub graph display", () => {
  it("is unavailable by default and for a different username", () => {
    for (const graph of [
      undefined,
      null,
      { ...preview, username: "someone-else" },
    ]) {
      const markup = html(
        projectPortfolio(draftWithGraph(), { ...options, graph }),
      );
      expect(markup).toContain('data-state="unavailable"');
      expect(markup).toContain("Contribution graph unavailable.");
      expect(markup).not.toContain("pf-graph-day");
    }
  });
  it("draws preview data matching the draft username without case sensitivity", () => {
    const markup = html(
      projectPortfolio(draftWithGraph(), { ...options, graph: preview }),
    );
    expect(markup).toContain('data-state="ready"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'aria-label="7 contributions from 2026-11-01 to 2026-11-03"',
    );
    expect(markup).toContain('title="6 contributions on 2026-11-02"');
    expect(markup).toContain("Updated 2026-11-04");
    expect(markup).toContain('href="https://github.com/Fixture-Owner"');
    expect(markup).not.toContain("data-graph-source");
  });
  it("shows a zero-contribution graph as ready", () => {
    const zero = {
      ...preview,
      days: days.map((day) => ({ ...day, count: 0 })),
    };
    const markup = html(
      projectPortfolio(draftWithGraph(), { ...options, graph: zero }),
    );
    expect(markup).toContain('data-state="ready"');
    expect(markup).toContain("0 contributions from");
  });
  it("renders the published placeholder with only the graph endpoint source", () => {
    const markup = html(
      projectPortfolio(draftWithGraph(), { ...options, graph: "live" }),
    );
    expect(markup).toContain('class="pf-graph"');
    expect(markup).toContain('data-graph-source="/_/github.json"');
    expect(markup).toContain('data-state="loading"');
    expect(markup).not.toContain("pf-graph-day");
    expect(markup).toContain("Loading contribution graph.");
  });
  it("matches the bounded publication frame for the placeholder", () => {
    const frame = (side: "open" | "close") =>
      renderFragment({ kind: "frame", frame: { name: "graph" }, side });
    const open = frame("open");
    const close = frame("close");
    expect(open.status).toBe("ready");
    expect(close.status).toBe("ready");
    const fragment =
      open.status === "ready" && close.status === "ready"
        ? `${open.html}<p class="pf-muted">Loading contribution graph.</p>${close.html}`
        : "";
    const markup = html(
      projectPortfolio(draftWithGraph(), { ...options, graph: "live" }),
    );
    expect(markup).toContain(fragment);
  });
  it("never carries the private choice, draft grant or untrusted days into the model", () => {
    const model = projectPortfolio(draftWithGraph("fixture-owner", true), {
      ...options,
      graph: { ...preview, days: [{ date: "2026-02-30", count: 4 }] },
    });
    const json = JSON.stringify(model);
    expect(json).not.toContain("includePrivate");
    expect(model.components[0]).toMatchObject({
      type: "github",
      data: { graph: { state: "unavailable" } },
    });
  });
});
