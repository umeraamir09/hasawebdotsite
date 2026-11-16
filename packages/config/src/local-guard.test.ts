import { describe, expect, it } from "vitest";
import { isLocalProbe } from "./index";

describe("development probe boundary", () => {
  it("allows local fixtures on loopback only", () => {
    expect(
      isLocalProbe(new Request("http://127.0.0.1/__dev/run"), "local"),
    ).toBe(true);
    expect(
      isLocalProbe(new Request("http://localhost/__dev/run"), "local"),
    ).toBe(true);
  });
  it("rejects production and portfolio hosts", () => {
    expect(
      isLocalProbe(new Request("http://localhost/__dev/run"), "production"),
    ).toBe(false);
    expect(
      isLocalProbe(
        new Request("https://someone.hasaweb.site/__dev/run"),
        "local",
      ),
    ).toBe(false);
  });
});
