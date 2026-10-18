// Isolated correctness/benchmark entry. Never imported by product code.
import { WorkerEntrypoint } from "cloudflare:workers";
import type { AuthEnvironment } from "@hasaweb/auth";
import { privateJson } from "@hasaweb/db";
import { ownerRouter } from "../src/owner-api";
import { measureDb } from "./measure-db";

type Env = AuthEnvironment & {
  RUNTIME_KEY: string;
  RUNTIME_ENABLED: string;
  MEASURE_DB?: string;
};
let previousEnvironment: Env | undefined;
let previousDatabase: D1Database | undefined;
export class RuntimeOwnerApi extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    if (
      this.env.RUNTIME_ENABLED !== "true" ||
      request.headers.get("X-Runtime-Key") !== this.env.RUNTIME_KEY
    )
      return privateJson(null, 404);
    const sameEnvironment = previousEnvironment === this.env;
    const sameDatabase = previousDatabase === this.env.DB;
    previousEnvironment = this.env;
    previousDatabase = this.env.DB;
    const preparation = request.headers.get("X-Fixture-Prepare");
    if (preparation) {
      const commands = JSON.parse(preparation) as {
        query: string;
        values?: unknown[];
      }[];
      for (const command of commands)
        await this.env.DB.prepare(command.query)
          .bind(...(command.values ?? []))
          .run();
    }
    const revoke = request.headers.get("X-Fixture-Revoke"),
      deleting = request.headers.get("X-Fixture-Delete"),
      failRead = request.headers.get("X-Fixture-Fail-Read"),
      fail = request.headers.get("X-Fixture-Fail");
    let injected = false;
    const measured =
      this.env.MEASURE_DB === "true" || revoke || deleting || fail || failRead
        ? measureDb(this.env.DB, async (query) => {
            if (failRead && /FROM\s+"?portfolio"?/i.test(query))
              throw new Error("D1_ERROR: controlled fixture read failure");
            if (injected || !/UPDATE\s+"?portfolio"?\s+SET/i.test(query))
              return;
            injected = true;
            if (fail) throw new Error("D1_ERROR: controlled fixture failure");
            if (revoke)
              await this.env.DB.prepare("DELETE FROM session WHERE id=?")
                .bind(revoke)
                .run();
            if (deleting)
              await this.env.DB.prepare(
                "UPDATE user SET deleting_at=? WHERE id=?",
              )
                .bind(Date.now(), deleting)
                .run();
          })
        : null;
    const response = await ownerRouter.fetch(
      request,
      measured ? { ...this.env, DB: measured.db } : this.env,
      this.ctx,
    );
    response.headers.set("X-Fixture-Same-Environment", String(sameEnvironment));
    response.headers.set("X-Fixture-Same-Database", String(sameDatabase));
    if (measured) {
      response.headers.set(
        "X-Fixture-Rows-Read",
        String(measured.counts.reads),
      );
      response.headers.set(
        "X-Fixture-Rows-Written",
        String(measured.counts.writes),
      );
      response.headers.set(
        "X-Fixture-Queries",
        String(measured.counts.queries),
      );
    }
    return response;
  }
}
export default {
  async fetch(request: Request, env: Env) {
    if (
      env.RUNTIME_ENABLED !== "true" ||
      request.headers.get("X-Runtime-Key") !== env.RUNTIME_KEY
    )
      return privateJson(null, 404);
    if (
      new URL(request.url).pathname === "/__fixture/sql" &&
      request.method === "POST"
    ) {
      const { query, values = [] } = await request.json<{
        query: string;
        values?: unknown[];
      }>();
      return privateJson(
        await env.DB.prepare(query)
          .bind(...values)
          .all(),
      );
    }
    return privateJson(null, 404);
  },
};
