import assert from "node:assert/strict";

// Use the shipped owner router, real Better Auth sessions and isolated workerd/D1.
export async function checkPortfolioProvisioning({
  check,
  login,
  request,
  port,
  origin,
}) {
  const path = "/api/owner/portfolio";
  const state = async (owner) =>
    (await request("/__fixture/portfolio-state", owner.jar)).json();
  const initialize = async (owner) => {
    const response = await request(path, owner.jar, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex");
    assert.match(response.headers.get("vary"), /Cookie/);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["portfolio", "user"]);
    assert.deepEqual(Object.keys(body.portfolio), ["id"]);
    assert.deepEqual(Object.keys(body.user).sort(), ["id", "name"]);
    return body;
  };
  const owners = [];
  for (const provider of ["github", "google"]) {
    await check(
      `provision: ${provider} starts empty with approved defaults and keeps provider identity separate`,
      async () => {
        const owner = await login(
          provider,
          provider === "github" ? "provisionGithub" : "provisionGoogle",
        );
        owners.push(owner);
        assert.equal(owner.data.portfolio, null);
        // A read-only session lookup must not provision.
        assert.equal((await state(owner)).portfolio, null);
        const before = (await state(owner)).related;
        const initialized =
          provider === "google"
            ? (
                await Promise.all(
                  Array.from({ length: 8 }, () => initialize(owner)),
                )
              )[0]
            : await initialize(owner);
        assert.equal(initialized.user.id, owner.data.user.id);
        owner.portfolio = initialized.portfolio;
        const stored = await state(owner);
        assert.ok(stored.user.name);
        assert.ok(stored.user.email);
        assert.ok(stored.user.image);
        assert.deepEqual(stored.related, before);
        assert.equal(stored.portfolio.id, owner.portfolio.id);
        assert.equal(stored.portfolio.user_id, owner.data.user.id);
        assert.equal(stored.portfolio.status, "draft");
        assert.equal(stored.portfolio.subdomain, null);
        assert.equal(stored.portfolio.published_version, null);
        assert.equal(stored.portfolio.draft_rev, 0);
        assert.equal(stored.portfolio.draft_validation_version, 2);
        assert.equal(stored.portfolio.first_editor_entered_at, null);
        assert.deepEqual(JSON.parse(stored.portfolio.setup_progress), {
          schemaVersion: 1,
          step: "address",
        });
        assert.deepEqual(JSON.parse(stored.portfolio.draft), {
          schemaVersion: 2,
          profile: { name: "", bio: "", faceReveal: { enabled: false } },
          links: [],
          components: [],
          appearance: {
            themeId: "leaf",
            fontId: "dm-sans",
            colorMode: "system",
          },
          seo: {},
          samples: {},
        });
      },
    );
  }
  const [github, google] = owners;
  await check(
    "provision: repeated concurrent requests and recovery after a lost response preserve one row",
    async () => {
      const before = await state(github);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => initialize(github)),
      );
      for (const result of results)
        assert.deepEqual(result.portfolio, github.portfolio);
      // Drop the successful response, then retry as another tab/device would.
      await request(path, github.jar, {});
      const otherSession = await login("github", "provisionGithub");
      assert.deepEqual(
        (await initialize(otherSession)).portfolio,
        github.portfolio,
      );
      const linkedProvider = await login("google", "provisionGithub");
      assert.deepEqual(
        (await initialize(linkedProvider)).portfolio,
        github.portfolio,
      );
      assert.deepEqual(await state(github), before);
    },
  );
  await check(
    "provision: owner isolation ignores forged headers and query IDs",
    async () => {
      assert.notEqual(github.portfolio.id, google.portfolio.id);
      const response = await request(
        `${path}?userId=${github.data.user.id}&portfolioId=${github.portfolio.id}`,
        google.jar,
        {},
        {
          "X-Owner-ID": github.data.user.id,
          "X-Portfolio-ID": github.portfolio.id,
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).portfolio, google.portfolio);
    },
  );
  await check(
    "provision: invalid JSON, owner input, methods and oversized streams cannot change state",
    async () => {
      const before = await state(github);
      for (const body of [
        [],
        { userId: google.data.user.id },
        { portfolioId: google.portfolio.id },
        { templateId: "another" },
        { profile: { name: "Injected" } },
        { avatar: { accepted: true } },
        { firstEditorEnteredAt: 1 },
        { progress: { step: "review" } },
      ]) {
        assert.equal((await request(path, github.jar, body)).status, 400);
      }
      const headers = {
        Cookie: github.jar.header(),
        Origin: origin,
        "Content-Type": "application/json",
      };
      for (const body of ["null", "true", '""', "{", ""]) {
        assert.equal(
          (
            await fetch(`http://127.0.0.1:${port}${path}`, {
              method: "POST",
              headers,
              body,
            })
          ).status,
          400,
        );
      }
      assert.equal(
        (
          await fetch(`http://127.0.0.1:${port}${path}`, {
            method: "POST",
            headers,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(`{${" ".repeat(1500)}}`),
                );
                controller.close();
              },
            }),
            duplex: "half",
          })
        ).status,
        413,
      );
      for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
        assert.equal(
          (await fetch(`http://127.0.0.1:${port}${path}`, { method, headers }))
            .status,
          405,
        );
      }
      assert.deepEqual(await state(github), before);
    },
  );
  await check(
    "provision: signed-out and foreign origins fail privately without writes",
    async () => {
      const before = await state(github);
      assert.equal((await request(path, undefined, {})).status, 401);
      for (const Origin of [
        "https://alice.hasaweb.site",
        "https://evil.example",
        "null",
        "",
      ]) {
        const response = await request(path, github.jar, {}, { Origin });
        assert.equal(response.status, 403);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
      }
      assert.equal(
        (await request(path, github.jar, {}, { "Content-Type": "text/plain" }))
          .status,
        415,
      );
      assert.equal(
        (
          await request(
            path,
            github.jar,
            {},
            { "X-Fixture-Host": "alice.hasaweb.site" },
          )
        ).status,
        404,
      );
      assert.deepEqual(await state(github), before);
    },
  );
  await check(
    "provision: expiry, sign-out and deleting accounts reject initialization",
    async () => {
      assert.equal(
        (await request("/__fixture/expire", github.jar)).status,
        200,
      );
      assert.equal((await request(path, github.jar, {})).status, 401);
      const renewed = await login("github", "provisionGithub");
      assert.deepEqual((await initialize(renewed)).portfolio, github.portfolio);
      const copied = renewed.jar.clone();
      assert.equal(
        (await request("/api/auth/sign-out", renewed.jar, {})).status,
        200,
      );
      assert.equal((await request(path, copied, {})).status, 401);
      assert.equal(
        (await request("/__fixture/delete", google.jar)).status,
        200,
      );
      assert.equal((await request(path, google.jar, {})).status, 401);
    },
  );
}
