import { describe, expect, it } from "vitest";
import { withdraw } from "./withdraw";

describe("asset withdrawal", () => {
  it("deletes before purge and retries purge without restoring public bytes", async () => {
    const privateBytes = new Map([["face", "private source"]]);
    const publicBytes = new Map([["face", "public copy"]]);
    const order: string[] = [];
    const bucket = {
      async delete(key: string) {
        order.push("delete");
        publicBytes.delete(key);
      },
    };
    let attempts = 0;
    const purge = async (url: string) => {
      order.push("purge");
      expect(url).toBe("https://assets.example.test/face");
      expect(publicBytes.has("face")).toBe(false);
      if (++attempts === 1) throw new Error("Provider unavailable");
    };
    await expect(
      withdraw(bucket, "face", "https://assets.example.test/face", purge),
    ).rejects.toThrow("Provider unavailable");
    expect(privateBytes.get("face")).toBe("private source");
    await withdraw(bucket, "face", "https://assets.example.test/face", purge);
    expect(order).toEqual(["delete", "purge", "delete", "purge"]);
  });

  it("does not purge when origin deletion fails", async () => {
    let purged = false;
    const bucket = {
      async delete() {
        throw new Error("R2 unavailable");
      },
    };
    await expect(
      withdraw(bucket, "face", "https://assets.example.test/face", async () => {
        purged = true;
      }),
    ).rejects.toThrow("R2 unavailable");
    expect(purged).toBe(false);
  });
});
