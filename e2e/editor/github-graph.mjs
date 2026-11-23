import assert from "node:assert/strict";
import { join } from "node:path";
import { addSection, openChecklist, openPanel } from "./shell.mjs";

const day = (offset) =>
  new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

// Owner draft, preview, publication and visitor journeys for the public
// GitHub graph. GitHub itself is a local stand-in (scripts/lib/github-fixture).
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
  github.addUser({ login: "zero-owner" });
  github.addUser({ login: "private-owner", restricted: 7 });
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
    return page;
  }
  async function addGraph(page) {
    const sections = page.getByRole("region", {
      name: "Page",
      exact: true,
    });
    await addSection(page, "GitHub activity");
    await sections
      .getByRole("button", { name: "GitHub activity", exact: true })
      .click();
    const controls = page.getByRole("region", {
      name: "GitHub activity controls",
      exact: true,
    });
    await controls.waitFor();
    return controls;
  }
  async function fetchFor(controls, username, expectText) {
    // Changing the account shares the real retry cooldown. Age it, don't wait.
    if (await connection()) await age();
    await controls.getByLabel("GitHub username").fill(username);
    await controls.getByRole("button", { name: "Fetch activity" }).click();
    await controls.getByRole("status").getByText(expectText).waitFor({
      timeout: 60000,
    });
  }
  async function publish() {
    await flush();
    await (await checklist())
      .getByRole("button", { name: /^(Retry )?Publish$/ })
      .click();
    await (await checklist())
      .getByText("Publication complete.", { exact: true })
      .waitFor({ timeout: 120000 });
  }
  async function expectBlocked() {
    await flush();
    await (await checklist())
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await (await checklist())
      .getByRole("button", { name: "Connect GitHub and fetch activity" })
      .waitFor({ timeout: 60000 });
    assert.equal(
      await (await checklist()).getByText("Publication complete.").count(),
      0,
    );
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
    "GitHub graph setup: manual username, status, Retry and blocked publication",
    async () => {
      github.state.failure = null;
      github.state.calls.length = 0;
      const page = await start("graph-site");
      const controls = await addGraph(page);

      // Google owners need no GitHub sign-in link: nothing is detected, nothing
      // is added, and a typed username still works.
      assert.equal(await controls.getByText(/We detected/).count(), 0);
      await controls
        .getByRole("status")
        .getByText(/Not set up/)
        .waitFor();
      assert.equal(await connection(), undefined);
      await expectBlocked();

      // An invalid name is stopped before any provider call.
      await controls.getByLabel("GitHub username").fill("not a user!");
      assert.equal(
        await controls
          .getByRole("button", { name: "Fetch activity" })
          .isDisabled(),
        true,
      );

      // An unknown account is reported and changes neither draft nor server.
      await controls.getByLabel("GitHub username").fill("ghost-user");
      await controls.getByRole("button", { name: "Fetch activity" }).click();
      await controls
        .getByRole("alert")
        .getByText(/no account with that username/)
        .waitFor();
      assert.equal(await connection(), undefined);
      assert.equal(await savedUsername(), "");

      // A provider outage never selects an account or asks for a reconnect.
      github.state.failure = 503;
      await controls.getByLabel("GitHub username").fill("fixture-owner");
      await controls.getByRole("button", { name: "Fetch activity" }).click();
      await controls
        .getByRole("alert")
        .getByText(/GitHub couldn't be reached/)
        .waitFor();
      assert.equal(await connection(), undefined);
      github.state.failure = null;

      // A typed username in other capitalization resolves to the canonical one
      // and links to that exact profile.
      await fetchFor(controls, "fixture-owner", /Connected\. Fetched/);
      await flush();
      assert.equal(await savedUsername(), "Fixture-Owner");
      assert.equal(
        await controls
          .getByRole("link", { name: "View @Fixture-Owner on GitHub" })
          .getAttribute("href"),
        "https://github.com/Fixture-Owner",
      );
      const stored = await connection();
      assert.equal(stored.login, "Fixture-Owner");
      assert.equal(stored.private_enabled, 0);
      assert.equal(stored.token_enc, null);
      assert.equal(
        (
          await sql(
            "SELECT authorized_calendar FROM github_activity WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
          )
        )[0].authorized_calendar,
        null,
      );
      await controls
        .getByText(/5 public contributions in the last year/)
        .waitFor();

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
      await controls.getByRole("button", { name: "Refresh activity" }).click();
      await controls
        .getByRole("alert")
        .getByText(/Wait a few seconds/)
        .waitFor();
      await age();
      github.state.failure = 502;
      await controls.getByRole("button", { name: "Refresh activity" }).click();
      await controls
        .getByRole("status")
        .getByText(/Couldn't refresh GitHub\. Showing the graph from/)
        .waitFor({ timeout: 30000 });
      github.state.failure = null;
      await age();
      await controls.getByRole("button", { name: "Refresh activity" }).click();
      await controls
        .getByRole("status")
        .getByText(/Connected\. Fetched/)
        .waitFor();

      // Private contributions shown on the profile: honest, blocking, recoverable.
      await fetchFor(controls, "private-owner", /shows private contributions/);
      await flush();
      assert.equal(await savedUsername(), "private-owner");
      await expectBlocked();
      await displayed();
      assert.equal(
        await frame()
          .locator('[data-github-graph][data-state="unavailable"]')
          .count(),
        1,
      );
      // The rest of the portfolio is untouched while the graph is blocked.
      assert.match(await frame().locator("body").innerText(), /Graph owner/);
      // Zero contributions is a valid, successful result.
      await fetchFor(
        controls,
        "zero-owner",
        /No public contributions in the last year/,
      );
      await (await checklist())
        .getByText("Publication complete.")
        .waitFor({ state: "detached", timeout: 1000 })
        .catch(() => {});
      await getPage().screenshot({
        path: join(evidence, "github-graph-editor.png"),
        fullPage: true,
      });
    },
  );

  await run(
    "GitHub graph publishes frozen configuration, live counts and no private data",
    async () => {
      github.state.failure = null;
      const page = await start("graph-site");
      const controls = await addGraph(page);
      await fetchFor(controls, "Fixture-Owner", /Connected\. Fetched/);
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
        await fetchFor(controls, "zero-owner", /No public contributions/);
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

        // A failed provider fetch withdraws nothing from the page: the last
        // good graph and date stay served.
        await age();
        github.state.failure = 500;
        await controls
          .getByRole("button", { name: "Refresh activity" })
          .click();
        await controls
          .getByRole("status")
          .getByText(/Couldn't refresh GitHub/)
          .waitFor({ timeout: 30000 });
        github.state.failure = null;
        live = await graphJson();
        assert.equal(live.body.available, true);

        // Removing the graph lets the portfolio publish without it.
        const sections = page.getByRole("region", {
          name: "Page",
          exact: true,
        });
        await sections
          .getByRole("button", { name: "GitHub activity", exact: true })
          .press("Delete");
        await page
          .getByRole("button", { name: "Remove section", exact: true })
          .click();
        // Removal first withdraws private access on the server (Phase 41).
        // The dialog unmounts only after the withdrawal and the removal; its
        // disabled "Removing..." button can stop matching a role query while
        // the request is still in flight.
        await page
          .locator("dialog.component-removal")
          .waitFor({ state: "detached", timeout: 30000 });
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
    "GitHub graph detects a sign-in username as a suggestion only",
    async () => {
      github.state.failure = null;
      await boot();
      const empty = await getPage().evaluate(() => {
        const draft = structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        );
        return { ...draft, components: [], samples: {} };
      });
      await sql("DELETE FROM account WHERE user_id='draft-alice'");
      await sql(
        "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('fixture-github-account','4242','github','draft-alice',?,?)",
        [Date.now(), Date.now()],
      );
      github.state.calls.length = 0;
      try {
        await boot(empty);
        const page = getPage();
        const controls = await addGraph(page);
        await controls.getByText(/We detected/).waitFor({ timeout: 30000 });
        await controls
          .getByRole("button", { name: "Use @Fixture-Owner" })
          .waitFor();
        // Detection selects nothing and fetches no calendar.
        assert.equal(await connection(), undefined);
        assert.equal(
          await controls.getByLabel("GitHub username").inputValue(),
          "",
        );
        assert.equal(
          github.state.calls.filter((call) => call.kind === "activity").length,
          0,
        );
        await controls
          .getByRole("button", { name: "Use @Fixture-Owner" })
          .click();
        assert.equal(
          await controls.getByLabel("GitHub username").inputValue(),
          "Fixture-Owner",
        );
        assert.equal(await connection(), undefined);
        await controls.getByRole("button", { name: "Fetch activity" }).click();
        await controls
          .getByRole("status")
          .getByText(/Connected\. Fetched/)
          .waitFor({
            timeout: 60000,
          });
        assert.equal((await connection()).login, "Fixture-Owner");
      } finally {
        await sql("DELETE FROM account WHERE id='fixture-github-account'");
      }
    },
  );

  await run(
    "GitHub private activity: consent recovery, Publish boundary and withdrawal without Publish",
    async () => {
      github.state.failure = null;
      github.state.consent = { as: null, cancel: false };
      github.addUser({
        login: "Private-Owner",
        counts: { [recent]: 2 },
        privateCounts: { [recent]: 5, [older]: 3 },
      });
      github.addUser({ login: "Other-Account", counts: { [recent]: 1 } });
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
      github.state.callbackOrigin = new URL(page.url()).origin;
      let controls = await addGraph(page);
      await fetchFor(controls, "Private-Owner", /Connected\. Fetched/);
      const privateStatus = () =>
        controls.locator("[data-github-private-status]");
      const reopen = async () => {
        // GitHub returns to /editor?github=consent; the editor reopens the section.
        await page.waitForURL(/\/editor(\?github=consent)?$/, {
          timeout: 60000,
        });
        await page.waitForFunction(() => window.editorFixture?.ready);
        controls = page.getByRole("region", {
          name: "GitHub activity controls",
          exact: true,
        });
        await controls.waitFor({ timeout: 30000 });
      };

      // Explicit opt-in explains public visibility and blocks Publish until
      // the matching account is authorized.
      await controls
        .getByText(/Visitors will see anonymized contribution counts/)
        .waitFor();
      await controls
        .getByRole("switch", { name: /Include private activity/ })
        .check();
      await privateStatus()
        .getByText(/Authorize the username above/)
        .waitFor();
      await expectBlocked();

      // A different GitHub account changes nothing and offers recovery.
      github.state.consent = { as: "Other-Account", cancel: false };
      await controls
        .getByRole("button", { name: "Authorize private activity" })
        .click();
      await reopen();
      await privateStatus()
        .getByText(/GitHub authorized a different account, so nothing changed/)
        .waitFor({ timeout: 30000 });
      assert.equal(new URL(page.url()).search, "");
      let stored = await connection();
      assert.equal(stored.login, "Private-Owner");
      assert.equal(stored.private_enabled, 0);
      assert.equal(stored.token_enc, null);
      // Only that token is revoked; the reservation then frees for Retry.
      assert.equal(await settled(), "idle");
      assert.ok(
        github.state.calls.some((call) => call.kind === "delete-token"),
      );
      assert.equal(
        github.state.calls.some((call) => call.kind === "delete-grant"),
        false,
      );

      // Cancelled consent keeps the public graph; Public only clears it.
      github.state.consent = { as: null, cancel: true };
      await controls.getByRole("button", { name: "Authorize again" }).click();
      await reopen();
      await privateStatus()
        .getByText(/Authorization was cancelled/)
        .waitFor({ timeout: 30000 });
      await controls
        .getByRole("status")
        .getByText(/Connected\. Fetched/)
        .waitFor();
      await controls
        .getByRole("button", { name: "Use public activity only" })
        .click();
      await privateStatus()
        .getByText(/Off\. Only public contributions are shown/)
        .waitFor();
      assert.equal(
        await controls
          .getByRole("switch", { name: /Include private activity/ })
          .isChecked(),
        false,
      );

      // Matching consent shows private counts in the owner preview only.
      github.state.consent = { as: null, cancel: false };
      await controls
        .getByRole("switch", { name: /Include private activity/ })
        .check();
      await controls
        .getByRole("button", { name: "Authorize private activity" })
        .click();
      await reopen();
      await privateStatus()
        .getByText(
          /Private activity authorized\. Fetched .* 10 contributions in the last year, including private ones/,
        )
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

      // Publish freezes the private choice: the live graph serves the
      // authorized calendar, as an allowlist of dates and counts.
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

      // Removing private access withdraws it at once, without Publish.
      await controls
        .getByRole("button", { name: "Remove private access" })
        .click();
      await controls
        .getByRole("button", { name: "Remove private access now" })
        .click();
      // Revocation at GitHub may still be running when the status is read.
      await privateStatus()
        .getByText(
          /Off\. Only public contributions are shown|Earlier private access is still being removed/,
        )
        .waitFor({ timeout: 30000 });
      assert.equal(total(await liveGraph()), 2);
      assert.equal((await connection()).token_enc, null);
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

      // Authorize again, then remove the whole graph: the dialog explains the
      // withdrawal, private counts leave the live site, sign-in is untouched.
      await controls
        .getByRole("switch", { name: /Include private activity/ })
        .check();
      await controls
        .getByRole("button", { name: "Authorize private activity" })
        .click();
      await reopen();
      await privateStatus()
        .getByText(/Private activity authorized/)
        .waitFor({ timeout: 30000 });
      assert.equal(total(await liveGraph()), 10);
      const sections = page.getByRole("region", {
        name: "Page",
        exact: true,
      });
      await sections
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
      assert.equal(total(await liveGraph()), 2);
      assert.equal(await settled(), "idle");
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
      github.state.callbackOrigin = new URL(page.url()).origin;
      let controls = await addGraph(page);
      await fetchFor(controls, "Refresh-Owner", /Connected\. Fetched/);
      await publish();
      assert.equal(total(await liveGraph()), 3);

      // A visit past the TTL gets the last good graph at once and one
      // background refresh; the live graph then updates without Publish.
      user.counts[recent] = 5;
      await ageCalendars();
      const stale = await liveGraph();
      assert.equal(total(stale), 3);
      assert.equal(stale.fetchedAt, agedAt);
      const fresh = await until(async () => {
        const graph = await liveGraph();
        return total(graph) === 5 && graph;
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
      assert.equal(total(await liveGraph()), 5);
      await until(
        async () =>
          (
            await sql(
              `SELECT public_error FROM github_activity WHERE portfolio_id=${portfolio}`,
            )
          )[0]?.public_error,
        "the failed refresh was not recorded",
      );
      const kept = await liveGraph();
      assert.equal(total(kept), 5);
      assert.equal(kept.fetchedAt, agedAt);
      const reopen = async () => {
        await page.waitForURL(/\/editor(\?github=consent)?$/, {
          timeout: 60000,
        });
        await page.waitForFunction(() => window.editorFixture?.ready);
        controls = page.getByRole("region", {
          name: "GitHub activity controls",
          exact: true,
        });
        await controls.waitFor({ timeout: 30000 });
      };
      // The fixed consent return reopens the GitHub section and reads status.
      await page.goto(new URL("/editor?github=consent", page.url()).href);
      await reopen();
      await controls
        .getByRole("status")
        .getByText(/Couldn't refresh GitHub\. Showing the graph from/)
        .waitFor({ timeout: 30000 });
      github.state.failure = null;
      await age();
      await controls.getByRole("button", { name: "Refresh activity" }).click();
      await controls
        .getByRole("status")
        .getByText(/Connected\. Fetched/)
        .waitFor({ timeout: 30000 });
      assert.equal(total(await liveGraph()), 5);

      // Private activity goes live with Publish.
      await controls
        .getByRole("switch", { name: /Include private activity/ })
        .check();
      await controls
        .getByRole("button", { name: "Authorize private activity" })
        .click();
      await reopen();
      const privateStatus = () =>
        controls.locator("[data-github-private-status]");
      await privateStatus()
        .getByText(/Private activity authorized/)
        .waitFor({ timeout: 30000 });
      await publish();
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
      await reopen();
      await privateStatus()
        .getByText(/GitHub no longer allows private access/)
        .waitFor({ timeout: 30000 });

      // Reconnect: authorizing again restores private counts without Publish.
      await controls.getByRole("button", { name: "Authorize again" }).click();
      await reopen();
      await privateStatus()
        .getByText(/Private activity authorized/)
        .waitFor({ timeout: 30000 });
      assert.equal(total(await liveGraph()), 9);
      page = getPage();
    },
  );

  await run(
    "Connected sign-in methods: disconnecting GitHub withdraws private activity through the same cleanup, keeps the last method, and reconnecting needs new consent",
    async () => {
      github.state.failure = null;
      github.state.consent = { as: null, cancel: false };
      github.addUser({
        login: "Signin-Owner",
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
      const settled = async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = (
            await sql(
              "SELECT state FROM github_grant WHERE github_user_id='node-signin-owner'",
            )
          )[0]?.state;
          if (state !== "pending" && state !== "inflight") return state;
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
      const link = (provider) => {
        const now = Date.now();
        return sql(
          "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          [
            `alice-${provider}`,
            `alice-${provider}-id`,
            provider,
            "draft-alice",
            now,
            now,
          ],
        );
      };
      let page = await start("signin-graph");
      github.state.callbackOrigin = new URL(page.url()).origin;
      let controls = await addGraph(page);
      const reopen = async () => {
        await page.waitForURL(/\/editor(\?github=consent)?$/, {
          timeout: 60000,
        });
        await page.waitForFunction(() => window.editorFixture?.ready);
        controls = page.getByRole("region", {
          name: "GitHub activity controls",
          exact: true,
        });
        await controls.waitFor({ timeout: 30000 });
      };
      const authorize = async () => {
        await controls
          .getByRole("switch", { name: /Include private activity/ })
          .check();
        await controls
          .getByRole("button", { name: "Authorize private activity" })
          .click();
        await reopen();
        await controls
          .locator("[data-github-private-status]")
          .getByText(/Private activity authorized/)
          .waitFor({ timeout: 30000 });
      };
      try {
        await sql("DELETE FROM account WHERE user_id='draft-alice'");
        await link("github");
        await link("google");
        await fetchFor(controls, "Signin-Owner", /Connected\. Fetched/);
        await authorize();
        await publish();
        assert.equal(await total(), 7);
        github.state.calls.length = 0;

        // Both methods are listed; either can be disconnected.
        await page.getByRole("button", { name: "Share", exact: true }).click();
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
        // counts leave the live site without Publish and the grant is revoked.
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
          github.state.calls.some((call) => call.kind === "delete-grant"),
        );
        await flush();
        assert.equal(
          (await savedDraft()).components.find((item) => item.type === "github")
            .data.includePrivate,
          false,
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

        // Reconnected sign-in restores nothing by itself: private activity
        // needs new consent, which proceeds because the cleanup finished.
        await link("github");
        await page.goto(`${editorOrigin}/editor?account=connected`);
        await page.waitForFunction(() => window.editorFixture?.ready);
        await methods
          .getByRole("status")
          .getByText(/Sign-in method connected/)
          .waitFor();
        await row("github").getByText("Connected", { exact: true }).waitFor();
        assert.equal(new URL(page.url()).search, "");
        await page.getByRole("button", { name: "Build", exact: true }).click();
        await page
          .getByRole("region", { name: "Page", exact: true })
          .getByRole("button", { name: "GitHub activity", exact: true })
          .click();
        controls = page.getByRole("region", {
          name: "GitHub activity controls",
          exact: true,
        });
        assert.equal(
          await controls
            .getByRole("switch", { name: /Include private activity/ })
            .isChecked(),
          false,
        );
        assert.equal((await connection()).private_enabled, 0);
        await authorize();
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
