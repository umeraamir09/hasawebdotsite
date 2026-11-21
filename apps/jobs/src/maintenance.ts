import {
  collectDormantStaging,
  collectGitHubResiduals,
  collectOperatorAudits,
  databaseSize,
  retryExhaustedCleanups,
  type Wake,
} from "@hasaweb/db";
import { z } from "zod";

export type MaintenanceEnv = {
  DB: D1Database;
  // The web Worker's PublicationAssets entry, which alone can reach the
  // private draft bucket.
  PRIVATE_SOURCE: Pick<Fetcher, "fetch">;
  PUBLICATION_QUEUE: { send(body: Wake): Promise<unknown> };
};

/** Collection runs on every fifth cron minute; the size check once an hour. */
export const MAINTENANCE_EVERY_MINUTES = 5;

/**
 * Phase 51 garbage collection, one bounded pass per task. Each task is
 * independent, so one failing (logged without details) does not stop the
 * others; every pass is repeatable and resumes on the next tick.
 */
export async function runMaintenance(
  env: MaintenanceEnv,
  scheduledTime: number,
) {
  const minute = new Date(scheduledTime).getUTCMinutes();
  if (minute % MAINTENANCE_EVERY_MINUTES !== 0) return null;
  const now = scheduledTime;
  const tasks = {
    uploads: async () => {
      const response = await env.PRIVATE_SOURCE.fetch(
        "https://private-source/upload-collection",
        { method: "POST" },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Upload collection failed");
      }
      return z
        .object({ abandoned: z.number(), orphans: z.number() })
        .parse(await response.json());
    },
    staging: () => collectDormantStaging(env.DB, now),
    github: () => collectGitHubResiduals(env.DB),
    audits: () => collectOperatorAudits(env.DB, now),
    tombstones: async () => {
      const restarted = await retryExhaustedCleanups(env.DB, now);
      for (const candidateId of restarted)
        await env.PUBLICATION_QUEUE.send({ candidateId });
      return restarted.length;
    },
    size: async () => {
      if (minute !== 0) return null;
      const size = await databaseSize(env.DB);
      // Structured so a log alert can match it (Phase 52 wires the alert).
      const log = size.alert ? console.error : console.log;
      log(
        JSON.stringify({
          event: size.alert ? "d1_size_alert" : "d1_size",
          bytes: size.bytes,
        }),
      );
      return size;
    },
  };
  const results: Record<string, unknown> = {};
  for (const [name, task] of Object.entries(tasks))
    results[name] = await task().catch((error: unknown) => {
      console.error(
        "maintenance failed",
        name,
        error instanceof Error ? error.name : typeof error,
      );
      return "failed";
    });
  return results;
}
