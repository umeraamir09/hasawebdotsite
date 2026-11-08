import {
  type GraphFailure,
  ownerGraphSetup,
  privateJson,
  SaveError,
} from "@hasaweb/db";
import type { GitHubTransport } from "@hasaweb/github";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { readBody } from "./draft-routes";
import type { OwnerBindings } from "./owner-api";

export type GitHubBindings = {
  // The separate zero-scope platform credential. Never an owner token.
  GITHUB_SERVICE_TOKEN: string;
  // Fixtures only. Ignored unless APP_ENV is local or test.
  GITHUB_API_ORIGIN: string;
};

const setupSchema = z.strictObject({ username: z.string().min(1).max(64) });
const emptySchema = z.strictObject({});
const failureStatus = {
  invalid_username: 422,
  not_found: 422,
  unavailable: 503,
  misconfigured: 503,
  too_soon: 429,
  conflict: 409,
  no_graph: 409,
} as const satisfies Record<GraphFailure, number>;

function transport(env: OwnerBindings["Bindings"]): GitHubTransport {
  const fixture = ["local", "test"].includes(env.APP_ENV)
    ? env.GITHUB_API_ORIGIN
    : undefined;
  return (url: string, init: RequestInit) => {
    if (!fixture) return fetch(url, init);
    const target = new URL(url);
    return fetch(new URL(`${target.pathname}${target.search}`, fixture), init);
  };
}

type Service = ReturnType<typeof ownerGraphSetup>;
type Result =
  | { ok: true; status: unknown }
  | { ok: false; error: GraphFailure };
const outcome = (result: Result) => {
  if (result.ok) return privateJson(result.status);
  return privateJson({ error: result.error }, failureStatus[result.error]);
};

export function addGitHubRoutes(app: Hono<OwnerBindings>) {
  // Every handler maps an owner without a portfolio and any storage failure to
  // a closed error. Provider detail never reaches the browser.
  const route = (
    method: "get" | "post",
    path: string,
    handler: (service: Service, c: Context<OwnerBindings>) => Promise<Response>,
  ) =>
    app[method](`/api/owner/github${path}`, async (c) => {
      const token = c.env.GITHUB_SERVICE_TOKEN;
      if (!token) return privateJson({ error: "unavailable" }, 503);
      try {
        return await handler(
          ownerGraphSetup(c.env.DB, c.get("identity"), {
            transport: transport(c.env),
            platformToken: token,
          }),
          c,
        );
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SaveError)
          return privateJson({ error: "invalid_input" }, 422);
        if (
          error instanceof Error &&
          error.message === "An active owner portfolio is required"
        )
          return privateJson({ error: "no_portfolio" }, 409);
        // Server log only: the browser gets the closed error below.
        console.error(
          "github graph route failed",
          error instanceof Error ? error.name : typeof error,
        );
        return privateJson({ error: "unavailable" }, 503);
      }
    });

  route("get", "", async (service) => privateJson(await service.status()));
  route("get", "/preview", async (service) =>
    privateJson({ graph: await service.preview() }),
  );
  route("post", "/detect", async (service, c) => {
    emptySchema.parse(await readBody(c.req.raw, 256));
    const result = await service.detect();
    return result.ok ? privateJson({ login: result.login }) : outcome(result);
  });
  route("post", "/setup", async (service, c) => {
    const command = setupSchema.parse(await readBody(c.req.raw, 512));
    return outcome(await service.setup(command.username));
  });
  route("post", "/retry", async (service, c) => {
    emptySchema.parse(await readBody(c.req.raw, 256));
    return outcome(await service.retry());
  });
  for (const action of ["", "/preview", "/detect", "/setup", "/retry"])
    app.all(`/api/owner/github${action}`, () =>
      privateJson({ error: "invalid_input" }, 405),
    );
}
