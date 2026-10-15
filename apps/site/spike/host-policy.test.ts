import { describe, expect, it } from "vitest";
import { classifyHost, reserved } from "./host-policy";

describe("S-3 host policy", () => {
  it("separates app, redirect, R2 assets, portfolios and internal example", () => {
    expect(classifyHost("hasaweb.site")).toBe("web");
    expect(classifyHost("www.hasaweb.site")).toBe("redirect");
    expect(classifyHost("assets.hasaweb.site")).toBe("assets");
    expect(classifyHost("routingprobe.hasaweb.site")).toBe("portfolio");
    expect(classifyHost("EXAMPLE.HASAWEB.SITE")).toBe("internal-example");
    expect(classifyHost(`${"a".repeat(30)}.hasaweb.site`)).toBe("portfolio");
    for (const label of reserved) {
      if (["www", "assets", "example"].includes(label)) continue;
      expect(classifyHost(`${label}.hasaweb.site`), label).toBe("reserved");
    }
  });
  it("rejects invalid labels, nested names, ports, trailing dots and deceptive suffixes", () => {
    for (const host of [
      "",
      "localhost",
      "127.0.0.1",
      "a.hasaweb.site",
      "ab.hasaweb.site",
      `${"a".repeat(31)}.hasaweb.site`,
      "-alice.hasaweb.site",
      "alice-.hasaweb.site",
      "ali_ce.hasaweb.site",
      "a.b.hasaweb.site",
      ".hasaweb.site",
      "hasaweb.site.",
      "alice.hasaweb.site.",
      "alice.hasaweb.site:444",
      "hasaweb.site.evil.test",
      "evilhasaweb.site",
      "alice@hasaweb.site",
      "аlice.hasaweb.site",
    ])
      expect(classifyHost(host), host).toBe("invalid");
  });
});
