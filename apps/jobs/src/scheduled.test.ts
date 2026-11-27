import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const sweeps = vi.hoisted(() => ({
  sweepPublicationTasks: vi.fn(),
  sweepPublicationWithdrawals: vi.fn(),
  sweepUnpublishWithdrawals: vi.fn(),
  sweepAccountDeletions: vi.fn(),
  sweepGitHubCleanups: vi.fn(),
  sweepGitHubRefreshes: vi.fn(),
  sweepContactOutbox: vi.fn(),
  emailProvider: vi.fn(),
  runMaintenance: vi.fn(),
  logDatabaseSize: vi.fn(),
}));

vi.mock("./publication-dispatch", () => ({
  sweepPublicationTasks: sweeps.sweepPublicationTasks,
}));
vi.mock("./publication-withdrawal", () => ({
  sweepPublicationWithdrawals: sweeps.sweepPublicationWithdrawals,
}));
vi.mock("./publication-unpublish", () => ({
  sweepUnpublishWithdrawals: sweeps.sweepUnpublishWithdrawals,
}));
vi.mock("./account-deletion", () => ({
  sweepAccountDeletions: sweeps.sweepAccountDeletions,
}));
vi.mock("./github-routes", () => ({
  sweepGitHubCleanups: sweeps.sweepGitHubCleanups,
  sweepGitHubRefreshes: sweeps.sweepGitHubRefreshes,
}));
vi.mock("./maintenance", () => ({
  runMaintenance: sweeps.runMaintenance,
  logDatabaseSize: sweeps.logDatabaseSize,
}));
vi.mock("@hasaweb/db", () => ({
  sweepContactOutbox: sweeps.sweepContactOutbox,
}));
vi.mock("@hasaweb/email", () => ({
  emailProvider: sweeps.emailProvider,
}));

import {
  CRON_EVERY_FIVE_MINUTES,
  CRON_EVERY_MINUTE,
  CRON_EVERY_TWO_MINUTES,
  CRON_HOURLY,
  runScheduled,
  SCHEDULED_CRONS,
} from "./scheduled";

const db = { tag: "db" };
const env = { DB: db };
const provider = { id: "mail" };

function run(cron: string, scheduledTime = 0) {
  return runScheduled(
    { cron, scheduledTime },
    env as unknown as Parameters<typeof runScheduled>[1],
  );
}

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls.length = 0;
  for (const [name, fn] of Object.entries(sweeps)) {
    fn.mockReset();
    fn.mockImplementation(async () => {
      calls.push(name);
    });
  }
  sweeps.emailProvider.mockReset();
  sweeps.emailProvider.mockImplementation(() => {
    calls.push("emailProvider");
    return provider;
  });
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logged.mockRestore();
});

describe("scheduled crons", () => {
  it("keeps the other minute sweeps going when publication fails", async () => {
    sweeps.sweepPublicationTasks.mockImplementation(async () => {
      calls.push("sweepPublicationTasks");
      throw new Error("stopped");
    });
    await run(CRON_EVERY_MINUTE, Date.UTC(2027, 0, 4, 12, 1));
    expect(calls).toEqual([
      "sweepPublicationTasks",
      "sweepPublicationWithdrawals",
      "sweepUnpublishWithdrawals",
      "sweepAccountDeletions",
      "sweepGitHubCleanups",
    ]);
    expect(sweeps.sweepPublicationWithdrawals).toHaveBeenCalledWith(env);
    expect(sweeps.sweepUnpublishWithdrawals).toHaveBeenCalledWith(env);
    expect(sweeps.sweepAccountDeletions).toHaveBeenCalledWith(env);
    expect(sweeps.sweepGitHubCleanups).toHaveBeenCalledWith(env);
    expect(logged).toHaveBeenCalledWith("publication sweep failed", "Error");
    expect(sweeps.sweepContactOutbox).not.toHaveBeenCalled();
    expect(sweeps.runMaintenance).not.toHaveBeenCalled();
    expect(sweeps.sweepGitHubRefreshes).not.toHaveBeenCalled();
    expect(sweeps.logDatabaseSize).not.toHaveBeenCalled();
  });

  it("logs a github cleanup failure and finishes the minute cron", async () => {
    sweeps.sweepGitHubCleanups.mockImplementation(async () => {
      calls.push("sweepGitHubCleanups");
      return Promise.reject("down");
    });
    await run(CRON_EVERY_MINUTE);
    expect(calls).toEqual([
      "sweepPublicationTasks",
      "sweepPublicationWithdrawals",
      "sweepUnpublishWithdrawals",
      "sweepAccountDeletions",
      "sweepGitHubCleanups",
    ]);
    expect(logged).toHaveBeenCalledWith(
      "github cleanup sweep failed",
      "string",
    );
  });

  it("runs only the contact sweep on the two-minute cron", async () => {
    await run(CRON_EVERY_TWO_MINUTES, 120_000);
    expect(calls).toEqual(["emailProvider", "sweepContactOutbox"]);
    expect(sweeps.emailProvider).toHaveBeenCalledWith(env);
    expect(sweeps.sweepContactOutbox).toHaveBeenCalledWith(
      db,
      provider,
      expect.any(Number),
    );
    expect(sweeps.sweepPublicationTasks).not.toHaveBeenCalled();
    expect(sweeps.runMaintenance).not.toHaveBeenCalled();
    expect(sweeps.sweepGitHubRefreshes).not.toHaveBeenCalled();
    expect(sweeps.logDatabaseSize).not.toHaveBeenCalled();
  });

  it("runs only maintenance on the five-minute cron", async () => {
    const scheduledTime = Date.UTC(2027, 0, 4, 12, 5);
    await run(CRON_EVERY_FIVE_MINUTES, scheduledTime);
    expect(calls).toEqual(["runMaintenance"]);
    expect(sweeps.runMaintenance).toHaveBeenCalledWith(env, scheduledTime);
    expect(sweeps.logDatabaseSize).not.toHaveBeenCalled();
    expect(sweeps.sweepPublicationTasks).not.toHaveBeenCalled();
    expect(sweeps.sweepContactOutbox).not.toHaveBeenCalled();
    expect(sweeps.sweepGitHubRefreshes).not.toHaveBeenCalled();
  });

  it("runs the refresh and the size check on the hourly cron", async () => {
    const scheduledTime = Date.UTC(2027, 0, 4, 13, 0);
    sweeps.sweepGitHubRefreshes.mockImplementation(async () => {
      calls.push("sweepGitHubRefreshes");
      throw new Error("refresh");
    });
    await run(CRON_HOURLY, scheduledTime);
    expect(calls).toEqual(["sweepGitHubRefreshes", "logDatabaseSize"]);
    expect(sweeps.logDatabaseSize).toHaveBeenCalledWith(env);
    expect(sweeps.runMaintenance).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith("github refresh sweep failed", "Error");
  });

  it("rejects an unknown cron before any sweep", async () => {
    const cron = "1 2 3 4 5";
    await expect(run(cron)).rejects.toThrow(Error);
    await expect(run(cron)).rejects.toThrow(cron);
    expect(calls).toEqual([]);
  });

  it("lists the four cron triggers in wrangler", () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../wrangler.jsonc",
    );
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      triggers: { crons: string[] };
    };
    expect(config.triggers.crons).toEqual([...SCHEDULED_CRONS]);
  });
});
