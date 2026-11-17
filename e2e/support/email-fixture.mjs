import { createServer } from "node:http";

// A local stand-in for Resend's send endpoint. The jobs Worker's real
// `ResendProvider` posts here in tests (`RESEND_API_ORIGIN`), so checks see the
// exact envelopes it sends. No real account, key or mailbox is involved.
export const RESEND_FIXTURE_KEY = "resend-fixture-key";
export const EMAIL_FROM = "hello@mail.hasaweb.site";

export async function startEmailFixture(port) {
  // `failure` answers every send with { status, name } until cleared.
  const state = { failure: null, sent: [] };
  const seen = new Map();
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const send = (status, value) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.method !== "POST" || request.url !== "/emails")
        return send(404, {});
      if (request.headers.authorization !== `Bearer ${RESEND_FIXTURE_KEY}`)
        return send(401, { name: "missing_api_key" });
      if (state.failure)
        return send(state.failure.status, { name: state.failure.name });
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
