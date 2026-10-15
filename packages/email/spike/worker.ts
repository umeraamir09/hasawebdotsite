import { runBudgetFixtures, runProviderFixtures } from "./fixtures";

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      return new Response(null, { status: 404 });
    if (url.pathname === "/health") return new Response("ready");
    if (url.pathname !== "/run" || request.method !== "POST")
      return new Response(null, { status: 404 });
    const checks = [
      ...(await runProviderFixtures()),
      ...(await runBudgetFixtures(env.DB)),
    ];
    return Response.json(
      {
        runtime: "local workerd + D1",
        checks,
        liveProviderVerified: false,
        limitations: [
          "Controlled fixtures do not prove live domain verification or delivery.",
          "Isolated reservation tables do not implement the production outbox or retry scheduler.",
          "Dispatch attempts are conservatively charged even after provider errors.",
        ],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
};
