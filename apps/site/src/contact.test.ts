import { describe, expect, it, vi } from "vitest";
import { type ContactEnv, serveContact, verifyTurnstile } from "./contact";

type State = {
  published: boolean;
  verified: boolean;
  count: number;
  allowance: boolean;
  fail?: boolean;
  accepted: unknown[][];
};
// A minimal D1 stand-in: the host lookup, the visitor counter batch and the
// reservation + outbox batch. Real triggers and concurrency are covered by
// the api e2e project against workerd's D1.
function database(state: State): D1Database {
  const statement = (sql: string, values: unknown[] = []) => ({
    sql,
    values,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      if (state.fail) throw new Error("D1_ERROR");
      return sql.includes("SELECT p.id") && state.published
        ? { id: "portfolio-1" }
        : null;
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: ReturnType<typeof statement>[]) => {
      if (statements[1]?.sql.includes("INTO counter")) {
        state.count += 1;
        return [{}, { results: [{ count: state.count }] }];
      }
      if (!state.allowance) throw new Error("D1_ERROR: contact_allowance");
      const changes = state.published && state.verified ? 1 : 0;
      if (changes) state.accepted.push(statements[1]?.values ?? []);
      return [{ meta: { changes } }, { meta: { changes } }];
    },
  } as unknown as D1Database;
}

