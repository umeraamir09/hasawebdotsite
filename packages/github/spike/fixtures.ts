import {
  ACTIVITY_SCOPES,
  applyRefresh,
  decryptToken,
  enable,
  encryptToken,
  fetchCalendar,
  type Identity,
  ProviderError,
  publicResponse,
  QUERY,
  refreshDue,
  SIGN_IN_SCOPES,
  type State,
  SWEEP_INTERVAL,
  select,
  type Transport,
  VISIT_TTL,
  withdraw,
} from "./permissions";

const alice = { id: "U_ALICE", login: "alice" };
const bob = { id: "U_BOB", login: "bob" };
const platform = { id: "U_PLATFORM", login: "platform" };
const fetchedAt = "2026-10-15T00:00:00.000Z";
const range = { from: "2026-10-14T00:00:00Z", to: "2026-10-15T23:59:59Z" };
export function initial(): State {
  return {
    selected: alice,
    generation: 0,
    enabled: false,
    grant: null,
    tokenEnc: null,
    status: "disconnected",
    authorizedCalendar: null,
    error: null,
    publicCalendar: { days: [{ date: "2026-10-14", count: 2 }], fetchedAt },
  };
}
function payload(viewer: Identity, count = 7, restricted = 5) {
  return {
    data: {
      viewer,
      user: {
        ...alice,
        contributionsCollection: {
          restrictedContributionsCount: restricted,
          contributionCalendar: {
            weeks: [
              {
                contributionDays: [
                  { date: "2026-10-14", contributionCount: count },
                ],
              },
            ],
          },
          // Canary fields must never survive projection, even if a provider sends extras.
          repository: { name: "SECRET_REPOSITORY", code: "SECRET_CODE" },
        },
      },
    },
  };
}
type FixtureOptions = {
  status?: number;
  scope?: string;
  body?: unknown;
  network?: boolean;
};
function fixture(options: FixtureOptions = {}): Transport {
  return async (url, init) => {
    assert(url === "https://api.github.com/graphql", "provider URL");
    assert(
      init.method === "POST" && init.redirect === "error",
      "provider request",
    );
    const request = JSON.parse(String(init.body));
    assert(
      request.query === QUERY && request.variables.login === "alice",
      "query variables",
    );
    assert(
      !/repository|email|commit|issue|pullRequest/i.test(request.query),
      "counts-only query",
    );
    if (options.network) throw new Error("SECRET_PROVIDER_ERROR");
    return Response.json(options.body ?? payload(alice), {
      status: options.status ?? 200,
      headers: { "X-OAuth-Scopes": options.scope ?? "read:user" },
    });
  };
}
function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
async function rejects(run: () => unknown | Promise<unknown>, kind?: string) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error, "expected rejection");
  if (kind)
    assert(
      caught instanceof ProviderError && caught.kind === kind,
      "failure kind",
    );
}
function active() {
  return enable(initial(), true, alice, "read:user", "encrypted-fixture-token");
}
export async function runFixtures() {
  const checks: { name: string; passed: true }[] = [];
  async function check(name: string, run: () => unknown | Promise<unknown>) {
    await run();
    checks.push({ name, passed: true });
  }
  const load = (options: FixtureOptions = {}, privateActivity = true) =>
    fetchCalendar(
      fixture(options),
      "fixture-token",
      alice,
      range,
      privateActivity,
      fetchedAt,
    );
  await check("sign-in and activity request separate narrow scopes", () => {
    assert(SIGN_IN_SCOPES.join() === "user:email", "sign-in scopes");
    assert(ACTIVITY_SCOPES.join() === "read:user", "activity scopes");
  });
  await check("explicit consent is required", () =>
    rejects(
      () => enable(initial(), false, alice, "read:user", "cipher"),
      "reconnect",
    ),
  );
  for (const [label, grant] of [
    ["different username", bob],
    ["reused username with different stable ID", { ...alice, id: "OTHER" }],
  ] as const)
    await check(`${label} cannot authorize private activity`, () =>
      rejects(
        () => enable(initial(), true, grant, "read:user", "cipher"),
        "reconnect",
      ),
    );
  for (const scopes of ["", "user:email", "repo,read:user", "user"])
    await check(`reject insufficient or excessive scope '${scopes}'`, () =>
      rejects(
        () => enable(initial(), true, alice, scopes, "cipher"),
        "reconnect",
      ),
    );
  await check("matching login is case insensitive with exact stable ID", () => {
    assert(
      enable(
        initial(),
        true,
        { ...alice, login: "Alice" },
        "read:user",
        "cipher",
      ).enabled,
      "case",
    );
  });
  const calendar = await load();
  assert(calendar, "calendar");
  const good = applyRefresh(active(), 1, calendar);
  await check(
    "matching private response renders only anonymized date/count data",
    async () => {
      const response = publicResponse(good);
      const output = await response.text();
      assert(
        !/SECRET|token|repository|scope|grant/i.test(output),
        "private leak",
      );
      const data = JSON.parse(output);
      assert(
        data.days[0].count === 7 &&
          data.username === "alice" &&
          data.profileUrl === "https://github.com/alice",
        "private calendar",
      );
      assert(
        response.headers.get("Cache-Control") === "no-store",
        "cache control",
      );
    },
  );
  await check("zero contributions is a successful fetch", async () => {
    assert(
      (await load({ body: payload(alice, 0, 0) }))?.days[0]?.count === 0,
      "zero",
    );
  });
  await check(
    "public calendar with no restricted contributions is usable",
    async () => {
      assert(
        (await load({ scope: "", body: payload(platform, 2, 0) }, false))
          ?.days[0]?.count === 2,
        "public",
      );
    },
  );
  await check(
    "public calendar containing restricted contributions is unavailable",
    async () => {
      assert(
        (await load({ scope: "", body: payload(platform) }, false)) === null,
        "restricted baseline",
      );
    },
  );
  await check("public baseline refuses a broadly scoped platform token", () =>
    rejects(
      () => load({ scope: "repo", body: payload(platform, 7, 0) }, false),
      "invalid",
    ),
  );
  await check("public baseline refuses target account's own token", () =>
    rejects(
      () => load({ scope: "", body: payload(alice, 7, 0) }, false),
      "invalid",
    ),
  );
  await check("provider viewer mismatch rejects private data", () =>
    rejects(() => load({ body: payload(bob) }), "reconnect"),
  );
  await check("provider selected identity change rejects private data", () => {
    const body = payload(alice);
    body.data.user.id = "RECYCLED";
    return rejects(() => load({ body }), "reconnect");
  });
  for (const [name, options, kind] of [
    ["revoked token", { status: 401 }, "reconnect"],
    ["removed scope", { scope: "user:email" }, "reconnect"],
    ["rate limit", { status: 403 }, "retry"],
    ["secondary rate limit", { status: 429 }, "retry"],
    ["server failure", { status: 503 }, "retry"],
    ["network failure", { network: true }, "retry"],
    [
      "GraphQL partial error",
      {
        body: {
          ...payload(alice),
          errors: [{ message: "SECRET_PROVIDER_ERROR" }],
        },
      },
      "retry",
    ],
    ["malformed response", { body: { data: {} } }, "invalid"],
  ] as const)
    await check(`${name} has safe recovery behavior`, async () => {
      await rejects(() => load(options), kind);
      const state = applyRefresh(
        good,
        good.generation,
        new ProviderError(kind),
      );
      if (kind === "reconnect") {
        assert(
          !state.enabled && !state.tokenEnc && !state.authorizedCalendar,
          "revocation cleanup",
        );
        assert(
          (
            (await publicResponse(state).json()) as {
              days: { count: number }[];
            }
          ).days[0]?.count === 2,
          "public fallback",
        );
      } else {
        assert(
          state.authorizedCalendar === calendar &&
            state.authorizedCalendar.fetchedAt === fetchedAt,
          "retain graph/date",
        );
      }
    });
  for (const invalid of [-1, 1.5, "7", Number.MAX_SAFE_INTEGER + 1])
    await check(`malformed contribution count ${invalid} is rejected`, () => {
      const body = payload(alice);
      const day =
        body.data.user.contributionsCollection.contributionCalendar.weeks[0]
          ?.contributionDays[0];
      assert(day, "fixture day");
      Object.assign(day, { contributionCount: invalid });
      return rejects(() => load({ body }), "invalid");
    });
  await check(
    "disconnect clears grant, token, and private calendar without Publish",
    async () => {
      const state = withdraw(good);
      assert(
        !state.enabled &&
          !state.grant &&
          !state.tokenEnc &&
          !state.authorizedCalendar,
        "disconnect",
      );
      assert(
        !JSON.stringify(await publicResponse(state).json()).includes(
          '"count":7',
        ),
        "private removed",
      );
    },
  );
  await check(
    "revocation without safe baseline returns unavailable",
    async () => {
      const state = withdraw(
        { ...good, publicCalendar: null },
        "needs_reconnect",
      );
      assert(
        !((await publicResponse(state).json()) as { available: boolean })
          .available,
        "unavailable",
      );
    },
  );
  await check(
    "username change clears both calendars and disables private activity",
    () => {
      const state = select(good, bob);
      assert(
        !state.enabled &&
          !state.publicCalendar &&
          !state.authorizedCalendar &&
          !state.tokenEnc,
        "username change",
      );
    },
  );
  for (const [name, current] of [
    ["disconnect", withdraw(good)],
    ["username change", select(good, bob)],
    [
      "reconnect",
      enable(withdraw(good), true, alice, "read:user", "new-cipher"),
    ],
  ] as const)
    await check(`in-flight refresh cannot undo ${name}`, () => {
      assert(
        applyRefresh(current, good.generation, calendar) === current,
        "stale generation",
      );
      assert(
        applyRefresh(
          current,
          good.generation,
          new ProviderError("reconnect"),
        ) === current,
        "stale error",
      );
    });
  for (const mode of ["visit", "sweep"] as const)
    await check(
      `${mode} detects fixture revocation at configured interval`,
      async () => {
        const interval = mode === "visit" ? VISIT_TTL : SWEEP_INTERVAL;
        assert(
          !refreshDue(0, interval - 1, mode, true) &&
            refreshDue(0, interval, mode, true),
          "interval",
        );
        await rejects(() => load({ status: 401 }), "reconnect");
        const state = applyRefresh(
          good,
          good.generation,
          new ProviderError("reconnect"),
        );
        assert(
          !state.enabled && !refreshDue(0, interval, "sweep", state.enabled),
          "stop private sweep",
        );
      },
    );
  await check(
    "AES-GCM encrypts with unique IV and binds token to owner/grant",
    async () => {
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      assert("algorithm" in key, "symmetric encryption key");
      const first = await encryptToken(
        key,
        "SECRET_TOKEN",
        "portfolio:alice:1",
      );
      const second = await encryptToken(
        key,
        "SECRET_TOKEN",
        "portfolio:alice:1",
      );
      assert(first !== second && !first.includes("SECRET_TOKEN"), "encryption");
      assert(
        (await decryptToken(key, first, "portfolio:alice:1")) ===
          "SECRET_TOKEN",
        "decryption",
      );
      await rejects(() => decryptToken(key, first, "portfolio:bob:1"));
      const wrongKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      assert("algorithm" in wrongKey, "symmetric decryption key");
      await rejects(() => decryptToken(wrongKey, first, "portfolio:alice:1"));
    },
  );
  return checks;
}
