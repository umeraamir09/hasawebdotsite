import assert from "node:assert/strict";
import { join } from "node:path";
import { addLink } from "./links.mjs";

const day = (offset) =>
  new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

// Phase 42D: the optional GitHub screen of the setup guide (ON-08 to ON-11),
// against the production owner routes and the local GitHub stand-in. A
// GitHub sign-up sees its own graph connected; a Google owner connects
// GitHub as a sign-in method. The guide is mounted only by the isolated
// fixture at `/guide`; the harness also serves it at the fixed setup
// consent return, `/auth/entry`.
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
  const grant = async (login, app = "activity-fixture-client") =>
    (
      await sql(
        "SELECT state,retry_at FROM github_grant WHERE github_user_id=? AND app_id=?",
        [`node-${login.toLowerCase()}`, app],
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
  const status = (page) => panel(page).locator("[data-github-status]");
  const pill = (page, label) =>
    panel(page).locator(".guide-big-field").getByText(label, { exact: true });
  const alert = (page, text) =>
    page.getByRole("alert").filter({ hasText: text }).waitFor();
  const click = (page, name) =>
    page.getByRole("button", { name, exact: true }).click();
  const savedStep = (page, step) =>
    until(page, async () => (await portfolio()).step === step, `step ${step}`);

  // Address, Profile and Links through the real screens, then Skills and
  // Projects skipped, so each group can run alone.
  async function toGitHub(link = "https://example.com") {
    // Clear GitHub rows while the portfolio still exists, then drop it.
    // Prior groups leave grants, consents, a linked account, or a graph.
    await sql(
      "UPDATE github_grant SET state='idle', token_enc=NULL, retry_at=0",
    );
    await sql(
      "DELETE FROM account WHERE user_id='draft-alice' AND provider_id='github'",
    );
    await sql(
      `DELETE FROM github_consent WHERE user_id='draft-alice' OR portfolio_id=${owner}`,
    );
    await sql(`DELETE FROM github_activity WHERE portfolio_id=${owner}`);
    await sql(`DELETE FROM github_connection WHERE portfolio_id=${owner}`);
    await reset();
    const page = await guidePage();
    await provision(page, "alice");
    github.state.callbackOrigin = browserOrigin;
    github.state.failure = null;
    github.state.activityFailure = null;
    github.state.revokeFailure = null;
    github.state.held = null;
    github.state.consent = { as: null, cancel: false, hold: false };
    await open(page);
    await field(page).fill(`gh-${suffix()}`);
    await field(page).press("Tab");
    await addressStatus(page).filter({ hasText: "Available" }).waitFor();
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
    await addLink(page, link, "Profile");
    await proceed(page);
    await waitStep(page, "skills");
    await click(page, "Skip");
    await waitStep(page, "projects");
    await click(page, "Skip");
    await waitStep(page, "github");
    await savedStep(page, "github");
    return page;
  }
  async function back(page) {
    await click(page, "Back");
    await waitStep(page, "github");
  }
  async function returned(page) {
    await page.waitForURL(/\/auth\/entry/, { timeout: 60000 });
    await page.waitForFunction(() => window.guideFixture?.ready);
    await waitStep(page, "github");
    await panel(page).waitFor({ timeout: 30000 });
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
        "guide-github-link",
        accountId,
        "github",
        "draft-alice",
        token,
        Date.now(),
        Date.now(),
      ],
    );
  }
  // Connect from a usable GitHub sign-in token (no second authorization).
  async function connectLinked(page, login) {
    await age().catch(() => {});
    await setGithubSignIn(login);
    await open(page, "github");
    // Wait for auto-connect from the linked token. Only click Connect if it
    // stays offered (for example after a remount that skipped auto-connect).
    try {
      await connected(page);
      return;
    } catch {
      // Auto-connect did not finish; fall through to Connect GitHub.
    }
    await panel(page).getByRole("button", { name: "Connect GitHub" }).click();
    await connected(page);
  }
  // Authorize the linked account when its sign-in token cannot be used.
  // Returns to the saved step unless the stand-in holds the callback.
  async function chooseAccount(page, login) {
    await age().catch(() => {});
    await setGithubSignIn(login, null);
    await open(page, "github");
    await page
      .locator('[data-save-status="saved"]')
      .waitFor({ timeout: 30000 });
    await age();
    // Connect with a null token runs detect → setup → authorize on GitHub.
    const authorize = panel(page).getByRole("button", {
      name: /^Authorize (again|on GitHub)$/,
    });
    const connect = panel(page).getByRole("button", { name: "Connect GitHub" });
    if (await authorize.count()) await authorize.click();
    else await connect.click();
    if (github.state.consent.hold) {
      await until(page, () => github.state.held, "consent was not held");
      return;
    }
    await returned(page);
  }
  async function authorizeAgain(page) {
    await panel(page)
      .getByRole("button", { name: /^Authorize (again|on GitHub)$/ })
      .click();
    if (github.state.consent.hold) {
      await until(page, () => github.state.held, "consent was not held");
      return;
    }
    await returned(page);
  }
  async function deliver(page) {
    const url = github.state.held;
    github.state.held = null;
    await page.goto(url);
    await returned(page);
    return url;
  }
  const connected = (page) =>
    pill(page, "Connected").waitFor({ timeout: 30000 });
  // Runs due revocations now, as the owner routes do after a retry.
  const sweep = (page) =>
    page.evaluate(() =>
      fetch("/api/owner/github/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((response) => response.status),
    );

  await guarded(
    "setup guide GitHub: a Google owner connects GitHub sign-in; zero contributions; Continue adds it",
    async () => {
      github.addUser({ login: "Guide-Zero", databaseId: 6100 });
      // A Google owner whose profile links to GitHub: nothing is inferred.
      const page = await toGitHub("https://github.com/Guide-Zero");
      assert.equal(await signIns(), 0);
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        "Add your GitHub activity",
      );
      await panel(page)
        .getByRole("button", { name: "Connect GitHub" })
        .waitFor();
      assert.equal(await panel(page).getByLabel("GitHub username").count(), 0);
      assert.equal(await graphOf(page), undefined);
      assert.equal(await connection(), undefined);
      for (const name of ["Skip", "Skip to review", "Review"])
        assert.equal(
          await page.getByRole("button", { name, exact: true }).count(),
          1,
        );

      // Continue without a graph adds nothing.
      await proceed(page);
      await waitStep(page, "review");
      assert.equal(await graphOf(page), undefined);
      await back(page);

      // Zero contributions is a valid, complete graph once GitHub is linked.
      // Continue adds it to the draft. (Linking GitHub as a sign-in method is
      // what Connect GitHub starts; the auth project covers that hop.)
      await connectLinked(page, "Guide-Zero");
      await connected(page);
      await panel(page)
        .getByLabel("Contribution graph")
        .getByText("0 contributions")
        .waitFor();
      assert.equal(await graphOf(page), undefined);
      assert.equal(await signIns(), 1);
      await page.screenshot({ path: join(evidence, "guide-github-zero.png") });
      await proceed(page);
      await waitStep(page, "review");
      await savedStep(page, "review");
      assert.deepEqual((await graphOf(page)).data, {
        username: "Guide-Zero",
        includePrivate: true,
      });
    },
  );

  await guarded(
    "setup guide GitHub: a GitHub signup sees its own graph connected; Skip leaves it out and withdraws access, Continue adds it",
    async () => {
      github.addUser({
        login: "Guide-Hub",
        databaseId: 7342,
        counts: { [recent]: 2 },
        privateCounts: { [recent]: 3 },
      });
      const page = await toGitHub();
      const signIn = (token) =>
        sql(
          "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES('guide-github-account','7342','github','draft-alice',?,?,?) ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token",
          [token, Date.now(), Date.now()],
        );
      const first = github.issueSignInToken("Guide-Hub");
      await signIn(first);
      try {
        github.state.calls.length = 0;
        await open(page, "github");
        // The sign-in's graph is connected on open, public and private,
        // with no GitHub page in between. It is not added yet.
        await connected(page);
        await panel(page).getByRole("link", { name: "@Guide-Hub" }).waitFor();
        await panel(page)
          .getByLabel("Contribution graph")
          .getByText("5 contributions")
          .waitFor();
        assert.equal(
          github.state.calls.some((call) => call.kind === "authorize"),
          false,
        );
        assert.equal(await graphOf(page), undefined);
        assert.equal((await connection()).private_enabled, 1);
        assert.equal((await grant("Guide-Hub", "fixture")).state, "active");
        await page.screenshot({
          path: join(evidence, "guide-github-sign-in.png"),
        });

        // Skip leaves the graph out and withdraws the unused access.
        await click(page, "Skip");
        await waitStep(page, "review");
        assert.equal(await graphOf(page), undefined);
        assert.equal((await connection()).private_enabled, 0);
        await until(
          page,
          async () => (await grant("Guide-Hub", "fixture"))?.state === "idle",
          "the skipped graph's access was not revoked",
        );
        assert.equal(validToken("Guide-Hub"), false);

        // Signing in again issues a new token. Back remounts the step, which
        // connects from the new sign-in. A full reload here would race the
        // Back save and leave IndexedDB recovery that blocks Continue.
        await signIn(github.issueSignInToken("Guide-Hub"));
        await age();
        await back(page);
        await page.locator('[data-save-status="saved"]').waitFor();
        await connected(page);
        await proceed(page);
        await waitStep(page, "review");
        assert.deepEqual((await graphOf(page)).data, {
          username: "Guide-Hub",
          includePrivate: true,
        });
        assert.equal(
          github.state.calls.some((call) => call.kind === "authorize"),
          false,
        );
      } finally {
        await sql("DELETE FROM account WHERE id='guide-github-account'");
      }
    },
  );

  await guarded(
    "setup guide GitHub: sign-in reauthorize consent returns to the saved step; wrong account and cancel connect nothing",
    async () => {
      github.addUser({
        login: "Guide-Private",
        databaseId: 6200,
        counts: { [recent]: 2 },
        privateCounts: { [recent]: 5 },
      });
      github.addUser({
        login: "Guide-Other",
        databaseId: 6201,
        counts: { [recent]: 1 },
      });
      const page = await toGitHub();

      // A different GitHub account changes nothing and reports no success.
      github.state.consent = { as: "Guide-Other", cancel: false, hold: false };
      await chooseAccount(page, "Guide-Private");
      assert.equal(new URL(page.url()).search, "");
      await status(page)
        .getByText(/GitHub authorized a different account, so nothing changed/)
        .waitFor({ timeout: 30000 });
      await panel(page).getByRole("link", { name: "@Guide-Private" }).waitFor();
      assert.deepEqual((await graphOf(page)).data, {
        username: "Guide-Private",
        includePrivate: true,
      });
      let stored = await connection();
      assert.equal(stored.login, "Guide-Private");
      assert.equal(stored.private_enabled, 0);
      assert.equal(stored.token_enc, null);
      // The graph is unfinished until the account is authorized.
      await proceed(page);
      await alert(page, "isn't authorized yet");
      assert.equal(
        await page
          .getByRole("button", { name: "Finish later in the editor" })
          .count(),
        1,
      );

      // A cancelled authorization keeps the selection.
      github.state.consent = { as: null, cancel: true, hold: false };
      await authorizeAgain(page);
      await status(page)
        .getByText(/Authorization was cancelled/)
        .waitFor({ timeout: 30000 });
      assert.equal((await connection()).private_enabled, 0);

      // Matching consent returns to this step with all counts.
      github.state.consent = { as: null, cancel: false, hold: false };
      await authorizeAgain(page);
      await connected(page);
      await panel(page)
        .getByLabel("Contribution graph")
        .getByText("7 contributions")
        .waitFor();
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
      // Reauthorize still uses the linked GitHub sign-in account.
      assert.equal(await signIns(), 1);
    },
  );

  await guarded(
    "setup guide GitHub: signed-out, other-session, expired and replayed consent callbacks keep input and report no success",
    async () => {
      github.addUser({
        login: "Guide-Session",
        databaseId: 6202,
        counts: { [recent]: 1 },
        privateCounts: { [recent]: 2 },
      });
      const page = await toGitHub();
      const exchanges = () =>
        github.state.calls.filter((call) => call.kind === "exchange").length;
      const before = exchanges();
      github.state.consent = { as: null, cancel: false, hold: true };
      await chooseAccount(page, "Guide-Session");
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
        await panel(page)
          .getByRole("link", { name: "@Guide-Session" })
          .waitFor();
        await status(page)
          .getByText(/Waiting for GitHub/)
          .waitFor({ timeout: 30000 });

        // The old session's callback cannot complete in the new session.
        await deliver(page);
        assert.equal(new URL(page.url()).search, "");
        await status(page)
          .getByText(/Waiting for GitHub/)
          .waitFor({ timeout: 30000 });
        assert.equal((await connection()).private_enabled, 0);
        assert.equal(exchanges(), before);

        // An expired attempt is released and reported, never connected.
        await authorizeAgain(page);
        await sql(
          `UPDATE github_consent SET expires_at=? WHERE portfolio_id=${owner} AND state='issued'`,
          [Date.now() - 1000],
        );
        await deliver(page);
        await status(page)
          .getByText(/The authorization link expired/)
          .waitFor({ timeout: 30000 });
        assert.equal((await connection()).private_enabled, 0);
        assert.equal(exchanges(), before);
        assert.equal((await graphOf(page)).data.includePrivate, true);

        // A valid callback connects once; replaying it changes nothing.
        await authorizeAgain(page);
        const valid = await deliver(page);
        await connected(page);
        const done = await connection();
        assert.equal(done.private_enabled, 1);
        const after = exchanges();
        assert.equal(after, before + 1);
        await page.goto(valid);
        await returned(page);
        await connected(page);
        assert.equal(exchanges(), after);
        assert.equal((await connection()).generation, done.generation);
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
    "setup guide GitHub: Skip keeps an added graph and access; confirmed removal withdraws despite failed revocation; reconnect survives the old cleanup",
    async (mark) => {
      github.addUser({
        login: "Guide-Remove",
        databaseId: 6203,
        counts: { [recent]: 4 },
        privateCounts: { [recent]: 6 },
      });
      const page = await toGitHub();
      await chooseAccount(page, "Guide-Remove");
      await connected(page);
      const graphId = (await graphOf(page)).id;

      mark("skips keep the graph");
      // Skipping an added graph never disconnects or removes anything.
      for (const name of ["Skip", "Skip to review"]) {
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

      // Confirmed removal explains and withdraws access at once, even while
      // revocation at GitHub fails and stays queued.
      mark("remove graph");
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
      await page.locator('[data-guide-github="none"]').waitFor({
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

      mark("re-add during cleanup");
      // Choosing the account again waits for the earlier cleanup: GitHub is
      // not opened, and the graph waits unfinished.
      await age();
      await setGithubSignIn("Guide-Remove", null);
      await open(page, "github");
      await panel(page).getByRole("button", { name: "Connect GitHub" }).click();
      await panel(page)
        .getByRole("alert")
        .getByText(/still being removed/)
        .waitFor({ timeout: 30000 });
      await status(page)
        .getByText(/still being removed at GitHub/)
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

      mark("cleanup finishes");
      // GitHub recovers; the next due cleanup revokes the old grant.
      github.state.revokeFailure = null;
      await sql("UPDATE github_grant SET retry_at=0 WHERE github_user_id=?", [
        "node-guide-remove",
      ]);
      await age();
      await sweep(page);
      await until(
        page,
        async () => (await grant("Guide-Remove"))?.state === "idle",
        "cleanup did not finish",
      );
      assert.equal(validToken("Guide-Remove"), false);

      mark("reconnect");
      // Reconnect, then let an old cleanup run again: the fresh grant stays.
      // The page polls the cleanup status, so wait for it to settle there.
      await page
        .locator('[data-github-status="cleanup"]')
        .waitFor({ state: "detached", timeout: 10000 });
      await authorizeAgain(page);
      await connected(page);
      assert.ok(validToken("Guide-Remove"));
      const fresh = await connection();
      await sql("UPDATE github_grant SET retry_at=0 WHERE github_user_id=?", [
        "node-guide-remove",
      ]);
      await age();
      await sweep(page);
      await connected(page);
      assert.ok(validToken("Guide-Remove"), "the old cleanup revoked nothing");
      assert.equal((await grant("Guide-Remove")).state, "active");
      row = await connection();
      assert.equal(row.private_enabled, 1);
      assert.ok(row.generation >= fresh.generation);
      await proceed(page);
      await waitStep(page, "review");
      assert.equal(await signIns(), 1);
      await reset();
    },
  );
}
