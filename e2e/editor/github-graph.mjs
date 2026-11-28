import assert from "node:assert/strict";
import { join } from "node:path";
import {
  addSection,
  openAccount,
  openChecklist,
  openPanel,
  outline,
} from "./shell.mjs";

const day = (offset) =>
  new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

// Owner draft, preview, publication and visitor journeys for the GitHub
// graph: one account with public and private activity, connected from the
// GitHub sign-in. GitHub itself is a local stand-in (e2e/support/github-fixture).
export async function checkGitHubGraphJourney({
  getPage,
  boot,
  displayed,
  frame,
  sql,
  run,
  authority,
  evidence,
  github,
}) {
  const site = "https://graph-site.hasaweb.site";
  const recent = day(-2);
  const older = day(-40);
  github.addUser({
    login: "Fixture-Owner",
    databaseId: 4242,
    counts: { [recent]: 4, [older]: 1 },
  });
  github.addUser({ login: "zero-owner", databaseId: 5001 });
  github.addUser({
    login: "private-owner",
    databaseId: 5002,
    restricted: 7,
  });
  const publicRead = (url) =>
    authority(
      "/__fixture/public",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method: "GET" }),
      },
      "none",
    );
  const checklist = () => openChecklist(getPage());
  const flush = () =>
    getPage().evaluate(() =>
      window.editorFixture.recovery.store.getState().controller.flushValid(),
    );
  const savedDraft = async () =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'"))[0]
        .draft,
    );
  const savedUsername = async () =>
    (await savedDraft()).components.find((item) => item.type === "github")?.data
      .username;
  const connection = async () =>
    (
      await sql(
        "SELECT login,github_user_id,private_enabled,status,token_enc,last_checked_at FROM github_connection WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
      )
    )[0];
  // The 10-second retry cooldown is real. Age the last check instead of waiting.
  const age = () =>
    sql(
      "UPDATE github_connection SET last_checked_at=last_checked_at-60000 WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
    );
  // Disconnect, a failed connect, and a failed refresh delete the draft section.
  async function draftLostGraph(page) {
    await page.waitForFunction(
      () => {
        const recovery = window.editorFixture?.recovery;
        if (!recovery) return false;
        return !recovery.store
          .getState()
          .controller.store.getState()
          .working.components.some((item) => item.type === "github");
      },
      null,
      { timeout: 30000 },
    );
  }

  async function start(address) {
    await boot();
    const draft = await getPage().evaluate(() =>
      structuredClone(
        window.editorFixture.recovery.store
          .getState()
          .controller.store.getState().working,
      ),
    );
    Object.assign(draft, {
      components: [],
      samples: {},
      seo: {},
      links: [
        {
          id: "website",
          kind: "website",
          label: "My website",
          value: "https://example.com",
          showInProfile: true,
          showInSocialComponent: true,
        },
      ],
      appearance: { themeId: "leaf", fontId: "dm-sans", colorMode: "system" },
    });
    draft.profile = {
      name: "Graph owner",
      bio: "I publish a contribution graph.",
      faceReveal: { enabled: false },
    };
    await boot(draft);
    const page = getPage();
    const image = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        canvas.getContext("2d").fillRect(0, 0, 640, 360);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }),
    );
    for (const purpose of ["avatar", "banner"]) {
      await page
        .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`))
        .setInputFiles({
          name: "owner.png",
          mimeType: "image/png",
          buffer: image,
        });
      await page.getByRole("dialog", { name: `Adjust ${purpose}` }).waitFor();
      await page
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await page
        .getByRole("region", {
          name: `${purpose === "avatar" ? "Avatar" : "Banner"} image`,
          exact: true,
        })
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor();
    }
    await openPanel(page, "Share");
    await page.getByLabel("Address name").fill(address);
    await page
      .getByRole("button", { name: "Save address", exact: true })
      .click();
    await page
      .getByText("Reserved for your portfolio. Your site is still private.", {
        exact: true,
      })
      .waitFor();
    await openPanel(page, "Build");
    // Authorization on GitHub returns to this browser origin.
    github.state.callbackOrigin = new URL(page.url()).origin;
    github.state.consent = { as: null, cancel: false, hold: false };
    return page;
  }
  // GitHub returns to /editor?github=consent, which reopens the section.
  async function reopen() {
    const page = getPage();
    await page.waitForURL(/\/editor(\?github=consent)?$/, { timeout: 60000 });
    await page.waitForFunction(() => window.editorFixture?.ready);
    const controls = page.getByRole("region", {
      name: "GitHub activity controls",
      exact: true,
    });
    await controls.waitFor({ timeout: 30000 });
    return controls;
  }
  async function addGraph(page) {
    await addSection(page, "GitHub activity");
    await (await outline(page))
      .getByRole("button", { name: "GitHub activity", exact: true })
      .click();
    const controls = page.getByRole("region", {
      name: "GitHub activity controls",
      exact: true,
    });
    await controls.waitFor();
    return controls;
  }
  // Link GitHub as a sign-in method for this owner (the graph's only source).
  async function setGithubSignIn(
    login,
    token = github.issueSignInToken(login),
  ) {
    const accountId = String(github.users.get(login.toLowerCase()).databaseId);
    await sql(
      "DELETE FROM account WHERE user_id='draft-alice' AND provider_id='github'",
    );
    await sql(
      "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      [
        "alice-github-graph",
        accountId,
        "github",
        "draft-alice",
        token,
        Date.now(),
        Date.now(),
      ],
    );
  }
  async function openControls(page) {
    await page.getByRole("button", { name: "Build", exact: true }).click();
    await (await outline(page))
      .getByRole("button", { name: "GitHub activity", exact: true })
      .click();
    const controls = page.getByRole("region", {
      name: "GitHub activity controls",
      exact: true,
    });
    await controls.waitFor();
    return controls;
  }
  async function drainGrants() {
    await sql(
      "UPDATE github_grant SET retry_at=0 WHERE state IN ('pending','inflight','uncertain')",
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      await getPage().evaluate(() =>
        fetch("/api/owner/github/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).then((response) => response.status),
      );
      const pending = (
        await sql(
          "SELECT count(*) n FROM github_grant WHERE state IN ('pending','inflight','uncertain')",
        )
      )[0].n;
      if (pending === 0) return;
      await getPage().waitForTimeout(100);
    }
    // Stuck cleanups must not block connecting a different linked account.
    await sql(
      "UPDATE github_grant SET state='idle', retry_at=0 WHERE state IN ('pending','inflight','uncertain')",
    );
  }
  // Connect the linked GitHub sign-in as the graph. Switching accounts means
  // replacing that sign-in, then connecting again.
  async function connectFor(controls, login, expectText) {
    if (await connection()) await age();
    await setGithubSignIn(login);
    await getPage().evaluate(() =>
      fetch("/api/owner/github/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((response) => response.status),
    );
    await drainGrants();
    // beginConsent only claims a grant row that is idle.
    await sql(
      "UPDATE github_grant SET state='idle', token_enc=NULL, retry_at=0",
    );
    await sql(
      "UPDATE github_connection SET last_checked_at=0, private_enabled=0 WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
    );
    const postConnect = () =>
      getPage().evaluate(async () => {
        const response = await fetch("/api/owner/github/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        return { status: response.status, body: await response.json() };
      });
    let result = await postConnect();
    for (let attempt = 0; attempt < 40; attempt++) {
      if (result.status === 200) break;
      if (result.body?.error === "too_soon") {
        await sql(
          "UPDATE github_connection SET last_checked_at=0 WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
        );
        result = await postConnect();
        continue;
      }
      if (result.body?.error === "consent_busy") {
        await sql(
          "UPDATE github_grant SET retry_at=0 WHERE state IN ('pending','inflight','uncertain')",
        );
        await getPage().evaluate(() =>
          fetch("/api/owner/github/retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }).then((response) => response.status),
        );
        await getPage().waitForTimeout(250);
        result = await postConnect();
        continue;
      }
      break;
    }
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const username = result.body.connection.username;
    const page = getPage();
    // A failed refresh removes the section. Add it only after the server
    // connection exists, so the open panel does not race that request.
    if (
      (await (
        await outline(page)
      )
        .getByRole("button", { name: "GitHub activity", exact: true })
        .count()) === 0
    )
      await addSection(page, "GitHub activity");
    await page.evaluate((username) => {
      const controller =
        window.editorFixture.recovery.store.getState().controller;
      const draft = controller.store.getState().working;
      const component = draft.components.find((item) => item.type === "github");
      if (!component) return;
      controller.update({
        ...draft,
        components: draft.components.map((item) =>
          item.id === component.id
            ? { ...item, data: { username, includePrivate: true } }
            : item,
        ),
      });
    }, username);
    await flush();
    controls = await openControls(getPage());
    await controls.getByRole("status").getByText(expectText).waitFor({
      timeout: 60000,
    });
    return controls;
  }
  async function publish() {
    await flush();
    await (await checklist())
      .getByRole("button", { name: /^(Publish|Publish changes|Try again)$/ })
      .click();
    await (await checklist())
      .getByText("You're live", { exact: true })
      .waitFor({ timeout: 120000 });
  }
  async function expectBlocked() {
    await flush();
    await (await checklist())
      .getByRole("button", { name: /^(Publish|Publish changes|Try again)$/ })
      .click();
    await (await checklist())
      .getByRole("button", { name: "Connect your GitHub account" })
      .waitFor({ timeout: 60000 });
    assert.equal(await (await checklist()).getByText("You're live").count(), 0);
  }
  async function graphJson() {
    const response = await publicRead(`${site}/_/github.json`);
    return {
      status: response.status,
      headers: response.headers,
      body: response.status === 200 ? await response.json() : null,
    };
  }

  await run(
    "GitHub graph setup: Connect GitHub uses the linked sign-in account, with status, Retry and blocked publication",
    async () => {
      github.state.failure = null;
      github.state.calls.length = 0;
      // This group starts as Google-only: no linked GitHub sign-in.
      await sql(
        "DELETE FROM account WHERE user_id='draft-alice' AND provider_id='github'",
      );
      const page = await start("graph-site");
      let controls = await addGraph(page);

      // A Google owner has no GitHub sign-in: Connect GitHub is the only
      // path, and nothing is selected or authorized yet.
      await controls.getByRole("button", { name: "Connect GitHub" }).waitFor();
      assert.equal(
        await controls
          .getByRole("button", { name: "Authorize on GitHub" })
          .count(),
        0,
      );
      assert.equal(await controls.getByLabel("GitHub username").count(), 0);
      assert.equal(
        await controls
          .getByRole("button", { name: "Use a different account" })
          .count(),
        0,
      );
      assert.equal(await connection(), undefined);
      await expectBlocked();

      // Connect leaves for linking GitHub as a sign-in method.
      await page.route("https://github.com/o/authorize**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<p>GitHub stand-in</p>",
        }),
      );
      await controls.getByRole("button", { name: "Connect GitHub" }).click();
      await page.waitForURL(/^https:\/\/github\.com\/o\/authorize/);
      const authorizeUrl = new URL(page.url());
      assert.equal(authorizeUrl.searchParams.get("provider"), "github");
      assert.match(
        authorizeUrl.searchParams.get("cb") ?? "",
        /\/editor\?account=connected$/,
      );
      await page.unroute("https://github.com/o/authorize**");

      // Completing the link (and connecting from the new sign-in token) is
      // exercised by inserting the account the provider would have linked.
      await setGithubSignIn("Fixture-Owner");
      await page.goto(
        `${github.state.callbackOrigin}/editor?account=connected`,
      );
      await page.waitForFunction(() => window.editorFixture?.ready);
      controls = await openControls(page);
      await controls
        .getByRole("status")
        .getByText(/Connected\. 5 contributions in the last year/)
        .waitFor({ timeout: 60000 });
      assert.equal(
        github.state.calls.some((call) => call.kind === "authorize"),
        false,
      );
      await flush();
      assert.equal(await savedUsername(), "Fixture-Owner");
      assert.equal(
        (await savedDraft()).components.find((item) => item.type === "github")
          .data.includePrivate,
        true,
      );
      assert.equal(
        await controls
          .getByRole("link", { name: "@Fixture-Owner" })
          .getAttribute("href"),
        "https://github.com/Fixture-Owner",
      );
      const stored = await connection();
      assert.equal(stored.login, "Fixture-Owner");
      assert.equal(stored.private_enabled, 1);
      assert.doesNotMatch(String(stored.token_enc), /gho_fixture/);

      // The live preview draws the fetched graph for the draft username.
      await displayed();
      const graph = frame().locator('[data-github-graph][data-state="ready"]');
      await graph.waitFor({ timeout: 30000 });
      assert.equal(
        await graph.locator(`[title="4 contributions on ${recent}"]`).count(),
        1,
      );
      assert.equal(
        await frame()
          .getByRole("link", { name: "Fixture-Owner" })
          .getAttribute("href"),
        "https://github.com/Fixture-Owner",
      );

      // Retry is rate limited, then recovers after the cooldown.
      await age();
      await controls.getByRole("button", { name: "Refresh activity" }).click();
      await controls
        .getByRole("status")
        .getByText(/Connected\./)
        .waitFor();
      await controls.getByRole("button", { name: "Refresh activity" }).click();
      await controls
        .getByRole("alert")
        .getByText(/Wait a few seconds/)
        .waitFor();
      await age();
      // A failed refresh removes the section instead of leaving an error.
      github.state.failure = 502;
      await controls.getByRole("button", { name: "Refresh activity" }).click();
      await draftLostGraph(page);
      github.state.failure = null;

      // Switching accounts: replace the GitHub sign-in, then Connect again.
      // Zero contributions is a valid, successful result.
      controls = await connectFor(
        controls,
        "zero-owner",
        /Connected\. 0 contributions in the last year/,
      );
      await flush();
      assert.equal(await savedUsername(), "zero-owner");
      await displayed();
      await frame()
        .getByRole("link", { name: "zero-owner" })
        .waitFor({ timeout: 30000 });
      assert.match(await frame().locator("body").innerText(), /Graph owner/);
      await getPage().screenshot({
        path: join(evidence, "github-graph-editor.png"),
        fullPage: true,
      });
    },
  );

  await run(
    "GitHub graph account controls: switch accounts without dropping sign-in, and disconnect removes the section",
    async () => {
      const page = getPage();
      let controls = await openControls(page);
      // Use a different account replaces the graph and leaves the sign-in.
      github.state.consent = { as: "Fixture-Owner", cancel: false };
      await controls
        .getByRole("button", { name: "Use a different account" })
        .click();
      controls = await reopen();
      await controls
        .getByRole("status")
        .getByText(/Connected\. 5 contributions/)
        .waitFor({ timeout: 60000 });
      await flush();
      assert.equal(await savedUsername(), "Fixture-Owner");
      assert.equal(
        (
          await sql(
            "SELECT account_id FROM account WHERE user_id='draft-alice' AND provider_id='github'",
          )
        )[0].account_id,
        "5001",
      );

      // Disconnect confirms, withdraws, and removes the section. Sign-in stays.
      await controls
        .getByRole("button", { name: "Disconnect from graph" })
        .click();
      await page
        .getByRole("dialog")
        .getByText(
          /also removes private activity access now, without publishing/,
        )
        .waitFor();
      await page
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await page
        .locator("dialog.component-removal")
        .waitFor({ state: "detached", timeout: 30000 });
      await draftLostGraph(page);
      assert.equal(
        (
          await sql(
            "SELECT count(*) n FROM account WHERE user_id='draft-alice' AND provider_id='github'",
          )
        )[0].n,
        1,
      );
    },
  );

  await run(
    "GitHub graph publishes frozen configuration, live counts and no private data",
    async () => {
      github.state.failure = null;
      // The previous group may have left this account's grant pending. Finish
      // that cleanup so consent is not blocked by consent_busy.
      await sql(
        "UPDATE github_grant SET retry_at=0 WHERE github_user_id='node-fixture-owner' AND state IN ('pending','inflight','uncertain')",
      );
      const page = await start("graph-site");
      await page.evaluate(() =>
        fetch("/api/owner/github/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).then((response) => response.status),
      );
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = (
          await sql(
            "SELECT state FROM github_grant WHERE github_user_id='node-fixture-owner'",
          )
        )[0]?.state;
        if (state !== "pending" && state !== "inflight") break;
        await page.waitForTimeout(100);
      }
      let controls = await connectFor(
        await addGraph(page),
        "Fixture-Owner",
        /Connected\. 5 contributions/,
      );
      await publish();

      // The published page is a placeholder. No counts are baked in.
      const html = await (await publicRead(`${site}/`)).text();
      assert.match(html, /data-github-graph/);
      assert.match(html, /data-graph-source="\/_\/github\.json"/);
      assert.doesNotMatch(
        html,
        /pf-graph-day|contribution on|contributions on/,
      );
      assert.match(
        (await publicRead(`${site}/`)).headers.get("Content-Security-Policy"),
        /connect-src 'self';/,
      );

      // The endpoint serves only the allowlisted projection for the version.
      let live = await graphJson();
      assert.equal(live.status, 200);
      assert.equal(live.headers.get("Cache-Control"), "no-store");
      assert.match(live.headers.get("Content-Type"), /application\/json/);
      assert.deepEqual(Object.keys(live.body).sort(), [
        "available",
        "days",
        "fetchedAt",
        "profileUrl",
        "username",
      ]);
      assert.equal(live.body.username, "Fixture-Owner");
      assert.equal(live.body.profileUrl, "https://github.com/Fixture-Owner");
      assert.equal(live.body.available, true);
      assert.equal(
        live.body.days.find((item) => item.date === recent).count,
        4,
      );
      assert.equal(
        JSON.stringify(live.body).match(/token|private|authorized/i),
        null,
      );
      // Query strings and other hosts cannot select another configuration.
      assert.equal(
        (await graphJson()).body.username,
        (
          await (
            await publicRead(`${site}/_/github.json?username=zero-owner`)
          ).json()
        ).username,
      );
      assert.equal(
        (await publicRead("https://nobody-here.hasaweb.site/_/github.json"))
          .status,
        404,
      );

      // A visitor's browser draws the graph from that endpoint.
      const visitor = await page.context().browser().newContext();
      try {
        await visitor.route(
          /^https:\/\/[^/]+\.hasaweb\.site\//,
          async (route) => {
            const response = await publicRead(route.request().url());
            const headers = Object.fromEntries(response.headers);
            delete headers["content-encoding"];
            delete headers["content-length"];
            await route.fulfill({
              status: response.status,
              headers,
              body: Buffer.from(await response.arrayBuffer()),
            });
          },
        );
        const tab = await visitor.newPage();
        const visitorErrors = [];
        tab.on("console", (message) => {
          if (message.type() === "error") visitorErrors.push(message.text());
        });
        await tab.goto(`${site}/`);
        const drawn = tab.locator('[data-github-graph][data-state="ready"]');
        await drawn.waitFor({ timeout: 30000 });
        assert.equal(
          await drawn.locator(`[title="4 contributions on ${recent}"]`).count(),
          1,
        );
        assert.equal(
          await tab
            .getByRole("link", { name: "Fixture-Owner" })
            .getAttribute("href"),
          "https://github.com/Fixture-Owner",
        );
        assert.deepEqual(visitorErrors, []);
        await tab.screenshot({
          path: join(evidence, "github-graph-published.png"),
          fullPage: true,
        });

        // Editing the draft to another account never changes the live graph's
        // configuration. Until the next Publish the live graph keeps the
        // published account's public counts (Phase 42), never the draft's.
        controls = await connectFor(
          controls,
          "zero-owner",
          /Connected\. 0 contributions/,
        );
        await flush();
        live = await graphJson();
        assert.equal(live.body.username, "Fixture-Owner");
        assert.equal(live.body.available, true);
        assert.equal(
          live.body.days.find((item) => item.date === recent).count,
          4,
        );
        await tab.reload();
        await tab
          .locator(
            `[data-github-graph][data-state="ready"] [title="4 contributions on ${recent}"]`,
          )
          .waitFor({ timeout: 30000 });
        assert.match(await tab.locator("body").innerText(), /Graph owner/);

        // Zero contributions publish successfully and serve a valid graph.
        await publish();
        live = await graphJson();
        assert.equal(live.body.username, "zero-owner");
        assert.equal(live.body.available, true);
        assert.ok(live.body.days.length > 300);
        assert.ok(live.body.days.every((item) => item.count === 0));
        await tab.reload();
        await tab
          .locator('[data-github-graph][data-state="ready"]')
          .waitFor({ timeout: 30000 });

        // A failed refresh removes the section and withdraws private access.
        // The published component stays until Publish.
        await age();
        github.state.failure = 500;
        await controls
          .getByRole("button", { name: "Refresh activity" })
          .click();
        await draftLostGraph(page);
        github.state.failure = null;
        live = await graphJson();
        assert.equal(live.body.available, true);

        await publish();
        assert.equal((await graphJson()).status, 404);
        assert.doesNotMatch(
          await (await publicRead(`${site}/`)).text(),
          /data-github-graph/,
        );
      } finally {
        await visitor.close();
      }
    },
  );

  await run(
    "GitHub sign-in connects its own graph with private activity and no second authorization; a revoked sign-in token authorizes on GitHub",
    async () => {
      github.state.failure = null;
      github.addUser({
        login: "Signup-Owner",
        databaseId: 4343,
        counts: { [recent]: 1 },
        privateCounts: { [recent]: 2 },
      });
      await boot();
      const empty = await getPage().evaluate(() => {
        const draft = structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        );
        return { ...draft, components: [], samples: {} };
      });
      const signInToken = github.issueSignInToken("Signup-Owner");
      await sql("DELETE FROM account WHERE user_id='draft-alice'");
      await sql(
        "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES('fixture-github-account','4343','github','draft-alice',?,?,?)",
        [signInToken, Date.now(), Date.now()],
      );
      github.state.calls.length = 0;
      try {
        await boot(empty);
        const page = getPage();
        github.state.callbackOrigin = new URL(page.url()).origin;
        github.state.consent = { as: null, cancel: false, hold: false };
        let controls = await addGraph(page);
        // Adding the section connects the sign-in account: public and
        // private counts, with no GitHub page in between.
        await controls
          .getByRole("status")
          .getByText(/Connected\. 3 contributions in the last year/)
          .waitFor({ timeout: 60000 });
        assert.equal(
          github.state.calls.some((call) => call.kind === "authorize"),
          false,
        );
        await flush();
        assert.deepEqual(
          (await savedDraft()).components.find((item) => item.type === "github")
            .data,
          { username: "Signup-Owner", includePrivate: true },
        );
        const stored = await connection();
        assert.equal(stored.private_enabled, 1);
        // Only the encrypted envelope is stored, never the token.
        assert.ok(!String(stored.token_enc).includes(signInToken));
        assert.equal(
          (
            await sql(
              "SELECT state FROM github_grant WHERE app_id='fixture' AND github_user_id='node-signup-owner'",
            )
          )[0]?.state,
          "active",
        );
        await displayed();
        await frame()
          .locator(
            `[data-github-graph][data-state="ready"] [title="3 contributions on ${recent}"]`,
          )
          .waitFor({ timeout: 30000 });

        // Removing the graph revokes the sign-in app's grant at GitHub.
        await (await outline(page))
          .getByRole("button", { name: "GitHub activity", exact: true })
          .press("Delete");
        await page
          .getByRole("button", { name: "Remove section", exact: true })
          .click();
        await page
          .locator("dialog.component-removal")
          .waitFor({ state: "detached", timeout: 30000 });
        for (let attempt = 0; attempt < 100; attempt++) {
          if (!github.tokens.get(signInToken).valid) break;
          await page.waitForTimeout(100);
        }
        assert.equal(github.tokens.get(signInToken).valid, false);
        assert.ok(
          github.state.calls.some(
            (call) => call.kind === "delete-grant" && call.app === "fixture",
          ),
        );

        // Adding it again cannot reuse the revoked token. Connect GitHub
        // then authorizes the sign-in account on GitHub.
        await age();
        controls = await addGraph(page);
        const connect = controls.getByRole("button", {
          name: "Connect GitHub",
        });
        await connect.waitFor({ timeout: 60000 });
        await controls
          .getByRole("status")
          .getByText("Not connected.")
          .waitFor();
        await connect.click();
        controls = await reopen();
        await controls
          .getByRole("status")
          .getByText(/Connected\. 3 contributions/)
          .waitFor({ timeout: 60000 });
        assert.ok(
          github.state.calls.some(
            (call) =>
              call.kind === "authorize" && call.login === "Signup-Owner",
          ),
        );
        assert.equal((await connection()).private_enabled, 1);
      } finally {
        await sql("DELETE FROM account WHERE id='fixture-github-account'");
      }
    },
  );

  await run(
    "GitHub authorization when the sign-in token cannot be used: consent recovery, Publish boundary and withdrawal without Publish",
    async () => {
      github.state.failure = null;
      // Earlier groups may leave due grant cleanups. Finish them so this
      // group's delete-token / delete-grant checks only see its own calls.
      await sql(
        "UPDATE github_grant SET retry_at=0 WHERE state IN ('pending','inflight','uncertain')",
      );
      github.addUser({
        login: "Private-Owner",
        databaseId: 5100,
        counts: { [recent]: 2 },
        privateCounts: { [recent]: 5, [older]: 3 },
      });
      github.addUser({
        login: "Other-Account",
        databaseId: 5101,
        counts: { [recent]: 1 },
      });
      const live = "https://private-graph.hasaweb.site";
      const liveGraph = async () => {
        const response = await publicRead(`${live}/_/github.json`);
        return response.status === 200 ? response.json() : null;
      };
      const total = (graph) =>
        graph?.days.reduce((sum, day) => sum + day.count, 0) ?? null;
      const grantState = async () =>
        (
          await sql(
            "SELECT state FROM github_grant WHERE github_user_id='node-private-owner'",
          )
        )[0]?.state;
      const settled = async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = await grantState();
          if (state !== "pending" && state !== "inflight") return state;
          await getPage().waitForTimeout(100);
        }
        throw new Error("grant cleanup did not finish");
      };
      let page = await start("private-graph");
      // Drain leftover cleanups through the same path setup uses, then
      // count only this group's GitHub calls.
      await page.evaluate(() =>
        fetch("/api/owner/github/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).then((response) => response.status),
      );
      for (let attempt = 0; attempt < 100; attempt++) {
        const pending = (
          await sql(
            "SELECT count(*) n FROM github_grant WHERE state IN ('pending','inflight')",
          )
        )[0].n;
        if (pending === 0) break;
        await page.waitForTimeout(100);
      }
      github.state.calls.length = 0;
      // No usable sign-in token: Connect GitHub authorizes the linked account.
      await setGithubSignIn("Private-Owner", null);
      let controls = await addGraph(page);
      const status = () => controls.locator("[data-github-status]");

      // GitHub authorizes a different account: nothing is enabled, the
      // selected account stays, and the editor removes the section.
      github.state.consent = { as: "Other-Account", cancel: false };
      await controls.getByRole("button", { name: "Connect GitHub" }).click();
      await page.waitForURL(/\/editor(\?github=consent)?$/, { timeout: 60000 });
      await page.waitForFunction(() => window.editorFixture?.ready);
      await draftLostGraph(page);
      assert.equal(new URL(page.url()).search, "");
      let stored = await connection();
      assert.equal(stored.login, "Private-Owner");
      assert.equal(stored.private_enabled, 0);
      assert.equal(stored.token_enc, null);
      // Only that token is revoked; the reservation then frees.
      assert.equal(await settled(), "idle");
      assert.ok(
        github.state.calls.some((call) => call.kind === "delete-token"),
      );
      assert.equal(
        github.state.calls.some((call) => call.kind === "delete-grant"),
        false,
      );

      // A cancelled authorization removes the section too.
      await age();
      controls = await addGraph(page);
      github.state.consent = { as: null, cancel: true };
      await controls.getByRole("button", { name: "Connect GitHub" }).click();
      await page.waitForURL(/\/editor(\?github=consent)?$/, { timeout: 60000 });
      await page.waitForFunction(() => window.editorFixture?.ready);
      await draftLostGraph(page);

      // Matching consent shows public and private counts in the owner
      // preview only.
      await age();
      controls = await addGraph(page);
      github.state.consent = { as: null, cancel: false };
      await controls.getByRole("button", { name: "Connect GitHub" }).click();
      controls = await reopen();
      await status()
        .getByText(/Connected\. 10 contributions in the last year/)
        .waitFor({ timeout: 30000 });
      stored = await connection();
      assert.equal(stored.private_enabled, 1);
      assert.doesNotMatch(String(stored.token_enc), /gho_fixture/);
      await displayed();
      await frame()
        .locator(
          `[data-github-graph][data-state="ready"] [title="7 contributions on ${recent}"]`,
        )
        .waitFor({ timeout: 30000 });
      // Nothing is public before Publish.
      assert.equal(await liveGraph(), null);

      // Publish serves the authorized calendar, as an allowlist of dates
      // and counts.
      await publish();
      const published = await liveGraph();
      assert.equal(total(published), 10);
      assert.deepEqual(Object.keys(published).sort(), [
        "available",
        "days",
        "fetchedAt",
        "profileUrl",
        "username",
      ]);
      assert.deepEqual(Object.keys(published.days[0]).sort(), [
        "count",
        "date",
      ]);

      // Removing the graph withdraws access at once, without Publish: the
      // dialog says so, private counts leave the live site, and the grant
      // is revoked at GitHub.
      await (await outline(page))
        .getByRole("button", { name: "GitHub activity", exact: true })
        .press("Delete");
      await page
        .getByRole("dialog")
        .getByText(
          /also removes private activity access now, without publishing/,
        )
        .waitFor();
      await page
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      // Wait for the dialog itself: it unmounts only after the withdrawal
      // committed and the section was removed.
      await page
        .locator("dialog.component-removal")
        .waitFor({ state: "detached", timeout: 30000 });
      assert.equal((await connection()).private_enabled, 0);
      assert.equal((await connection()).token_enc, null);
      assert.equal(total(await liveGraph()), 2);
      assert.equal(await settled(), "idle");
      assert.ok(
        github.state.calls.some((call) => call.kind === "delete-grant"),
      );
      assert.equal(
        [...github.tokens.values()].some(
          (item) => item.login === "private-owner" && item.valid,
        ),
        false,
      );
      page = getPage();
    },
  );

  await run(
    "GitHub refresh: live graphs update without Publish, keep the last good graph on failure, and lose revoked access on the next refresh",
    async () => {
      github.state.failure = null;
      github.state.consent = { as: null, cancel: false };
      const user = github.addUser({
        login: "Refresh-Owner",
        counts: { [recent]: 3 },
        privateCounts: { [recent]: 4 },
      });
      const live = "https://refresh-graph.hasaweb.site";
      const liveGraph = async () => {
        const response = await publicRead(`${live}/_/github.json`);
        return response.status === 200 ? response.json() : null;
      };
      const total = (graph) =>
        graph?.available
          ? graph.days.reduce((sum, day) => sum + day.count, 0)
          : null;
      const portfolio =
        "(SELECT id FROM portfolio WHERE user_id='draft-alice')";
      // Past the six-hour TTL, without waiting: age the stored fetch dates.
      const agedAt = new Date(Date.now() - 7 * 36e5).toISOString();
      const ageCalendars = () =>
        sql(
          `UPDATE github_activity SET public_calendar=json_set(public_calendar,'$.fetchedAt',?),
          authorized_calendar=CASE WHEN authorized_calendar IS NULL THEN NULL
            ELSE json_set(authorized_calendar,'$.fetchedAt',?) END
          WHERE portfolio_id=${portfolio}`,
          [agedAt, agedAt],
        );
      // Past the 15-minute request window, without waiting.
      const ageRequest = () =>
        sql(
          `UPDATE github_refresh SET requested_at=requested_at-16*60000 WHERE portfolio_id=${portfolio}`,
        );
      const requests = async () =>
        (
          await sql(
            `SELECT requested_at,started_at FROM github_refresh WHERE portfolio_id=${portfolio}`,
          )
        )[0];
      const until = async (check, message) => {
        for (let attempt = 0; attempt < 150; attempt++) {
          const value = await check();
          if (value) return value;
          await getPage().waitForTimeout(200);
        }
        throw new Error(message);
      };
      let page = await start("refresh-graph");
      let controls = await connectFor(
        await addGraph(page),
        "Refresh-Owner",
        /Connected\. 7 contributions/,
      );
      await publish();
      assert.equal(total(await liveGraph()), 7);

      // A visit past the TTL gets the last good graph at once and one
      // background refresh; the live graph then updates without Publish.
      user.counts[recent] = 5;
      await ageCalendars();
      const stale = await liveGraph();
      assert.equal(total(stale), 7);
      assert.equal(stale.fetchedAt, agedAt);
      const fresh = await until(async () => {
        const graph = await liveGraph();
        return total(graph) === 9 && graph;
      }, "the live graph did not refresh");
      assert.ok(Date.parse(fresh.fetchedAt) > Date.parse(agedAt));
      const requested = await requests();
      assert.ok(requested.started_at >= requested.requested_at);
      // Fresh again: more visits request nothing and call GitHub no more.
      const calls = github.state.calls.length;
      await liveGraph();
      await liveGraph();
      assert.deepEqual(await requests(), requested);
      assert.equal(github.state.calls.length, calls);

      // GitHub fails: visitors keep the last good graph and its date, and the
      // editor reports the failure with Retry.
      await ageCalendars();
      await ageRequest();
      github.state.failure = 502;
      assert.equal(total(await liveGraph()), 9);
      await until(
        async () =>
          (
            await sql(
              `SELECT authorized_error FROM github_activity WHERE portfolio_id=${portfolio}`,
            )
          )[0]?.authorized_error,
        "the failed refresh was not recorded",
      );
      const kept = await liveGraph();
      assert.equal(total(kept), 9);
      assert.equal(kept.fetchedAt, agedAt);
      // Opening that failure removes the section and withdraws the grant.
      // Adding it again authorizes the sign-in account. Private counts
      // return without Publish.
      await page.goto(new URL("/editor?github=consent", page.url()).href);
      await page.waitForFunction(() => window.editorFixture?.ready);
      await draftLostGraph(page);
      github.state.failure = null;
      github.state.consent = { as: null, cancel: false };
      await until(
        async () =>
          (
            await sql(
              "SELECT state FROM github_grant WHERE github_user_id='node-refresh-owner'",
            )
          )[0]?.state === "idle",
        "the withdrawn grant was not released",
      );
      await age();
      controls = await addGraph(page);
      await controls
        .getByRole("button", { name: "Connect GitHub" })
        .waitFor({ timeout: 60000 });
      await controls.getByRole("button", { name: "Connect GitHub" }).click();
      controls = await reopen();
      await controls
        .getByRole("status")
        .getByText(/Connected\. 9 contributions/)
        .waitFor({ timeout: 60000 });
      assert.equal(total(await liveGraph()), 9);

      // The owner removes the app on GitHub. The next refresh sees 401 and
      // withdraws private counts from the live graph without Publish.
      github.revokeAll("Refresh-Owner");
      await ageCalendars();
      await ageRequest();
      assert.equal(total(await liveGraph()), 9);
      await until(
        async () => total(await liveGraph()) === 5,
        "revoked access stayed live",
      );
      assert.equal((await connection()).private_enabled, 0);
      assert.equal((await connection()).status, "needs_reconnect");
      await until(
        async () =>
          (
            await sql(
              "SELECT state FROM github_grant WHERE github_user_id='node-refresh-owner'",
            )
          )[0]?.state === "idle",
        "the refused grant was not released",
      );
      await page.goto(new URL("/editor?github=consent", page.url()).href);
      await page.waitForFunction(() => window.editorFixture?.ready);
      await draftLostGraph(page);

      // Reconnect: the revoked sign-in token cannot be reused, so Connect
      // authorizes that account and restores private counts without Publish.
      github.state.consent = { as: null, cancel: false };
      controls = await addGraph(page);
      await controls
        .getByRole("button", { name: "Connect GitHub" })
        .waitFor({ timeout: 60000 });
      await controls.getByRole("button", { name: "Connect GitHub" }).click();
      controls = await reopen();
      await controls
        .getByRole("status")
        .getByText(/Connected\. 9 contributions/)
        .waitFor({ timeout: 30000 });
      assert.equal(total(await liveGraph()), 9);
      page = getPage();
    },
  );

  await run(
    "Connected sign-in methods: disconnecting GitHub withdraws the graph's access through the same cleanup, keeps the last method, and reconnecting needs new consent",
    async () => {
      github.state.failure = null;
      github.state.consent = { as: null, cancel: false };
      github.addUser({
        login: "Signin-Owner",
        databaseId: 4444,
        counts: { [recent]: 1 },
        privateCounts: { [recent]: 6 },
      });
      const live = "https://signin-graph.hasaweb.site";
      const total = async () => {
        const response = await publicRead(`${live}/_/github.json`);
        if (response.status !== 200) return null;
        const graph = await response.json();
        return graph.days.reduce((sum, item) => sum + item.count, 0);
      };
      // Every grant of the account, for the sign-in and activity apps.
      const settled = async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const states = (
            await sql(
              "SELECT state FROM github_grant WHERE github_user_id='node-signin-owner'",
            )
          ).map((row) => row.state);
          if (!states.some((state) => ["pending", "inflight"].includes(state)))
            return states.join();
          await getPage().waitForTimeout(100);
        }
        throw new Error("grant cleanup did not finish");
      };
      const providers = async () =>
        (
          await sql(
            "SELECT provider_id FROM account WHERE user_id='draft-alice' ORDER BY provider_id",
          )
        ).map((row) => row.provider_id);
      const link = (provider, token = null) => {
        const now = Date.now();
        return sql(
          "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          [
            `alice-${provider}`,
            provider === "github" ? "4444" : `alice-${provider}-id`,
            provider,
            "draft-alice",
            token,
            now,
            now,
          ],
        );
      };
      let page;
      let controls;
      try {
        await sql("DELETE FROM account WHERE user_id='draft-alice'");
        await link("github", github.issueSignInToken("Signin-Owner"));
        await link("google");
        page = await start("signin-graph");
        // The GitHub sign-in connects the graph on its own.
        controls = await addGraph(page);
        await controls
          .getByRole("status")
          .getByText(/Connected\. 7 contributions/)
          .waitFor({ timeout: 60000 });
        await publish();
        assert.equal(await total(), 7);
        github.state.calls.length = 0;

        // Both methods are listed; either can be disconnected.
        await openAccount(page);
        const methods = page.getByRole("region", {
          name: "Connected sign-in methods",
          exact: true,
        });
        const row = (provider) =>
          methods.locator(`[data-sign-in-method="${provider}"]`);
        await row("github").getByText("Connected", { exact: true }).waitFor();
        await row("google").getByText("Connected", { exact: true }).waitFor();

        // Cancel changes nothing.
        await methods
          .getByRole("button", { name: "Disconnect GitHub", exact: true })
          .click();
        await methods
          .getByRole("group", { name: "Confirm disconnecting GitHub" })
          .getByText(/Private GitHub activity access is removed now/)
          .waitFor();
        await methods.getByRole("button", { name: "Cancel" }).click();
        assert.deepEqual(await providers(), ["github", "google"]);

        // Disconnecting GitHub sign-in runs the Phase 41 withdrawal: private
        // counts leave the live site without Publish and the sign-in app's
        // grant is revoked.
        await methods
          .getByRole("button", { name: "Disconnect GitHub", exact: true })
          .click();
        await methods
          .getByRole("button", { name: "Disconnect GitHub now" })
          .click();
        await methods
          .getByRole("status")
          .getByText("GitHub disconnected.", { exact: true })
          .waitFor({ timeout: 30000 });
        assert.deepEqual(await providers(), ["google"]);
        assert.equal(await total(), 1);
        assert.equal((await connection()).private_enabled, 0);
        assert.equal((await connection()).token_enc, null);
        assert.equal(await settled(), "idle");
        assert.ok(
          github.state.calls.some(
            (call) => call.kind === "delete-grant" && call.app === "fixture",
          ),
        );
        // The draft keeps its account; the graph asks to authorize again.
        await flush();
        assert.equal(
          (await savedDraft()).components.find((item) => item.type === "github")
            .data.includePrivate,
          true,
        );

        // The last method cannot be disconnected.
        await row("github")
          .getByRole("button", { name: "Connect GitHub", exact: true })
          .waitFor();
        assert.equal(
          await methods
            .getByRole("button", { name: /^Disconnect Google/ })
            .count(),
          0,
        );
        await methods
          .getByText("Keep at least one sign-in method connected.")
          .waitFor();

        // Connect leaves for the provider with the fixed editor returns.
        // Completing the link (OAuth state, ownership, account rules) is
        // covered by the auth project's provider fixtures.
        await page.route("https://github.com/o/authorize**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<p>GitHub stand-in</p>",
          }),
        );
        await row("github")
          .getByRole("button", { name: "Connect GitHub", exact: true })
          .click();
        await page.waitForURL(/^https:\/\/github\.com\/o\/authorize/);
        const authorizeUrl = new URL(page.url());
        const editorOrigin = github.state.callbackOrigin;
        assert.equal(authorizeUrl.searchParams.get("provider"), "github");
        assert.equal(
          authorizeUrl.searchParams.get("cb"),
          `${editorOrigin}/editor?account=connected`,
        );
        assert.equal(
          authorizeUrl.searchParams.get("err"),
          `${editorOrigin}/editor?account=not-connected`,
        );
        await page.unroute("https://github.com/o/authorize**");

        // A cancelled return opens the settings panel with the outcome and
        // drops the parameters; nothing is connected.
        await page.goto(
          `${editorOrigin}/editor?account=not-connected&error=access_denied`,
        );
        await page.waitForFunction(() => window.editorFixture?.ready);
        await methods
          .getByRole("alert")
          .getByText("Connecting was cancelled. Nothing changed.")
          .waitFor();
        assert.equal(new URL(page.url()).search, "");
        await row("github")
          .getByRole("button", { name: "Connect GitHub", exact: true })
          .waitFor();

        // Reconnected sign-in restores nothing by itself: the graph needs new
        // consent, which proceeds because the cleanup finished.
        await link("github", github.issueSignInToken("Signin-Owner"));
        await page.goto(`${editorOrigin}/editor?account=connected`);
        await page.waitForFunction(() => window.editorFixture?.ready);
        await methods
          .getByRole("status")
          .getByText(/Sign-in method connected/)
          .waitFor();
        await row("github").getByText("Connected", { exact: true }).waitFor();
        assert.equal(new URL(page.url()).search, "");
        await page.getByRole("button", { name: "Build", exact: true }).click();
        await (await outline(page))
          .getByRole("button", { name: "GitHub activity", exact: true })
          .click();
        // The withdrawn graph is no longer connected, so the section leaves.
        // Adding it again uses the restored sign-in token.
        await draftLostGraph(page);
        assert.equal((await connection()).private_enabled, 0);
        controls = await addGraph(page);
        await controls
          .getByRole("status")
          .getByText(/Connected\. 7 contributions/)
          .waitFor({ timeout: 60000 });
        assert.equal((await connection()).private_enabled, 1);
      } finally {
        // Other groups expect an owner without a GitHub sign-in.
        await sql("DELETE FROM account WHERE user_id='draft-alice'");
        await sql(
          "DELETE FROM disconnected_provider WHERE user_id='draft-alice'",
        );
        page = getPage();
      }
    },
  );
}
