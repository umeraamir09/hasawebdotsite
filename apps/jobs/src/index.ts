import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { WorkerEntrypoint, WorkflowEntrypoint } from "cloudflare:workers";
import type { AuthEnvironment } from "@hasaweb/auth";
import { health, isLocalProbe } from "@hasaweb/config";
import { type Wake, wakeSchema } from "@hasaweb/db";
import { parseRefreshMessage, type RefreshMessage } from "@hasaweb/github";
import type { ContactBindings } from "./contact-routes";
import {
  type GitHubBindings,
  processGitHubRefresh,
  sweepGitHubCleanups,
  sweepGitHubRefreshes,
} from "./github-routes";
import { ownerRouter } from "./owner-api";
import type { PublicationCacheEnv } from "./publication-cache";
import {
  type DispatchEnv,
  runPublicationBatch,
  sweepPublicationTasks,
} from "./publication-dispatch";
import type { PublicationBindings } from "./publication-routes";
import {
  sweepPublicationWithdrawals,
  withdrawPublication,
} from "./publication-withdrawal";

// Only a named service binding can reach this API. The default HTTP entry has no owner routes.
export class OwnerApi extends WorkerEntrypoint<
  AuthEnvironment &
    PublicationBindings &
    Partial<GitHubBindings> &
    ContactBindings
> {
  fetch(request: Request) {
    return ownerRouter.fetch(request, this.env, this.ctx);
  }
}

interface Env
  extends DispatchEnv,
    PublicationCacheEnv,
    Partial<Omit<GitHubBindings, "GITHUB_QUEUE">> {
  APP_ENV: string;
  DB: D1Database;
  SITES_BUCKET: R2Bucket;
  PUBLIC_ASSETS_BUCKET: R2Bucket;
  CONTACT_QUEUE: Queue<{ id: string }>;
  GITHUB_QUEUE: Queue<RefreshMessage>;
  PUBLISH_WORKFLOW: Workflow<{ id: string }>;
  PUBLICATION_QUEUE_NAME?: string;
  GITHUB_QUEUE_NAME?: string;
}
export class RuntimeWorkflow extends WorkflowEntrypoint<Env, { id: string }> {
  async run(event: WorkflowEvent<{ id: string }>, step: WorkflowStep) {
    if (this.env.APP_ENV !== "local")
      throw new Error("Development workflow disabled");
    await step.do("record runtime probe", async () => {
      await this.env.DB.prepare(
        "INSERT OR REPLACE INTO runtime_probe (key, value) VALUES (?, ?)",
      )
        .bind(`workflow:${event.payload.id}`, "complete")
        .run();
    });
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return health("jobs");
    if (!isLocalProbe(request, env.APP_ENV))
      return new Response(null, { status: 404 });
    if (path === "/__dev/results" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT key, value FROM runtime_probe ORDER BY key",
      ).all();
      const site = await env.SITES_BUCKET.get("runtime/site.txt");
      const asset = await env.PUBLIC_ASSETS_BUCKET.get("runtime/asset.txt");
      return Response.json({
        rows: rows.results,
        site: await site?.text(),
        asset: await asset?.text(),
      });
    }
    return new Response(null, { status: 404 });
  },
  async queue(batch, env) {
    if (
      batch.queue ===
      (env.PUBLICATION_QUEUE_NAME ?? "hasaweb-publication-local")
    ) {
      for (const message of batch.messages) {
        const wake = wakeSchema.safeParse(message.body);
        if (!wake.success) {
          message.ack();
          continue;
        }
        try {
          await runPublicationBatch(env, wake.data.candidateId);
          await withdrawPublication(env, wake.data.candidateId);
          message.ack();
        } catch {
          message.retry({ delaySeconds: 2 });
        }
      }
      return;
    }
    let messages = batch.messages;
    if (batch.queue === (env.GITHUB_QUEUE_NAME ?? "hasaweb-github-local")) {
      const probes: (typeof messages)[number][] = [];
      for (const message of messages) {
        const refresh = parseRefreshMessage(message.body);
        if (!refresh) {
          probes.push(message);
          continue;
        }
        // D1 records the request; a failure is retried by the next request
        // after the window, never by redelivering this message.
        await processGitHubRefresh(env, refresh).catch((error: unknown) =>
          console.error(
            "github refresh failed",
            error instanceof Error ? error.name : typeof error,
          ),
        );
        message.ack();
      }
      if (!probes.length) return;
      // Outside local development an unknown message can never succeed.
      // Acknowledge it rather than retry the batch until it is dropped.
      if (env.APP_ENV !== "local") {
        for (const message of probes) message.ack();
        return;
      }
      messages = probes;
    }
    if (env.APP_ENV !== "local") throw new Error("Development queue disabled");
    for (const message of messages) {
      if (!("id" in message.body)) {
        message.ack();
        continue;
      }
      await env.DB.prepare(
        "INSERT OR REPLACE INTO runtime_probe (key, value) VALUES (?, ?)",
      )
        .bind(`${batch.queue}:${message.body.id}`, "complete")
        .run();
      message.ack();
    }
  },
  async scheduled(_event, env) {
    await sweepPublicationTasks(env);
    await sweepPublicationWithdrawals(env);
    // Durable grant revocation: pending cleanups retry here until GitHub
    // confirms them. Uncertain ones wait for reconciliation (Phase 11D).
    await sweepGitHubCleanups(env).catch(() => []);
    // Daily private refresh: one bounded batch of due connections per tick.
    await sweepGitHubRefreshes(env).catch((error: unknown) =>
      console.error(
        "github refresh sweep failed",
        error instanceof Error ? error.name : typeof error,
      ),
    );
    if (env.APP_ENV !== "local") return;
    await env.DB.prepare(
      "INSERT OR REPLACE INTO runtime_probe (key, value) VALUES ('cron', 'complete')",
    ).run();
  },
} satisfies ExportedHandler<Env, { id: string } | Wake | RefreshMessage>;
