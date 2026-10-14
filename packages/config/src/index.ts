export type RuntimeApp = "web" | "site" | "jobs";

export function health(app: RuntimeApp): Response {
  return Response.json(
    { app, status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function isLocalProbe(request: Request, environment: string): boolean {
  const host = new URL(request.url).hostname;
  return (
    environment === "local" && (host === "localhost" || host === "127.0.0.1")
  );
}
