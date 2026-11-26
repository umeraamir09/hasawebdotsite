import assert from "node:assert/strict";

// Phase 47: connected sign-in providers through the shipped auth handler, the
// real owner router and Better Auth's OAuth state, with provider HTTP fixtures.
export async function checkConnectedProviders({
  check,
  login,
  request,
  callback,
  counts,
  identity,
  Jar,
  origin,
}) {
  const returns = {
    callbackURL: `${origin}/editor?account=connected`,
    errorCallbackURL: `${origin}/editor?account=not-connected`,
  };
  const beginLink = (provider, jar, body = returns) =>
    request("/api/auth/link-social", jar, { provider, ...body });
  const providers = async (jar) => {
    const response = await request("/api/owner/providers", jar);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const text = await response.text();
    assert.doesNotMatch(text, /email|accountId|token|link-/);
    return Object.fromEntries(
      JSON.parse(text).providers.map((item) => [item.provider, item.connected]),
    );
  };
  const disconnect = (provider, owner, expected = owner.data.user.id) =>
    request(
      "/api/owner/providers/disconnect",
      owner.jar,
      { provider },
      expected === null ? {} : { "X-Expected-Owner-Id": expected },
    );
  const entry = async (jar) => {
    const response = await request("/api/owner/entry", jar, {});
    assert.equal(response.status, 200);
    return response.json();
  };
  // Starts linking and completes the provider step with a fixture account.
  async function link(provider, owner, code, jar = owner.jar) {
    const started = await beginLink(provider, owner.jar);
    assert.equal(started.status, 200);
    const { url } = await started.json();
    const authorization = new URL(url);
    assert.equal(
      authorization.origin,
      provider === "github"
        ? "https://github.com"
        : "https://accounts.google.com",
    );
    assert.equal(
      authorization.searchParams.get("redirect_uri"),
      `${origin}/api/auth/callback/${provider}`,
    );
    assert.deepEqual(
      authorization.searchParams.get("scope").split(" ").sort(),
      provider === "github"
        ? ["read:user", "user:email"]
        : ["email", "openid", "profile"],
    );
    const completed = await callback(provider, jar, url, code);
    assert.equal(completed.status, 302);
    return new URL(completed.headers.get("location"));
  }

  let owner;
  let saved;
  await check(
    "providers: settings list sign-in providers; linking needs a signed-in owner and the fixed editor returns",
    async () => {
      owner = await login("google", "linkOwner");
      assert.equal((await entry(owner.jar)).entry.kind, "setup");
      assert.equal(
        (await request("/__fixture/editor-entry", owner.jar, {})).status,
        200,
      );
      saved = await entry(owner.jar);
      assert.equal(saved.entry.kind, "editor");
      assert.deepEqual(await providers(owner.jar), {
        github: false,
        google: true,
      });
      assert.equal((await request("/api/owner/providers")).status, 401);
      assert.equal((await beginLink("github", new Jar())).status, 401);
      const already = await beginLink("google", owner.jar);
      assert.equal(already.status, 409);
      assert.deepEqual(await already.json(), { error: "already_connected" });
      for (const body of [
        { ...returns, callbackURL: `${origin}/auth/entry` },
        { ...returns, errorCallbackURL: `${origin}/sign-in?provider=github` },
        { ...returns, callbackURL: "https://evil.example/editor" },
      ])
        assert.equal((await beginLink("github", owner.jar, body)).status, 403);
      for (const body of [
        { ...returns, scopes: ["repo"] },
        { ...returns, idToken: { token: "forged" } },
      ])
        assert.equal((await beginLink("github", owner.jar, body)).status, 400);
    },
  );
  await check(
    "providers: linking adds a provider only after completed OAuth; cancellation, another browser and replay link nothing",
    async () => {
      // A second session for the owner and another owner, made up front.
      const otherSession = await login("google", "linkOwner");
      const intruder = await login("google", "linkSecond");
      const before = await counts();
      const cancelled = await beginLink("github", owner.jar);
      const cancelledUrl = (await cancelled.json()).url;
      const denied = new URL(
        (
          await callback("github", owner.jar, cancelledUrl, "", {
            error: "access_denied",
          })
        ).headers.get("location"),
      );
      assert.equal(`${denied.origin}${denied.pathname}`, `${origin}/editor`);
      assert.equal(denied.searchParams.get("account"), "not-connected");
      assert.equal(denied.searchParams.get("error"), "access_denied");
      // The state cookie binds the flow to the browser that started it.
      const foreign = await link("github", owner, "linkOther", new Jar());
      assert.ok(foreign.searchParams.has("error"));
      assert.deepEqual(await counts(), before);
      assert.equal((await providers(owner.jar)).github, false);

      // A flow left open across sign-out, or finished after another owner
      // signed in on the same browser, links nothing.
      const signedOut = otherSession.jar;
      const abandoned = await (await beginLink("github", signedOut)).json();
      assert.equal(
        (await request("/api/auth/sign-out", signedOut, {})).status,
        200,
      );
      const afterSignOut = new URL(
        (
          await callback("github", signedOut, abandoned.url, "linkOther")
        ).headers.get("location"),
      );
      assert.equal(afterSignOut.searchParams.get("account"), "not-connected");
      // The account hook refused it; the OAuth state itself was valid.
      assert.equal(
        afterSignOut.searchParams.get("error"),
        "unable_to_link_account",
      );
      const switched = owner.jar.clone();
      const pending = await (await beginLink("github", switched)).json();
      for (const [name, value] of intruder.jar.values)
        if (!name.includes("state")) switched.values.set(name, value);
      const afterSwitch = new URL(
        (
          await callback("github", switched, pending.url, "linkOther")
        ).headers.get("location"),
      );
      assert.equal(afterSwitch.searchParams.get("account"), "not-connected");
      // The account hook refused it; the OAuth state itself was valid.
      assert.equal(
        afterSwitch.searchParams.get("error"),
        "unable_to_link_account",
      );
      assert.equal((await counts()).account, before.account);
      assert.equal((await providers(owner.jar)).github, false);
      assert.equal((await providers(intruder.jar)).github, false);

      // A different, provider-verified email links once ownership is proven.
      const started = await beginLink("github", owner.jar);
      const { url } = await started.json();
      const replay = owner.jar.clone();
      const completed = await callback("github", owner.jar, url, "linkOther");
      assert.equal(
        completed.headers.get("location"),
        `${origin}/editor?account=connected`,
      );
      assert.deepEqual(await providers(owner.jar), {
        github: true,
        google: true,
      });
      const after = await counts();
      assert.equal(after.user, before.user);
      assert.equal(after.account, before.account + 1);
      assert.equal((await identity(owner.jar)).user.id, owner.data.user.id);
      const replayed = await callback("github", replay, url, "linkOther");
      assert.ok(
        new URL(replayed.headers.get("location")).searchParams.has("error"),
      );
      assert.deepEqual(await counts(), after);
    },
  );
  await check(
    "providers: each connected provider reopens the same editor portfolio without setup",
    async () => {
      for (const [provider, code] of [
        ["github", "linkOther"],
        ["google", "linkOwner"],
      ]) {
        const signedIn = await login(provider, code);
        assert.equal(signedIn.data.user.id, owner.data.user.id);
        assert.deepEqual(await entry(signedIn.jar), saved);
      }
    },
  );
  await check(
    "providers: linking cannot take another owner's account, an unverified account or a second account for one provider",
    async () => {
      const second = await login("google", "linkSecond");
      await login("github", "linkTaken");
      const before = await counts();
      const taken = await link("github", second, "linkTaken");
      assert.equal(
        taken.searchParams.get("error"),
        "account_already_linked_to_different_user",
      );
      const unverified = await link("github", second, "linkUnverified");
      assert.equal(unverified.pathname, "/editor");
      assert.equal(unverified.searchParams.get("account"), "not-connected");
      assert.deepEqual(await counts(), before);

      // Two flows started before either finished: only the first links.
      const first = await (await beginLink("github", second.jar)).json();
      const firstJar = second.jar.clone();
      const other = await (await beginLink("github", second.jar)).json();
      assert.equal(
        (
          await callback("github", firstJar, first.url, "linkThird")
        ).headers.get("location"),
        `${origin}/editor?account=connected`,
      );
      const duplicate = new URL(
        (
          await callback("github", second.jar, other.url, "linkFourth")
        ).headers.get("location"),
      );
      assert.equal(duplicate.searchParams.get("account"), "not-connected");
      assert.equal((await counts()).account, before.account + 1);
      assert.equal(
        (await login("github", "linkThird")).data.user.id,
        second.data.user.id,
      );
    },
  );
  await check(
    "providers: disconnect keeps one usable method, reconnect works, and the remaining provider reopens the same editor portfolio",
    async () => {
      assert.equal((await disconnect("github", owner, null)).status, 400);
      const changed = await disconnect("github", owner, "someone-else");
      assert.equal(changed.status, 409);
      assert.deepEqual(await changed.json(), { error: "owner_changed" });
      for (const body of [{}, { provider: "email" }])
        assert.equal(
          (
            await request("/api/owner/providers/disconnect", owner.jar, body, {
              "X-Expected-Owner-Id": owner.data.user.id,
            })
          ).status,
          422,
        );

      // Disconnect GitHub, then Google is the last method.
      assert.equal((await disconnect("github", owner)).status, 200);
      assert.deepEqual(await providers(owner.jar), {
        github: false,
        google: true,
      });
      const last = await disconnect("google", owner);
      assert.equal(last.status, 409);
      assert.deepEqual(await last.json(), { error: "last_method" });
      const gone = await disconnect("github", owner);
      assert.deepEqual(await gone.json(), { error: "not_connected" });
      // The session that disconnected keeps working.
      assert.equal((await identity(owner.jar)).user.id, owner.data.user.id);

      // Reconnect proves the row was removed (the account is free again).
      const reconnected = await link("github", owner, "linkOther");
      assert.equal(reconnected.searchParams.get("account"), "connected");

      // Concurrent disconnects in two tabs leave exactly one method.
      const results = await Promise.all([
        disconnect("github", owner),
        disconnect("google", owner),
      ]);
      assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
      const remaining = Object.entries(await providers(owner.jar)).filter(
        ([, connected]) => connected,
      );
      assert.equal(remaining.length, 1);
      const [provider] = remaining[0];
      const signedIn = await login(
        provider,
        provider === "github" ? "linkOther" : "linkOwner",
      );
      assert.equal(signedIn.data.user.id, owner.data.user.id);
      assert.deepEqual(await entry(signedIn.jar), saved);
    },
  );
  await check(
    "providers: a disconnected provider with the account's email stays disconnected at sign-in until Connect",
    async () => {
      const sticky = await login("google", "stickyGoogle");
      // Same verified email: the existing rule links GitHub at sign-in.
      assert.equal(
        (await login("github", "stickyGithub")).data.user.id,
        sticky.data.user.id,
      );
      const before = await counts();
      assert.equal((await disconnect("github", sticky)).status, 200);
      assert.equal(
        (await counts()).disconnected_provider,
        before.disconnected_provider + 1,
      );
      // A refused removal records nothing.
      assert.equal((await disconnect("google", sticky)).status, 409);
      const marked = await counts();
      assert.equal(
        marked.disconnected_provider,
        before.disconnected_provider + 1,
      );

      // Signing in with it neither links it back nor creates an account.
      const refused = await login("github", "stickyGithub");
      assert.equal(refused.data, null);
      const destination = new URL(refused.completed.headers.get("location"));
      assert.equal(destination.pathname, "/sign-in");
      assert.equal(destination.searchParams.get("provider"), "github");
      assert.equal(
        destination.searchParams.get("error"),
        "unable_to_link_account",
      );
      assert.deepEqual(await counts(), marked);
      assert.deepEqual(await providers(sticky.jar), {
        github: false,
        google: true,
      });

      // Connect from settings links it and ends the disconnect.
      const connected = await link("github", sticky, "stickyGithub");
      assert.equal(connected.searchParams.get("account"), "connected");
      assert.equal(
        (await counts()).disconnected_provider,
        before.disconnected_provider,
      );
      const signedIn = await login("github", "stickyGithub");
      assert.equal(signedIn.data.user.id, sticky.data.user.id);
    },
  );
  await check(
    "providers: Google links only with the account's email; GitHub may use another",
    async () => {
      const githubFirst = await login("github", "matchGithub");
      const before = await counts();
      const mismatch = await link("google", githubFirst, "linkFourth");
      assert.equal(mismatch.pathname, "/editor");
      assert.equal(mismatch.searchParams.get("account"), "not-connected");
      assert.equal(mismatch.searchParams.get("error"), "email_does_not_match");
      assert.deepEqual(await counts(), before);
      assert.equal((await providers(githubFirst.jar)).google, false);
      const matched = await link("google", githubFirst, "matchGoogle");
      assert.equal(matched.searchParams.get("account"), "connected");
      assert.equal(
        (await login("google", "matchGoogle")).data.user.id,
        githubFirst.data.user.id,
      );
    },
  );
}
