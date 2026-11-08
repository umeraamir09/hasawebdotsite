import { createServer } from "node:http";

// A local stand-in for the GitHub endpoints the public graph service calls.
// It enforces the platform credential and answers with the same envelopes the
// production classifier parses, including the empty `X-OAuth-Scopes` header.
// No test fixture ever sees a real token or account.
export const PLATFORM_TOKEN = "platform-fixture-token";
const platform = { id: "platform-node", login: "platform-account" };

export async function startGitHubFixture(port) {
  const users = new Map();
  const state = { failure: null, calls: [] };
  function addUser({
    login,
    id = `node-${login.toLowerCase()}`,
    databaseId,
    restricted = 0,
    counts = {},
  }) {
    users.set(login.toLowerCase(), {
      login,
      id,
      databaseId: databaseId ?? users.size + 1000,
      restricted,
      counts,
    });
    return users.get(login.toLowerCase());
  }
  function weeks(range, counts) {
    const out = [];
    const end = Date.parse(range.to.slice(0, 10));
    let week = [];
    for (let at = Date.parse(range.from.slice(0, 10)); at <= end; at += 864e5) {
      const date = new Date(at).toISOString().slice(0, 10);
      week.push({ date, contributionCount: counts[date] ?? 0 });
      if (new Date(at).getUTCDay() === 6) {
        out.push({ contributionDays: week });
        week = [];
      }
    }
    if (week.length) out.push({ contributionDays: week });
    return out;
  }
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const send = (status, value) => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "X-OAuth-Scopes": "",
        });
        response.end(JSON.stringify(value));
      };
      const authorized =
        request.headers.authorization === `Bearer ${PLATFORM_TOKEN}`;
      const url = new URL(request.url, "http://fixture");
      if (url.pathname === "/graphql" && request.method === "POST") {
        const input = JSON.parse(body || "{}");
        const kind = String(input.query).includes("ResolveLogin")
          ? "resolve"
          : "activity";
        const login = String(input.variables?.login ?? "");
        state.calls.push({ kind, login, authorized });
        if (!authorized) return send(401, { message: "Bad credentials" });
        if (state.failure) return send(state.failure, {});
        const user = users.get(login.toLowerCase());
        if (!user)
          return send(200, {
            data: { viewer: platform, user: null },
            errors: [{ type: "NOT_FOUND", path: ["user"] }],
          });
        if (kind === "resolve")
          return send(200, {
            data: {
              viewer: platform,
              user: { id: user.id, login: user.login },
            },
          });
        return send(200, {
          data: {
            viewer: platform,
            user: {
              id: user.id,
              login: user.login,
              contributionsCollection: {
                restrictedContributionsCount: user.restricted,
                contributionCalendar: {
                  weeks: weeks(input.variables, user.counts),
                },
              },
            },
          },
        });
      }
      const byId = /^\/user\/(\d+)$/.exec(url.pathname);
      if (byId && request.method === "GET") {
        state.calls.push({ kind: "user", id: byId[1], authorized });
        if (!authorized) return send(401, {});
        const user = [...users.values()].find(
          (item) => String(item.databaseId) === byId[1],
        );
        return user
          ? send(200, { id: user.databaseId, login: user.login, type: "User" })
          : send(404, {});
      }
      send(404, {});
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${port}`,
    addUser,
    state,
    users,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
