// S-5 local entry only. No product route imports this file.
import { authBehavior } from "./auth-behavior";
import "./auth-provider-fixtures";

const origin = "https://hasaweb.site";
type Env = { DB: D1Database; FIXTURE_SECRET: string };

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

export default {
  async fetch(request: Request, env: Env) {
    // The runner transports virtual HTTPS requests over local loopback HTTP.
    // This checks server cookie attributes, not real browser TLS enforcement.
    const target = new URL(request.url);
    if (target.hostname !== "127.0.0.1")
      return new Response(null, { status: 404 });
    const virtualHost = request.headers.get("X-Fixture-Host") ?? "hasaweb.site";
    if (target.pathname === "/__fixture/counts") {
      const tables = ["spike_user", "spike_account", "spike_session"];
      const counts = await Promise.all(
        tables.map(async (table) => {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM ${table}`,
          ).first<{ n: number }>();
          return [table, row?.n];
        }),
      );
      return json(Object.fromEntries(counts));
    }
    target.protocol = "https:";
    target.port = "";
    target.host = virtualHost;
    const auth = authBehavior(env.DB, env.FIXTURE_SECRET, origin, {
      github: { clientId: "fixture-github", clientSecret: "fixture-secret" },
      google: { clientId: "fixture-google", clientSecret: "fixture-secret" },
    });
    return auth.handler(new Request(target, request));
  },
};