const host = "ada.hasaweb.site";
const fields = {
  name: "Visitor",
  email: "visitor@example.com",
  message: "Hello",
  token: "turnstile-token",
};
function post(
  body: unknown = fields,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://${host}/_/contact`, {
    method: "POST",
    headers: {
      Origin: `https://${host}`,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.9",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function setup(overrides: Partial<State> = {}, env: Partial<ContactEnv> = {}) {
  const state: State = {
    published: true,
    verified: true,
    count: 0,
    allowance: true,
    accepted: [],
    ...overrides,
  };
  const turnstile = vi.fn(async () => "passed" as const);
  const send = (request: Request) =>
    serveContact(
      request,
      {
        DB: database(state),
        APP_ENV: "test",
        TURNSTILE_SITE_KEY: "site-key",
        ...env,
      },
      "ada",
      { turnstile },
    );
  return { state, turnstile, send };
}
const read = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

describe("/_/contact", () => {
  it("accepts a valid message only after the outbox row is written", async () => {
    const { state, send } = setup();
    const response = await send(post());
    expect(await read(response)).toEqual({
      status: 202,
      body: { status: "accepted" },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(state.accepted).toHaveLength(1);
    expect(state.accepted[0]).toEqual(
      expect.arrayContaining(["Visitor", "visitor@example.com", "Hello"]),
    );
  });
  it("wakes delivery with the outbox ID only after acceptance", async () => {
    const sent: unknown[] = [];
    const waits: Promise<unknown>[] = [];
    const queue = {
      send: async (body: { outboxId: string }) => {
        sent.push(body);
      },
    };
    const state: State = {
      published: true,
      verified: true,
      count: 0,
      allowance: true,
      accepted: [],
    };
    const submit = (env: Partial<ContactEnv>, request = post()) =>
      serveContact(
        request,
        { DB: database(state), APP_ENV: "test", ...env },
        "ada",
        {
          turnstile: async () => "passed",
          background: { waitUntil: (work) => waits.push(work) },
        },
      );
    expect((await submit({ CONTACT_QUEUE: queue })).status).toBe(202);
    await Promise.all(waits);
    expect(sent).toEqual([{ outboxId: state.accepted[0]?.[1] }]);
    // A lost wake-up never turns an accepted message into a failure.
    const broken = {
      send: async () => {
        throw new Error("queue down");
      },
    };
    expect((await submit({ CONTACT_QUEUE: broken })).status).toBe(202);
    await Promise.all(waits);
    // Rejected submissions wake nothing.
    state.verified = false;
    expect((await submit({ CONTACT_QUEUE: queue })).status).toBe(503);
    expect(sent).toHaveLength(1);
  });
  it("tells the published form its site key, and nothing else", async () => {
    const { send } = setup();
    expect(
      await read(await send(new Request(`https://${host}/_/contact`))),
    ).toEqual({ status: 200, body: { siteKey: "site-key" } });
    const closed = setup({ published: false });
    expect(
      (await closed.send(new Request(`https://${host}/_/contact`))).status,
    ).toBe(404);
  });
  it("returns field errors without counting or checking Turnstile", async () => {
    const { state, turnstile, send } = setup();
    expect(
      await read(await send(post({ ...fields, email: "nope", message: " " }))),
    ).toEqual({
      status: 422,
      body: {
        error: "invalid_fields",
        fields: { email: "invalid", message: "required" },
      },
    });
    expect(state.count).toBe(0);
    expect(turnstile).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, non-JSON, oversized and malformed posts", async () => {
    const { state, send } = setup();
    expect(
      (await send(post(fields, { Origin: "https://evil.example" }))).status,
    ).toBe(403);
    expect(
      (await send(post(fields, { Origin: "https://bob.hasaweb.site" }))).status,
    ).toBe(403);
    expect(
      (await send(post(fields, { "Content-Type": "text/plain" }))).status,
    ).toBe(415);
    expect(
      (await send(post({ ...fields, message: "a".repeat(40_000) }))).status,
    ).toBe(413);
    expect((await send(post("{"))).status).toBe(400);
    expect((await send(post({ ...fields, extra: 1 }))).status).toBe(400);
    expect((await send(post({ ...fields, name: 1 }))).status).toBe(400);
    expect(
      (
        await send(
          new Request(`https://${host}/_/contact`, { method: "DELETE" }),
        )
      ).status,
    ).toBe(405);
    expect(state.accepted).toHaveLength(0);
  });
  it("rejects every submission to an unavailable portfolio", async () => {
    const { state, turnstile, send } = setup({ published: false });
    expect(await read(await send(post()))).toEqual({
      status: 404,
      body: { error: "unavailable" },
    });
    expect(turnstile).not.toHaveBeenCalled();
    expect(state.accepted).toHaveLength(0);
  });
  it("rejects when the recipient is not verified at acceptance", async () => {
    const { state, send } = setup({ verified: false });
    expect(await read(await send(post()))).toEqual({
      status: 503,
      body: { error: "unavailable" },
    });
    expect(state.accepted).toHaveLength(0);
  });
  it("limits five attempts per visitor per hour", async () => {
    const { state, send } = setup();
    for (let i = 0; i < 5; i++) expect((await send(post())).status).toBe(202);
    const limited = await send(post());
    expect(await read(limited.clone())).toEqual({
      status: 429,
      body: { error: "limited" },
    });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(state.accepted).toHaveLength(5);
  });
  it("reports blocked spam checks and missing tokens as blocked", async () => {
    const { state, turnstile, send } = setup();
    turnstile.mockResolvedValueOnce("blocked" as never);
    expect(await read(await send(post()))).toEqual({
      status: 403,
      body: { error: "blocked" },
    });
    expect((await send(post({ ...fields, token: "" }))).status).toBe(403);
    expect(state.accepted).toHaveLength(0);
    // Blocked attempts still count against the visitor's hourly limit.
    expect(state.count).toBe(2);
  });
  it("never reports success when Turnstile or D1 is unavailable", async () => {
    const { turnstile, send } = setup();
    turnstile.mockResolvedValueOnce("unavailable" as never);
    expect((await send(post())).status).toBe(503);
    const broken = setup({ fail: true });
    expect(await read(await broken.send(post()))).toEqual({
      status: 503,
      body: { error: "failed" },
    });
  });
  it("reports an exhausted daily allowance as limited", async () => {
    const { state, send } = setup({ allowance: false });
    const response = await send(post());
    expect(await read(response.clone())).toEqual({
      status: 429,
      body: { error: "limited" },
    });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(state.accepted).toHaveLength(0);
  });
});

describe("Turnstile verification", () => {
  const answer = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>(async () => Response.json(body, { status }));
  const production: ContactEnv = {
    DB: {} as D1Database,
    APP_ENV: "production",
    TURNSTILE_SECRET: "secret",
    TURNSTILE_VERIFY_ORIGIN: "http://127.0.0.1:1",
  };
  it("posts the token to Cloudflare, ignoring a fixture origin in production", async () => {
    const transport = answer({
      success: true,
      hostname: host,
      action: "contact",
    });
    expect(
      await verifyTurnstile(production, "tok", "203.0.113.9", host, transport),
    ).toBe("passed");
    const [url, init] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    const form = init.body as URLSearchParams;
    expect(form.get("secret")).toBe("secret");
    expect(form.get("response")).toBe("tok");
    expect(form.get("remoteip")).toBe("203.0.113.9");
  });
  it("blocks failed tokens and tokens solved for another host or action", async () => {
    for (const body of [
      { success: false, "error-codes": ["invalid-input-response"] },
      { success: true, hostname: "bob.hasaweb.site", action: "contact" },
      { success: true, hostname: host, action: "login" },
    ])
      expect(
        await verifyTurnstile(production, "tok", null, host, answer(body)),
      ).toBe("blocked");
  });
  it("treats its own failures as unavailable, not as spam", async () => {
    expect(
      await verifyTurnstile(
        { DB: production.DB, APP_ENV: "production" },
        "tok",
        null,
        host,
      ),
    ).toBe("unavailable");
    expect(
      await verifyTurnstile(production, "tok", null, host, answer({}, 500)),
    ).toBe("unavailable");
    expect(
      await verifyTurnstile(
        production,
        "tok",
        null,
        host,
        answer({ success: false, "error-codes": ["internal-error"] }),
      ),
    ).toBe("unavailable");
    expect(
      await verifyTurnstile(production, "tok", null, host, async () => {
        throw new Error("timeout");
      }),
    ).toBe("unavailable");
  });
  it("uses the stand-in only in local and test", async () => {
    const transport = answer({ success: true, hostname: "example.com" });
    expect(
      await verifyTurnstile(
        { ...production, APP_ENV: "test" },
        "tok",
        null,
        host,
        transport,
      ),
    ).toBe("passed");
    expect(transport.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:1/turnstile/v0/siteverify",
    );
  });
});
