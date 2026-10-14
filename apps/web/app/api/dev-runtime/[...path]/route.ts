import { isLocalProbe } from "@hasaweb/config";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { env } = await getCloudflareContext({ async: true });
  if (!isLocalProbe(request, env.APP_ENV))
    return new Response(null, { status: 404 });
  const { path } = await context.params;
  const [app, ...rest] = path;
  if (app === "web" && rest.join("/") === "run" && request.method === "POST") {
    const id = crypto.randomUUID();
    await env.CONTACT_QUEUE.send({ id });
    await env.GITHUB_QUEUE.send({ id });
    await env.PUBLISH_WORKFLOW.create({ id, params: { id } });
    return Response.json({ id }, { status: 202 });
  }
  if (
    app === "web" &&
    rest.join("/") === "resources" &&
    request.method === "GET"
  ) {
    const row = await env.DB.prepare(
      "SELECT value FROM runtime_probe WHERE key = 'seed'",
    ).first();
    const draft = await env.DRAFT_BUCKET.get("runtime/draft.txt");
    return Response.json({ row, draft: await draft?.text() });
  }
  const binding =
    app === "site" ? env.SITE : app === "jobs" ? env.JOBS : undefined;
  if (!binding) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  url.pathname = rest[0] === "health" ? "/health" : `/__dev/${rest.join("/")}`;
  return binding.fetch(new Request(url, request));
}

export { handle as GET, handle as POST };
