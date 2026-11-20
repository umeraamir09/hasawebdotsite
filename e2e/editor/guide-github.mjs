import assert from "node:assert/strict";
import { join } from "node:path";
import { addLink } from "./links.mjs";

const day = (offset) =>
  new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

// Phase 42D: the optional GitHub screen of the setup guide (ON-08 to ON-11),
// against the production owner routes and the local GitHub stand-in. The
// guide is mounted only by the isolated fixture at `/guide`; the harness also
// serves it at the fixed setup consent return, `/auth/entry`.
export async function checkGuideGitHub({
  guarded,
  reset,
  guidePage,
  provision,
  open,
  waitStep,
  field,
  addressStatus,
  proceed,
  portfolio,
  suffix,
  sql,
  evidence,
  browserOrigin,
  github,
}) {
  const recent = day(-2);
  const owner = "(SELECT id FROM portfolio WHERE user_id='draft-alice')";
  const stored = async () =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'"))[0]
        .draft,
    );
  const graphOf = async (page) => {
    await page.locator('[data-save-status="saved"]').waitFor();
    return (await stored()).components.find((item) => item.type === "github");
  };
  const connection = async () =>
    (
      await sql(
        `SELECT login,private_enabled,status,token_enc,generation FROM github_connection WHERE portfolio_id=${owner}`,
      )
    )[0];
  const grant = async (login) =>
    (
      await sql(
        "SELECT state,retry_at FROM github_grant WHERE github_user_id=?",
        [`node-${login.toLowerCase()}`],
      )
    )[0];
  const validToken = (login) =>
    [...github.tokens.values()].some(
      (item) => item.login === login.toLowerCase() && item.valid,
    );
  const signIns = async () =>
    (
      await sql(
        "SELECT count(*) n FROM account WHERE user_id='draft-alice' AND provider_id='github'",
      )
    )[0].n;
  // The 10-second setup cooldown is real. Age the last check instead.
  const age = () =>
    sql(
      `UPDATE github_connection SET last_checked_at=last_checked_at-60000 WHERE portfolio_id=${owner}`,
    );
  const until = async (page, check, message) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await page.waitForTimeout(150);
    }
    throw new Error(message);
  };
  const panel = (page) =>
    page.getByRole("region", { name: "GitHub activity controls", exact: true });
  const publicStatus = (page) => panel(page).locator("[data-github-status]");
  const privateStatus = (page) =>
    panel(page).locator("[data-github-private-status]");
  const alert = (page, text) =>
    page.getByRole("alert").filter({ hasText: text }).waitFor();
  const click = (page, name) =>
    page.getByRole("button", { name, exact: true }).click();
  const savedStep = (page, step) =>
    until(page, async () => (await portfolio()).step === step, `step ${step}`);

  // Address, Profile and Links through the real screens, then Skills and
  // Projects skipped, so each group can run alone.
  async function toGitHub(link = "https://example.com") {
    await reset();
    const page = await guidePage();
    await provision(page, "alice");
    github.state.callbackOrigin = browserOrigin;
    github.state.failure = null;
    github.state.activityFailure = null;
    github.state.revokeFailure = null;
    github.state.consent = { as: null, cancel: false, hold: false };
    await open(page);
    await field(page).fill(`gh-${suffix()}`);
    await field(page).press("Tab");
    await addressStatus(page).filter({ hasText: "Available now" }).waitFor();
    await proceed(page);
    await waitStep(page, "profile");
    const png = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 900;
        canvas.height = 600;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#3a7d2c";
        ctx.fillRect(0, 0, 900, 600);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }),
    );
    await page.getByLabel("Name", { exact: true }).fill("Graph Guide");
    await page.getByLabel("Bio", { exact: true }).fill("I ship code.");
    for (const purpose of ["avatar", "banner"]) {
      await page
        .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`), {
          exact: true,
        })
        .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
      await page.getByRole("dialog", { name: `Adjust ${purpose}` }).waitFor();
      await click(page, "Apply crop");
      await page
        .getByRole("region", {
          name: `${purpose === "avatar" ? "Avatar" : "Banner"} image`,
          exact: true,
        })
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor();
    }
    await proceed(page);
    await waitStep(page, "links");
    await addLink(page);
    await page.getByLabel("Link label").fill("Profile");
    await page.getByLabel("Destination URL").fill(link);
    await proceed(page);
    await waitStep(page, "skills");
    await click(page, "Skip this step");
    await waitStep(page, "projects");
    await click(page, "Skip this step");
    await waitStep(page, "github");
    await savedStep(page, "github");
    return page;
  }
  async function back(page) {
    await click(page, "Back");
    await waitStep(page, "github");
  }
  // Accepts a username through the shared panel and waits for its status.
  async function fetchFor(page, login, expected) {
    await age().catch(() => {});
    await panel(page).getByLabel("GitHub username").fill(login);
    await panel(page)
      .getByRole("button", {
        name: /^(Fetch activity|Retry|Refresh activity)$/,
      })
      .click();
    await publicStatus(page).getByText(expected).waitFor({ timeout: 30000 });
  }
  // Leaves for GitHub in the same tab and comes back to the saved step.
  async function authorize(page, name = "Authorize private activity") {
    await panel(page).getByRole("button", { name, exact: true }).click();
    if (github.state.consent.hold) {
      await until(page, () => github.state.held, "consent was not held");
      return;
    }
    await returned(page);
  }
  async function returned(page) {
    await page.waitForURL(/\/auth\/entry$/, { timeout: 60000 });
    await page.waitForFunction(() => window.guideFixture?.ready);
    await waitStep(page, "github");
    await panel(page).waitFor({ timeout: 30000 });
  }
  async function deliver(page) {
    const url = github.state.held;
    github.state.held = null;
    await page.goto(url);
    await returned(page);
    return url;
  }
  const includePrivate = (page) =>
    panel(page).getByRole("switch", { name: /Include private activity/ });

  await guarded(
    "setup guide GitHub: explicit Add graph without sign-in linking, zero contributions, failed first fetch, Retry and Finish later",
    async () => {
      github.addUser({ login: "Guide-Zero" });
      github.addUser({ login: "Guide-Fail", counts: { [recent]: 3 } });
      // A Google owner whose profile links to GitHub: nothing is inferred.
      const page = await toGitHub("https://github.com/Guide-Zero");
      assert.equal(await signIns(), 0);
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        "Your activity, at a glance",
      );
      assert.equal(await panel(page).count(), 0);
      assert.equal(await graphOf(page), undefined);
      assert.equal(await connection(), undefined);
      for (const name of ["Skip this step", "Skip remaining steps", "Continue"])
        assert.equal(
          await page.getByRole("button", { name, exact: true }).count(),
          1,
        );

      // Continue without a graph adds nothing.
      await proceed(page);
      await waitStep(page, "review");
      assert.equal(await graphOf(page), undefined);
      await back(page);

      // Add graph shows the shared panel with no detected suggestion and no
      // selection: the owner types any public username.
      await click(page, "Add graph");
      await panel(page).waitFor();
      assert.equal(
        await panel(page)
          .getByText(/We detected/)
          .count(),
        0,
      );
      assert.equal(
        await panel(page).getByLabel("GitHub username").inputValue(),
        "",
      );
      // Continue before any fetch keeps the owner here.
      await proceed(page);
      await alert(page, "Fetch activity for your GitHub username");
      assert.equal((await portfolio()).step, "github");
      assert.equal(await graphOf(page), undefined);

      // Zero contributions is a valid, complete graph.
      await fetchFor(page, "guide-zero", /No public contributions/);
      assert.deepEqual((await graphOf(page)).data, {
        username: "Guide-Zero",
        includePrivate: false,
      });
      await page.screenshot({ path: join(evidence, "guide-github-zero.png") });
      await proceed(page);
      await waitStep(page, "review");
      await savedStep(page, "review");
      await back(page);

      // An outage before the account resolves selects nothing and keeps the
      // existing graph.
      github.state.failure = 503;
      await age();
      await panel(page).getByLabel("GitHub username").fill("Guide-Fail");
      await panel(page).getByRole("button", { name: "Fetch activity" }).click();
      await panel(page)
        .getByRole("alert")
        .getByText(/GitHub couldn't be reached/)
        .waitFor({ timeout: 30000 });
      assert.equal((await graphOf(page)).data.username, "Guide-Zero");
      assert.equal((await connection()).login, "Guide-Zero");
      github.state.failure = null;

      // A failed first fetch keeps the selection, blocks Continue and offers
      // Retry and Finish later, which keeps the unfinished graph.
      github.state.activityFailure = 502;
      await fetchFor(page, "Guide-Fail", /GitHub couldn't be reached/);
      assert.equal((await graphOf(page)).data.username, "Guide-Fail");
      await proceed(page);
      await alert(page, "hasn't been fetched successfully yet");
      assert.equal((await portfolio()).step, "github");
      await page.screenshot({
        path: join(evidence, "guide-github-failed.png"),
      });
      await click(page, "Finish later in the editor");
      await waitStep(page, "review");
      await savedStep(page, "review");
      const unfinished = await graphOf(page);
      assert.equal(unfinished.data.username, "Guide-Fail");
      assert.equal((await connection()).login, "Guide-Fail");
      assert.equal(
        (
          await sql(
            `SELECT public_calendar FROM github_activity WHERE portfolio_id=${owner}`,
          )
        )[0]?.public_calendar ?? null,
        null,
      );

      // Back, Retry once GitHub recovers, then Continue.
      await back(page);
      github.state.activityFailure = null;
      await age();
      await panel(page).getByRole("button", { name: "Retry" }).click();
      await publicStatus(page)
        .getByText(/Connected\. Fetched .* 3 public contributions/)
        .waitFor({ timeout: 30000 });
      assert.equal(
        await page.locator("[data-guide-github-unfinished]").count(),
        0,
      );
      await proceed(page);
      await waitStep(page, "review");
      const kept = (await stored()).components.filter(
        (item) => item.type === "github",
      );
      assert.equal(kept.length, 1);
      assert.equal(kept[0].id, unfinished.id);
      // Public setup never links GitHub sign-in.
      assert.equal(await signIns(), 0);
    },
  );

  await guarded(
    "setup guide GitHub: a GitHub signup suggests its username without selecting it",
    async () => {
      github.addUser({
        login: "Guide-Hub",
        databaseId: 7342,
        counts: { [recent]: 2 },
      });
      const page = await toGitHub();
      await sql(
        "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('guide-github-account','7342','github','draft-alice',?,?)",
        [Date.now(), Date.now()],
      );
      try {
        await open(page, "github");
        // Signup alone adds nothing.
        assert.equal(await graphOf(page), undefined);
        assert.equal(await panel(page).count(), 0);
        await click(page, "Add graph");
        await panel(page)
          .getByText(/We detected @Guide-Hub from your GitHub sign-in/)
          .waitFor({ timeout: 30000 });
        assert.equal(await connection(), undefined);
        // Skipping after seeing the suggestion still adds nothing.
        await click(page, "Skip this step");
        await waitStep(page, "review");
        assert.equal(await graphOf(page), undefined);
        assert.equal(await connection(), undefined);
        await back(page);
        await click(page, "Add graph");
        await panel(page)
          .getByRole("button", { name: "Use @Guide-Hub" })
          .click();
        assert.equal(
          await panel(page).getByLabel("GitHub username").inputValue(),
          "Guide-Hub",
        );
        assert.equal(await connection(), undefined);
        await panel(page)
          .getByRole("button", { name: "Fetch activity" })
          .click();
        await publicStatus(page)
          .getByText(/Connected\. Fetched/)
          .waitFor({ timeout: 30000 });
        assert.deepEqual((await graphOf(page)).data, {
          username: "Guide-Hub",
          includePrivate: false,
        });
        // No private consent is inferred from the GitHub sign-in either.
        assert.equal((await connection()).private_enabled, 0);
        assert.equal(
          await privateStatus(page).getAttribute("data-github-private-status"),
          "off",
        );
      } finally {
        await sql("DELETE FROM account WHERE id='guide-github-account'");
      }
    },
  );

  await guarded(
    "setup guide GitHub: private consent returns to the saved step; wrong account, cancel and Public only keep the public graph",
    async () => {
      github.addUser({
        login: "Guide-Private",
        counts: { [recent]: 2 },
        privateCounts: { [recent]: 5 },
      });
      github.addUser({ login: "Guide-Other", counts: { [recent]: 1 } });
      const page = await toGitHub();
      await click(page, "Add graph");
      await fetchFor(page, "Guide-Private", /Connected\. Fetched/);
      await includePrivate(page).check();
      await privateStatus(page)
        .getByText(/Authorize the username above/)
        .waitFor();
      // Requested private activity is unfinished until authorized.
      await proceed(page);
      await alert(page, "Private activity isn't authorized");
      assert.equal(
        await page
          .getByRole("button", { name: "Finish later in the editor" })
          .count(),
        1,
      );

      // A different GitHub account changes nothing and reports no success.
      github.state.consent = { as: "Guide-Other", cancel: false, hold: false };
      await authorize(page);
      assert.equal(new URL(page.url()).search, "");
      await privateStatus(page)
        .getByText(/GitHub authorized a different account, so nothing changed/)
        .waitFor({ timeout: 30000 });
      assert.equal(
        await panel(page).getByLabel("GitHub username").inputValue(),
        "Guide-Private",
      );
      assert.deepEqual((await graphOf(page)).data, {
        username: "Guide-Private",
        includePrivate: true,
      });
      let stored = await connection();
      assert.equal(stored.login, "Guide-Private");
      assert.equal(stored.private_enabled, 0);
      assert.equal(stored.token_enc, null);
      await publicStatus(page)
        .getByText(/Connected\. Fetched/)
        .waitFor();

      // Cancelled consent keeps the public graph; Public only clears it.
      github.state.consent = { as: null, cancel: true, hold: false };
      await authorize(page, "Authorize again");
      await privateStatus(page)
        .getByText(/Authorization was cancelled/)
        .waitFor({ timeout: 30000 });
      await publicStatus(page)
        .getByText(/Connected\. Fetched/)
        .waitFor();
      await panel(page)
        .getByRole("button", { name: "Use public activity only" })
        .click();
      await privateStatus(page)
        .getByText(/Off\. Only public contributions are shown/)
        .waitFor();
      assert.equal((await graphOf(page)).data.includePrivate, false);
      await proceed(page);
      await waitStep(page, "review");
      await back(page);

      // Matching consent returns to this step with private counts.
      github.state.consent = { as: null, cancel: false, hold: false };
      await includePrivate(page).check();
      await authorize(page);
      await privateStatus(page)
        .getByText(/Private activity authorized\. Fetched .* 7 contributions/)
        .waitFor({ timeout: 30000 });
      stored = await connection();
      assert.equal(stored.private_enabled, 1);
      assert.doesNotMatch(String(stored.token_enc), /gho_fixture/);
      assert.equal((await portfolio()).step, "github");
      await page.screenshot({
        path: join(evidence, "guide-github-private.png"),
      });
      await proceed(page);
      await waitStep(page, "review");
      assert.equal((await graphOf(page)).data.includePrivate, true);
      // Activity consent gives a Google owner no GitHub sign-in.
      assert.equal(await signIns(), 0);
    },
  );

  await guarded(
    "setup guide GitHub: signed-out, other-session, expired and replayed consent callbacks keep input and report no success",
    async () => {
      github.addUser({
        login: "Guide-Session",
        counts: { [recent]: 1 },
        privateCounts: { [recent]: 2 },
      });
      const page = await toGitHub();
      await click(page, "Add graph");
      await fetchFor(page, "Guide-Session", /Connected\. Fetched/);
      await includePrivate(page).check();
      const exchanges = () =>
        github.state.calls.filter((call) => call.kind === "exchange").length;
      const before = exchanges();
      github.state.consent = { as: null, cancel: false, hold: true };
      await authorize(page);
      const held = github.state.held;
      assert.ok(held.startsWith(`${browserOrigin}/api/owner/github/consent/`));

      // The session ended: the callback returns to sign-in handling and
      // consumes nothing.
      const signedOut = await fetch(held, { redirect: "manual" });
      assert.equal(signedOut.status, 303);
      assert.equal(signedOut.headers.get("location"), "/editor?github=consent");
      assert.equal(
        (
          await sql(
            `SELECT state FROM github_consent WHERE portfolio_id=${owner} ORDER BY created_at DESC LIMIT 1`,
          )
        )[0].state,
        "issued",
      );

      // After session recovery (another session for the same owner), the
      // guide resumes at the saved GitHub step with the owner's input.
      const rows = await sql(
        "SELECT id FROM session WHERE id='draft-session-alice-other'",
      );
      assert.equal(rows.length, 1, "the recovery session exists");
      await sql(
        "UPDATE session SET expires_at=? WHERE id='draft-session-alice-other'",
        [Date.now() + 3600000],
      );
      await page.context().addCookies([
        {
          name: "fixture-session",
          value: "alice-other",
          url: browserOrigin,
        },
      ]);
      try {
        await open(page, "github");
        await panel(page).waitFor();
        assert.equal(
          await panel(page).getByLabel("GitHub username").inputValue(),
          "Guide-Session",
        );
        assert.equal(await includePrivate(page).isChecked(), true);
        await privateStatus(page)
          .getByText(/Waiting for GitHub authorization/)
          .waitFor({ timeout: 30000 });

        // The old session's callback cannot complete in the new session.
        await deliver(page);
        assert.equal(new URL(page.url()).search, "");
        await privateStatus(page)
          .getByText(/Waiting for GitHub authorization/)
          .waitFor({ timeout: 30000 });
        assert.equal((await connection()).private_enabled, 0);
        assert.equal(exchanges(), before);

        // An expired attempt is released and reported, never connected.
        await authorize(page, "Authorize again");
        await sql(
          `UPDATE github_consent SET expires_at=? WHERE portfolio_id=${owner} AND state='issued'`,
          [Date.now() - 1000],
        );
        await deliver(page);
        await privateStatus(page)
          .getByText(/The authorization link expired/)
          .waitFor({ timeout: 30000 });
        assert.equal((await connection()).private_enabled, 0);
        assert.equal(exchanges(), before);
        assert.equal((await graphOf(page)).data.includePrivate, true);

        // A valid callback connects once; replaying it changes nothing.
        await authorize(page, "Authorize again");
        const valid = await deliver(page);
        await privateStatus(page)
          .getByText(/Private activity authorized/)
          .waitFor({ timeout: 30000 });
        const connected = await connection();
        assert.equal(connected.private_enabled, 1);
        const after = exchanges();
        assert.equal(after, before + 1);
        await page.goto(valid);
        await returned(page);
        await privateStatus(page)
          .getByText(/Private activity authorized/)
          .waitFor({ timeout: 30000 });
        assert.equal(exchanges(), after);
        assert.equal((await connection()).generation, connected.generation);
        assert.equal((await portfolio()).step, "github");
      } finally {
        github.state.consent = { as: null, cancel: false, hold: false };
        github.state.held = null;
        await page
          .context()
          .addCookies([
            { name: "fixture-session", value: "alice", url: browserOrigin },
          ]);
      }
    },
  );

  await guarded(
    "setup guide GitHub: Skip keeps the graph and access; confirmed removal withdraws despite failed revocation; reconnect survives the old cleanup",
    async () => {
      github.addUser({
        login: "Guide-Remove",
        counts: { [recent]: 4 },
        privateCounts: { [recent]: 6 },
      });
      const page = await toGitHub();
      await click(page, "Add graph");
      await fetchFor(page, "Guide-Remove", /Connected\. Fetched/);
      await includePrivate(page).check();
      await authorize(page);
      await privateStatus(page)
        .getByText(/Private activity authorized/)
        .waitFor({ timeout: 30000 });
      const graphId = (await graphOf(page)).id;

      // Skipping never disconnects or removes anything.
      for (const name of ["Skip this step", "Skip remaining steps"]) {
        await click(page, name);
        await waitStep(page, "review");
        await savedStep(page, "review");
        assert.equal((await graphOf(page)).id, graphId);
        const kept = await connection();
        assert.equal(kept.private_enabled, 1);
        assert.notEqual(kept.token_enc, null);
        assert.equal((await grant("Guide-Remove")).state, "active");
        await back(page);
      }

      // Confirmed removal explains and withdraws private access at once, even
      // while revocation at GitHub fails and stays queued.
      github.state.revokeFailure = 500;
      await click(page, "Remove graph");
      const dialog = page.getByRole("dialog");
      await dialog
        .getByText(
          /also removes private activity access now, without publishing/,
        )
        .waitFor();
      await dialog.getByText(/Your GitHub sign-in stays connected/).waitFor();
      await click(page, "Remove section");
      await page.getByRole("button", { name: "Add graph" }).waitFor({
        timeout: 30000,
      });
      assert.equal(await graphOf(page), undefined);
      let row = await connection();
      assert.equal(row.private_enabled, 0);
      assert.equal(row.token_enc, null);
      assert.equal(
        (
          await sql(
            `SELECT authorized_calendar FROM github_activity WHERE portfolio_id=${owner}`,
          )
        )[0]?.authorized_calendar ?? null,
        null,
      );
      await until(
        page,
        async () => (await grant("Guide-Remove"))?.state === "pending",
        "failed revocation was not queued for retry",
      );
      assert.ok(validToken("Guide-Remove"), "GitHub still holds the grant");

      // Re-adding works with public activity; new private consent waits for
      // the earlier cleanup.
      await click(page, "Add graph");
      await fetchFor(page, "Guide-Remove", /Connected\. Fetched/);
      await includePrivate(page).check();
      await privateStatus(page)
        .getByText(/Earlier private access is still being removed/)
        .waitFor({ timeout: 30000 });
      assert.equal(
        await panel(page)
          .getByRole("button", { name: /^Authorize/ })
          .count(),
        0,
      );
      const busy = await page.evaluate(async () => {
        const response = await fetch("/api/owner/github/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ returnTo: "setup" }),
        });
        return { status: response.status, body: await response.json() };
      });
      assert.deepEqual(busy, { status: 409, body: { error: "consent_busy" } });
      // Public activity only still completes the step. The click resolves
      // on event dispatch, before `choosePublicOnly()`'s request and the
      // draft update settle, so wait for the switch to actually uncheck
      // (same tick as the draft write) before Continue rereads it. The
      // grant's own cleanup stays pending regardless, tested below.
      await panel(page)
        .getByRole("button", { name: "Use public activity only" })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role="switch"]')
            ?.getAttribute("aria-checked") === "false",
        undefined,
        { timeout: 10000 },
      );
      await proceed(page);
      await waitStep(page, "review");
      await back(page);

      // GitHub recovers; the next due cleanup revokes the old grant.
      github.state.revokeFailure = null;
      await sql("UPDATE github_grant SET retry_at=0 WHERE github_user_id=?", [
        "node-guide-remove",
      ]);
      await age();
      await panel(page)
        .getByRole("button", { name: /^(Retry|Refresh activity)$/ })
        .click();
      await until(
        page,
        async () => (await grant("Guide-Remove"))?.state === "idle",
        "cleanup did not finish",
      );
      assert.equal(validToken("Guide-Remove"), false);

      // Reconnect, then let an old cleanup run again: the fresh grant stays.
      await includePrivate(page).check();
      await authorize(page);
      await privateStatus(page)
        .getByText(/Private activity authorized/)
        .waitFor({ timeout: 30000 });
      assert.ok(validToken("Guide-Remove"));
      const fresh = await connection();
      await sql("UPDATE github_grant SET retry_at=0 WHERE github_user_id=?", [
        "node-guide-remove",
      ]);
      await age();
      await panel(page)
        .getByRole("button", { name: /^(Retry|Refresh activity)$/ })
        .click();
      await publicStatus(page)
        .getByText(/Connected\. Fetched/)
        .waitFor({ timeout: 30000 });
      assert.ok(validToken("Guide-Remove"), "the old cleanup revoked nothing");
      assert.equal((await grant("Guide-Remove")).state, "active");
      row = await connection();
      assert.equal(row.private_enabled, 1);
      assert.ok(row.generation >= fresh.generation);
      await proceed(page);
      await waitStep(page, "review");
      assert.equal(await signIns(), 0);
      await reset();
    },
  );
}
