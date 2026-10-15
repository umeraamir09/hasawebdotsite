import { initial, runFixtures } from "./fixtures";
import { applyRefresh, enable, withdraw } from "./permissions";

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      return new Response(null, { status: 404 });
    if (url.pathname === "/health") return new Response("ready");
    if (url.pathname !== "/run" || request.method !== "POST")
      return new Response(null, { status: 404 });
    const checks = await runFixtures();
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS github_spike (id TEXT PRIMARY KEY, generation INTEGER NOT NULL, state TEXT NOT NULL)",
    );
    const id = crypto.randomUUID();
    const active = enable(
      initial(),
      true,
      initial().selected,
      "read:user",
      "encrypted-fixture",
    );
    await env.DB.prepare("INSERT INTO github_spike VALUES (?, ?, ?)")
      .bind(id, active.generation, JSON.stringify(active))
      .run();
    const calendar = {
      days: [{ date: "2026-10-14", count: 7 }],
      fetchedAt: "2026-10-15T00:00:00Z",
    };
    const refreshed = applyRefresh(active, active.generation, calendar);
    const saved = await env.DB.prepare(
      "UPDATE github_spike SET state = ? WHERE id = ? AND generation = ?",
    )
      .bind(JSON.stringify(refreshed), id, active.generation)
      .run();
    if (saved.meta.changes !== 1) throw new Error("current refresh failed");
    checks.push({
      name: "D1 accepts a refresh for the current grant generation",
      passed: true,
    });
    const disconnected = withdraw(refreshed);
    await env.DB.prepare(
      "UPDATE github_spike SET generation = ?, state = ? WHERE id = ?",
    )
      .bind(disconnected.generation, JSON.stringify(disconnected), id)
      .run();
    const stale = await env.DB.prepare(
      "UPDATE github_spike SET state = ? WHERE id = ? AND generation = ?",
    )
      .bind(JSON.stringify(refreshed), id, active.generation)
      .run();
    const stored = await env.DB.prepare(
      "SELECT state FROM github_spike WHERE id = ?",
    )
      .bind(id)
      .first<{ state: string }>();
    if (
      stale.meta.changes !== 0 ||
      stored?.state !== JSON.stringify(disconnected)
    )
      throw new Error("stale refresh restored revoked data");
    checks.push({
      name: "D1 rejects in-flight refresh after atomic grant withdrawal",
      passed: true,
    });
    await env.DB.prepare("DELETE FROM github_spike WHERE id = ?")
      .bind(id)
      .run();
    return Response.json(
      {
        runtime: "local workerd + D1 + Web Crypto",
        checks,
        liveProviderVerified: false,
        limitations: [
          "Provider HTTP responses are fixtures, not real OAuth grants",
          "Calendar visibility and scope headers require live account verification",
          "Intervals use an injected clock; production cron/queues are not installed",
          "No product OAuth routes, public endpoint, CDN cache, or provider grant deletion is deployed",
        ],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
} satisfies ExportedHandler<{ DB: D1Database }>;
