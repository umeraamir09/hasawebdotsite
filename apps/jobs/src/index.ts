import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { WorkerEntrypoint, WorkflowEntrypoint } from "cloudflare:workers";
import type { AuthEnvironment } from "@hasaweb/auth";
import { health, isLocalProbe } from "@hasaweb/config";
import { ownerRouter } from "./owner-api";

// Only a named service binding can reach this API. The default HTTP entry has no owner routes.
export class OwnerApi extends WorkerEntrypoint<AuthEnvironment> {
  fetch(request: Request) {
    return ownerRouter.fetch(request, this.env, this.ctx);
  }
}

interface Env {
  APP_ENV: string;
  DB: D1Database;
  SITES_BUCKET: R2Bucket;
  PUBLIC_ASSETS_BUCKET: R2Bucket;
  CONTACT_QUEUE: Queue<{ id: string }>;
  GITHUB_QUEUE: Queue<{ id: string }>;
  PUBLISH_WORKFLOW: Workflow<{ id: string }>;
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
    if (env.APP_ENV !== "local") throw new Error("Development queue disabled");
    for (const message of batch.messages) {
      await env.DB.prepare(
        "INSERT OR REPLACE INTO runtime_probe (key, value) VALUES (?, ?)",
      )
        .bind(`${batch.queue}:${message.body.id}`, "complete")
        .run();
      message.ack();
    }
  },
  async scheduled(_event, env) {
    if (env.APP_ENV !== "local") return;
    await env.DB.prepare(
      "INSERT OR REPLACE INTO runtime_probe (key, value) VALUES ('cron', 'complete')",
    ).run();
  },
} satisfies ExportedHandler<Env, { id: string }>;
