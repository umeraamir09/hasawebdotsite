import { createServer } from "node:http";

// A local stand-in for Turnstile's siteverify endpoint. The site handler's
// real verifier posts here in tests (`TURNSTILE_VERIFY_ORIGIN`). Tokens that
// start with `pass` succeed once; anything else, or a reused token, fails.
export const TURNSTILE_FIXTURE_SECRET = "turnstile-fixture-secret";
export const TURNSTILE_FIXTURE_SITE_KEY = "turnstile-fixture-site-key";

export async function startTurnstileFixture(port) {
  const state = { verified: [], used: new Set() };
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
      if (
        request.method !== "POST" ||
        request.url !== "/turnstile/v0/siteverify"
      )
        return send(404, {});
      const form = new URLSearchParams(body);
      const token = form.get("response") ?? "";
      state.verified.push({ token, remoteip: form.get("remoteip") });
      if (form.get("secret") !== TURNSTILE_FIXTURE_SECRET)
        return send(200, {
          success: false,
          "error-codes": ["invalid-input-secret"],
        });
      if (!token.startsWith("pass") || state.used.has(token))
        return send(200, {
          success: false,
          "error-codes": [
            state.used.has(token)
              ? "timeout-or-duplicate"
              : "invalid-input-response",
          ],
        });
      state.used.add(token);
      send(200, { success: true, hostname: "example.com", action: "contact" });
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
