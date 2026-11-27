import { sweepContactOutbox } from "@hasaweb/db";
import { emailProvider } from "@hasaweb/email";
import { sweepAccountDeletions } from "./account-deletion";
import { sweepGitHubCleanups, sweepGitHubRefreshes } from "./github-routes";
import { logDatabaseSize, runMaintenance } from "./maintenance";
import { sweepPublicationTasks } from "./publication-dispatch";
import { sweepUnpublishWithdrawals } from "./publication-unpublish";
import { sweepPublicationWithdrawals } from "./publication-withdrawal";

export const CRON_EVERY_MINUTE = "* * * * *";
export const CRON_EVERY_TWO_MINUTES = "*/2 * * * *";
export const CRON_EVERY_FIVE_MINUTES = "*/5 * * * *";
export const CRON_HOURLY = "0 * * * *";

export const SCHEDULED_CRONS = [
  CRON_EVERY_MINUTE,
  CRON_EVERY_TWO_MINUTES,
  CRON_EVERY_FIVE_MINUTES,
  CRON_HOURLY,
] as const;

export type ScheduledCron = (typeof SCHEDULED_CRONS)[number];

type ScheduledEnv = Parameters<typeof sweepPublicationTasks>[0] &
  Parameters<typeof sweepPublicationWithdrawals>[0] &
  Parameters<typeof sweepUnpublishWithdrawals>[0] &
  Parameters<typeof sweepAccountDeletions>[0] &
  Parameters<typeof sweepGitHubCleanups>[0] &
  Parameters<typeof sweepGitHubRefreshes>[0] &
  Parameters<typeof runMaintenance>[0] &
  Parameters<typeof emailProvider>[0];

async function runSweep(label: string, sweep: () => unknown) {
  try {
    await sweep();
  } catch (error: unknown) {
    console.error(label, error instanceof Error ? error.name : typeof error);
  }
}

export async function runScheduled(
  event: { cron: string; scheduledTime: number },
  env: ScheduledEnv,
): Promise<void> {
  switch (event.cron) {
    case CRON_EVERY_MINUTE:
      await runSweep("publication sweep failed", () =>
        sweepPublicationTasks(env),
      );
      await runSweep("publication withdrawal sweep failed", () =>
        sweepPublicationWithdrawals(env),
      );
      await runSweep("unpublish sweep failed", () =>
        sweepUnpublishWithdrawals(env),
      );
      await runSweep("account deletion sweep failed", () =>
        sweepAccountDeletions(env),
      );
      // Pending cleanups retry until GitHub confirms them. Uncertain ones
      // wait for reconciliation in Phase 11D.
      await runSweep("github cleanup sweep failed", () =>
        sweepGitHubCleanups(env),
      );
      return;
    case CRON_EVERY_TWO_MINUTES:
      // The sweep retries delivery, finishes interrupted attempts, and sends
      // owner notices.
      await runSweep("contact sweep failed", () =>
        sweepContactOutbox(env.DB, emailProvider(env), Date.now()),
      );
      return;
    case CRON_EVERY_FIVE_MINUTES:
      await runSweep("maintenance sweep failed", () =>
        runMaintenance(env, event.scheduledTime),
      );
      return;
    case CRON_HOURLY:
      await runSweep("github refresh sweep failed", () =>
        sweepGitHubRefreshes(env),
      );
      await runSweep("d1 size check failed", () => logDatabaseSize(env));
      return;
    default:
      throw new Error(`Unknown cron ${event.cron}`);
  }
}
