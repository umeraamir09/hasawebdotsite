import { appearanceCatalog } from "@hasaweb/theme";
import { describe, expect, it } from "vitest";
import {
  type CatalogDecoration,
  decorationChoices,
  decorationName,
  galleryTools,
} from "./decorations";

const many: CatalogDecoration[] = [
  { id: "cat", name: "Ginger cat", category: "Animals" },
  { id: "hands", name: "Hands", category: "Gestures" },
  { id: "snow", name: "Snowfall", category: "Weather" },
  { id: "crown", name: "Flower crown", category: "Hats" },
  { id: "party", name: "Party hat", category: "Hats" },
  { id: "king", name: "Crown", category: "Hats" },
  { id: "halo", name: "Halo", category: "Accessories" },
  { id: "bunny", name: "Bunny ears", category: "Animals" },
  { id: "cloud", name: "Cloud" },
];

describe("decoration gallery", () => {
  it("shows None and every catalog entry without search or chips", () => {
    const entries = appearanceCatalog.decorations;
    expect(galleryTools(entries)).toEqual({ search: false, categories: [] });
    expect(decorationChoices(entries, {})).toEqual([
      { id: null, name: "None" },
      { id: "cat", name: "Ginger cat" },
      { id: "hands", name: "Hands" },
    ]);
  });

  it("keeps search and chips off at eight entries", () => {
    expect(galleryTools(many.slice(0, 8)).search).toBe(false);
  });

  it("adds search and one chip per named category past eight entries", () => {
    expect(galleryTools(many)).toEqual({
      search: true,
      categories: ["Animals", "Gestures", "Weather", "Hats", "Accessories"],
    });
  });

  it("filters by name and category and hides None while filtering", () => {
    expect(decorationChoices(many, { query: " CROWN " })).toEqual([
      { id: "crown", name: "Flower crown" },
      { id: "king", name: "Crown" },
    ]);
    expect(
      decorationChoices(many, { category: "Animals" }).map(({ id }) => id),
    ).toEqual(["cat", "bunny"]);
    expect(
      decorationChoices(many, { query: "hat", category: "Hats" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["party"]);
    expect(decorationChoices(many, { query: "zzz" })).toEqual([]);
  });

  it("names the saved decoration for the Decoration row", () => {
    expect(decorationName(many, undefined)).toBe("None");
    expect(decorationName(many, "cat")).toBe("Ginger cat");
    expect(decorationName(many, "retired")).toBe("Unavailable");
  });
});
