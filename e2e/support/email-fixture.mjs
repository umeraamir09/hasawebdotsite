import { createServer } from "node:http";

// A local stand-in for Resend's send endpoint. The jobs Worker's real
// `ResendProvider` posts here in tests (`RESEND_API_ORIGIN`), so checks see the
// exact envelopes it sends. No real account, key or mailbox is involved.
export const RESEND_FIXTURE_KEY = "resend-fixture-key";
export const EMAIL_FROM = "hello@mail.hasaweb.site";

export async function startEmailFixture(port) {
  // `failure` answers sends with { status, name } until cleared: every send,
  // or only those to `failure.to`. `failure.retryAfter` (seconds) adds a
  // Retry-After header. `failed` counts the sends it refused.
  const state = { failure: null, sent: [], failed: 0 };
  const seen = new Map();
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const send = (status, value, headers = {}) => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          ...headers,
        });
        response.end(JSON.stringify(value));
      };
      if (request.method !== "POST" || request.url !== "/emails")
        return send(404, {});
      if (request.headers.authorization !== `Bearer ${RESEND_FIXTURE_KEY}`)
        return send(401, { name: "missing_api_key" });
      const failure = state.failure;
      if (
        failure &&
        (!failure.to || JSON.parse(body).to?.includes(failure.to))
      ) {
        state.failed += 1;
        return send(
          failure.status,
          { name: failure.name },
          failure.retryAfter === undefined
            ? {}
            : { "Retry-After": String(failure.retryAfter) },
        );
      }
      const key = request.headers["idempotency-key"];
      const previous = seen.get(key);
      if (previous) return send(200, { id: previous });
      const id = `fixture-email-${state.sent.length + 1}`;
      seen.set(key, id);
      state.sent.push({ id, key, ...JSON.parse(body) });
      send(200, { id });
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${port}`,
    state,
    /** Sent emails to one address, oldest first. */
    to: (address) => state.sent.filter((email) => email.to.includes(address)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
