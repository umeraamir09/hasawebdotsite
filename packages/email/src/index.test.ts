import { describe, expect, it } from "vitest";
import {
  ConsoleProvider,
  contactEmail,
  type Email,
  emailProvider,
  failureNotice,
  ResendProvider,
  type Transport,
  verificationEmail,
  verificationUrl,
} from "./index";

const ORIGIN = "https://hasaweb.site";
const TOKEN = "a".repeat(43);
const messages: Email[] = [
  verificationEmail(
    "owner@example.com",
    verificationUrl(ORIGIN, TOKEN),
    ORIGIN,
  ),
  contactEmail("owner@example.com", {
    name: "<script>alert(1)</script>\nBcc: nobody@example.com",
    email: "visitor@example.com",
    message: "<img src=x onerror=alert(1)> & plain text",
  }),
  failureNotice("owner@example.com"),
];
const verification = messages[0] as Email;
const resend = (transport: Transport, extra = {}) =>
  new ResendProvider({
    apiKey: "fixture",
    from: "hello@mail.hasaweb.site",
    transport,
    ...extra,
  });

describe("ResendProvider", () => {
  it.each(messages)(
    "sends $kind as plain text to one recipient from the fixed sender",
    async (email) => {
      let url = "";
      let envelope: Record<string, unknown> = {};
      let headers = new Headers();
      let redirect: string | undefined;
      const result = await resend(async (input, init) => {
        url = String(input);
        redirect = init?.redirect;
        envelope = JSON.parse(String(init?.body));
        headers = new Headers(init?.headers);
        return Response.json({ id: "fixture-id" });
      }).send(email, `fixture/${email.kind}`);
      expect(result).toEqual({ status: "accepted", id: "fixture-id" });
      expect(url).toBe("https://api.resend.com/emails");
      expect(envelope.from).toBe("hello@mail.hasaweb.site");
      expect(envelope.to).toEqual(["owner@example.com"]);
      expect(envelope.text).toBe(email.text);
      expect(envelope).not.toHaveProperty("html");
      expect(envelope.reply_to).toBe(email.replyTo);
      expect(headers.get("Idempotency-Key")).toBe(`fixture/${email.kind}`);
      // Workers fetch supports only "follow" and "manual".
      expect(redirect).toBe("manual");
    },
  );

  it.each([
    [400, "validation_error", "rejected"],
    [401, "missing_api_key", "rejected"],
    [403, "validation_error", "rejected"],
    [422, "validation_error", "rejected"],
    [409, "invalid_idempotent_request", "rejected"],
    [409, "concurrent_idempotent_requests", "retry"],
    [409, "resource_locked", "retry"],
    [429, "rate_limit_exceeded", "retry"],
    [429, "daily_quota_exceeded", "quota"],
    [429, "monthly_quota_exceeded", "quota"],
    [500, "application_error", "retry"],
    [503, "service_unavailable", "retry"],
  ] as const)(
    "maps %i %s to %s without keeping provider text",
    async (status, name, expected) => {
      const result = await resend(async () =>
        Response.json(
          { name, message: "PRIVATE visitor@example.com token=secret" },
          { status, headers: { "Retry-After": "600" } },
        ),
      ).send(verification, "fixture");
      expect(result.status).toBe(expected);
      expect(result).toMatchObject({ code: name, retryAfterMs: 600_000 });
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    },
  );

  it.each<[string, Transport]>([
    [
      "network",
      async () => {
        throw new Error("PRIVATE");
      },
    ],
    ["malformed success", async () => new Response("not json")],
    ["null success", async () => Response.json(null)],
    [
      "malformed rejection",
      async () => new Response("PRIVATE", { status: 403 }),
    ],
    [
      "unknown provider error",
      async () => Response.json({ name: "PRIVATE" }, { status: 500 }),
    ],
  ])("%s never claims acceptance or leaks data", async (_label, transport) => {
    const result = await resend(transport).send(verification, "fixture");
    expect(result.status).not.toBe("accepted");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("times out as an ambiguous, retryable failure", async () => {
    const result = await resend(
      async (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
      { timeoutMs: 5 },
    ).send(verification, "fixture");
    expect(result).toMatchObject({ status: "retry", code: "timeout" });
  });

  it("respects an HTTP-date Retry-After", async () => {
    const result = await resend(
      async () =>
        Response.json(
          { name: "rate_limit_exceeded" },
          {
            status: 429,
            headers: { "Retry-After": "Fri, 16 Oct 2026 00:09:59 GMT" },
          },
        ),
      { now: () => Date.parse("2026-10-15T23:59:59Z") },
    ).send(verification, "fixture");
    expect(result).toMatchObject({ status: "retry", retryAfterMs: 600_000 });
  });

  it("replays an idempotency key without a second send", async () => {
    let sends = 0;
    let lose = false;
    const seen = new Map<string, { body: string; id: string }>();
    const provider = resend(async (_url, init) => {
      const key = new Headers(init?.headers).get("Idempotency-Key") as string;
      const body = String(init?.body);
      const previous = seen.get(key);
      let response: Response;
      if (previous && previous.body !== body)
        response = Response.json(
          { name: "invalid_idempotent_request" },
          { status: 409 },
        );
      else if (previous) response = Response.json({ id: previous.id });
      else {
        const id = `fixture-${++sends}`;
        seen.set(key, { body, id });
        response = Response.json({ id });
      }
      if (lose) {
        lose = false;
        throw new Error("connection lost after provider acceptance");
      }
      return response;
    });
    const first = await provider.send(verification, "same-key");
    expect(await provider.send(verification, "same-key")).toEqual(first);
    expect((await provider.send(messages[2] as Email, "same-key")).status).toBe(
      "rejected",
    );
    lose = true;
    expect((await provider.send(verification, "lost")).status).toBe("retry");
    expect((await provider.send(verification, "lost")).status).toBe("accepted");
    expect(sends).toBe(2);
  });

  it.each([
    { ...verification, to: "owner@example.com,second@example.com" },
    { ...verification, subject: "Header\r\nBcc: hidden@example.com" },
    {
      ...(messages[1] as Email),
      replyTo: "visitor@example.com\r\nBcc: hidden@example.com",
    },
  ])("rejects an unsafe envelope before sending", async (email) => {
    let sent = false;
    await expect(
      resend(async () => {
        sent = true;
        return Response.json({ id: "x" });
      }).send(email, "bad"),
    ).rejects.toThrow();
    expect(sent).toBe(false);
  });
});

describe("verification links", () => {
  it("keeps the token in the fragment on the application origin", () => {
    const url = verificationUrl("http://127.0.0.1:8787/editor", TOKEN);
    expect(url).toBe(
      `http://127.0.0.1:8787/settings/contact/verify#token=${TOKEN}`,
    );
    expect(
      verificationEmail("o@example.com", url, "http://127.0.0.1:8787").text,
    ).toContain(url);
  });
  it("refuses other origins, paths and query tokens", () => {
    for (const url of [
      `https://evil.test/settings/contact/verify#token=${TOKEN}`,
      `${ORIGIN}/other#token=${TOKEN}`,
      `${ORIGIN}/settings/contact/verify?token=${TOKEN}`,
    ])
      expect(() => verificationEmail("o@example.com", url, ORIGIN)).toThrow();
    expect(() => verificationUrl(ORIGIN, "short")).toThrow();
  });
});

describe("emailProvider", () => {
  it("uses Resend when configured and honours a fixture origin only in tests", async () => {
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ id: "x" });
    }) as typeof fetch;
    try {
      const config = {
        RESEND_API_KEY: "key",
        EMAIL_FROM: "hello@mail.hasaweb.site",
        RESEND_API_ORIGIN: "http://127.0.0.1:9999",
      };
      await emailProvider({ ...config, APP_ENV: "test" })?.send(
        verification,
        "k",
      );
      await emailProvider({ ...config, APP_ENV: "production" })?.send(
        verification,
        "k",
      );
    } finally {
      globalThis.fetch = original;
    }
    expect(urls).toEqual([
      "http://127.0.0.1:9999/emails",
      "https://api.resend.com/emails",
    ]);
  });
  it("falls back to the console sink only in development", async () => {
    const written: Email[] = [];
    const provider = emailProvider({ APP_ENV: "local" }, (email) =>
      written.push(email),
    );
    expect(provider).toBeInstanceOf(ConsoleProvider);
    for (const email of messages)
      await provider?.send(email, `local/${email.kind}`);
    expect(written).toHaveLength(3);
    expect(emailProvider({ APP_ENV: "production" })).toBeNull();
  });
});
