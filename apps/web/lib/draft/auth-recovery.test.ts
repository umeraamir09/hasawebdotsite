import { describe, expect, it, vi } from "vitest";
import {
  CONTINUATION_KEY,
  loadRecoveryEntry,
  readContinuation,
  writeContinuation,
} from "./auth-recovery";
import { fixtureTransport } from "./test-fixtures";
import type { AuthContinuation, RecoveryRecord } from "./types";

const continuation: AuthContinuation = {
  version: 1,
  flow: "draft-recovery",
  context: "setup",
  ownerId: "owner-a",
  portfolioId: "portfolio-a",
  recordId: "source",
};
const record: RecoveryRecord = {
  version: 1,
  id: "source",
  ownerId: "owner-a",
  portfolioId: "portfolio-a",
  context: "setup",
  base: fixtureTransport().get(),
  working: null,
  progress: null,
  inputs: {},
  batch: null,
  validationJournal: null,
};
describe("tab-scoped auth continuation", () => {
  it("stores only versioned identifiers and controlled context", () => {
    let stored = "";
    writeContinuation(record, {
      setItem(key, value) {
        expect(key).toBe(CONTINUATION_KEY);
        stored = value;
      },
    });
    expect(JSON.parse(stored)).toEqual(continuation);
    expect(readContinuation({ getItem: () => stored })).toEqual(continuation);
    expect(
      readContinuation({
        getItem: () =>
          JSON.stringify({ ...continuation, returnURL: "https://evil.test" }),
      }),
    ).toBeNull();
    expect(readContinuation({ getItem: () => '{"version":9}' })).toBeNull();
    expect(
      readContinuation({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBeNull();
  });
  it("checks uncached identity before reading any recovery range", async () => {
    const order: string[] = [];
    const result = await loadRecoveryEntry({
      owner: async () => {
        order.push("owner");
        return {
          user: { id: "owner-a", name: "A" },
          portfolio: { id: "portfolio-a" },
        };
      },
      continuation: () => {
        order.push("continuation");
        return continuation;
      },
      records: async () => {
        order.push("records");
        return [record];
      },
    });
    expect(result.kind).toBe("ready");
    expect(order).toEqual(["owner", "continuation", "records"]);
  });
  it.each(["wrong owner", "wrong portfolio", "signed out"])(
    "does not open recovery for %s",
    async (kind) => {
      const records = vi.fn(async () => [record]);
      const result = await loadRecoveryEntry({
        owner: async () =>
          kind === "signed out"
            ? null
            : {
                user: {
                  id: kind === "wrong owner" ? "other" : "owner-a",
                  name: "B",
                },
                portfolio: {
                  id: kind === "wrong portfolio" ? "other" : "portfolio-a",
                },
              },
        continuation: () => continuation,
        records,
      });
      expect(result.kind).toBe(
        kind === "signed out" ? "signed-out" : "mismatch",
      );
      expect(records).not.toHaveBeenCalled();
    },
  );
  it("handles stale and missing continuation without provisioning", async () => {
    const owner = async () => ({
      user: { id: "owner-a", name: "A" },
      portfolio: { id: "portfolio-a" },
    });
    expect(
      (
        await loadRecoveryEntry({
          owner,
          continuation: () => continuation,
          records: async () => [],
        })
      ).kind,
    ).toBe("stale");
    expect(
      (await loadRecoveryEntry({ owner, continuation: () => null })).kind,
    ).toBe("missing");
  });
});
