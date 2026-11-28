import assert from "node:assert/strict";
import { join } from "node:path";
import { addLink, addSkill, editLink } from "./links.mjs";
import { addSection, openChecklist, openSection } from "./shell.mjs";

// Phase 42F: the Phase 15 callback continuation and the complete new-user
// journey through the production guide, Review, handoff, editor and Publish.
// Only the provider hop is a fixture here: the harness answers the sign-in
// start with a provider URL, and the provider's return sets the fixture
// session (an account, a cancellation or a failure). The `/auth/recovery`
// page, the recovery records, the guide, the editor and every owner API
// request are the product's.
export async function checkGuideJourney({
  context,
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
  const stored = async (user = "draft-alice") =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id=?", [user]))[0]
        .draft,
    );
  const until = async (check, message) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.fail(message);
  };
  const cookie = (value) =>
    context.addCookies([
      { name: "fixture-session", value, url: browserOrigin },
    ]);
  const png = (page, color) =>
    page.evaluate(async (color) => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 600;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 900, 600);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, color);
  const claims = (user = "draft-alice") =>
    sql(
      "SELECT c.name,c.state FROM subdomain_claim c JOIN portfolio p ON p.id=c.portfolio_id WHERE p.user_id=? ORDER BY c.name",
      [user],
    );
  const recentDay = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const click = (page, name) =>
    page.getByRole("button", { name, exact: true }).click();

  // The provider hop: which account the provider signs in, per sign-in.
  const provider = { as: "alice", visits: [] };
  async function routeProviders() {
    for (const pattern of [
      "https://github.com/**",
      "https://accounts.google.com/**",
    ])
      await context.route(pattern, (route) => {
        const url = new URL(route.request().url());
        provider.visits.push(url.hostname);
        const query = new URLSearchParams({
          cb: url.searchParams.get("cb"),
          err: url.searchParams.get("err"),
          as: provider.as,
        });
        return route.fulfill({
          status: 302,
          headers: { Location: `${browserOrigin}/__provider/return?${query}` },
        });
      });
  }
  async function unrouteProviders() {
    for (const pattern of [
      "https://github.com/**",
      "https://accounts.google.com/**",
    ])
      await context.unroute(pattern);
  }
  const continuation = (page) =>
    page.evaluate(() => sessionStorage.getItem("hasaweb-draft-auth-v1"));
  const signInButton = (page, name) =>
    page
      .getByRole("region", { name: "Sign in to recover" })
      .getByRole("button", { name: `Sign in with ${name}`, exact: true });
  const recoveryReady = (page) =>
    page.getByRole("button", { name: "Continue preserved edits" });

  // Address, then Profile once the account name has filled the empty Name
  // field and saved, so that the next field is a real edit.
  async function toProfile(page, name) {
    await open(page);
    await field(page).fill(name);
    await field(page).press("Tab");
    await addressStatus(page).filter({ hasText: "Available" }).waitFor();
    await proceed(page);
    await waitStep(page, "profile");
    await until(
      async () => Boolean((await stored()).profile?.name),
      "the account name was not prefilled",
    );
    await page.locator('.guide-save[data-save-status="saved"]').waitFor();
  }

  for (const [signup, label] of [
    ["github", "GitHub"],
    ["google", "Google"],
  ])
    await guarded(
      `setup guide expired session recovers through the ${label} callback and resumes the saved step`,
      async () => {
        await reset();
        await routeProviders();
        try {
          const page = await guidePage();
          await provision(page, "alice");
          const name = `recover-${suffix()}`;
          await toProfile(page, name);
          // The prefilled account name is saved; the edit below is the one
          // the expired session must not save.
          const prefilled = "alice";

          // The session ends while the owner types a valid name.
          await cookie("expired");
          await page.getByLabel("Name", { exact: true }).fill(`Via ${label}`);
          await signInButton(page, label).waitFor({ timeout: 30000 });
          assert.equal((await stored()).profile?.name, prefilled);
          provider.as = "alice";
          await signInButton(page, label).click();

          // The fixed callback offers the preserved input; nothing is saved
          // until the owner explicitly continues it.
          await page.waitForURL(`${browserOrigin}/auth/recovery`, {
            timeout: 30000,
          });
          await recoveryReady(page).waitFor({ timeout: 30000 });
          assert.equal((await stored()).profile?.name, prefilled);
          const saved = JSON.parse(await continuation(page));
          assert.deepEqual(Object.keys(saved).sort(), [
            "context",
            "flow",
            "ownerId",
            "portfolioId",
            "recordId",
            "version",
          ]);
          assert.equal(saved.context, "setup");
          assert.equal(saved.ownerId, "draft-alice");
          assert.deepEqual(provider.visits, [
            signup === "github" ? "github.com" : "accounts.google.com",
          ]);
          await page.screenshot({
            path: join(evidence, `guide-recovery-${signup}.png`),
            fullPage: true,
          });

          // A callback reload keeps the offer and saves nothing.
          await page.reload();
          await recoveryReady(page).waitFor({ timeout: 30000 });
          assert.equal((await stored()).profile?.name, prefilled);
          await recoveryReady(page).click();
          await until(
            async () => (await stored()).profile?.name === `Via ${label}`,
            "continued preserved edits were not saved",
          );

          // The account link resumes the saved step with the saved value and
          // the single held address.
          await page.getByRole("link", { name: "Open your account" }).click();
          await page.waitForURL(`${browserOrigin}/auth/entry`);
          await page.waitForFunction(() => window.guideFixture?.ready);
          await waitStep(page, "profile");
          assert.equal(
            await page.getByLabel("Name", { exact: true }).inputValue(),
            `Via ${label}`,
          );
          assert.equal((await portfolio()).requested, name);
          assert.equal(
            (
              await sql(
                "SELECT count(*) n FROM subdomain_claim c JOIN portfolio p ON p.id=c.portfolio_id WHERE p.user_id='draft-alice' AND c.state='held'",
              )
            )[0].n,
            1,
          );
          // The continuation names the durable replacement record, never
          // content, and the guide shows its saved state.
          assert.equal(
            JSON.parse(await continuation(page)).ownerId,
            "draft-alice",
          );
          await page.locator('.guide-save[data-save-status="saved"]').waitFor();
          provider.visits.length = 0;
        } finally {
          await unrouteProviders();
          await cookie("alice");
        }
      },
    );

  await guarded(
    "setup guide recovery: wrong account, cancelled and failed sign-in keep the preserved input",
    async () => {
      await reset();
      await routeProviders();
      const other = await context.browser().newContext();
      try {
        const bob = await guidePage(other);
        await provision(bob, "bob");
        const page = await guidePage();
        await provision(page, "alice");
        await toProfile(page, `wrong-${suffix()}`);
        await cookie("expired");
        await page.getByLabel("Name", { exact: true }).fill("Kept name");
        await signInButton(page, "GitHub").waitFor({ timeout: 30000 });

        // Cancelled and failed provider returns keep the tab continuation
        // and offer sign-in again, never a saved or recovered state.
        provider.as = "cancel";
        await signInButton(page, "GitHub").click();
        await page.waitForURL(`${browserOrigin}/auth/recovery/error**`, {
          timeout: 30000,
        });
        await page
          .getByRole("alert")
          .filter({ hasText: "cancelled" })
          .waitFor();
        const interrupted = await continuation(page);
        assert.ok(interrupted);
        provider.as = "fail";
        await page.getByRole("button", { name: "Sign in with GitHub" }).click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Sign-in didn't finish" })
          .waitFor({ timeout: 30000 });
        assert.equal(await continuation(page), interrupted);
        assert.equal((await stored()).profile?.name, "alice");

        // Another account signs in: a clear mismatch, original untouched.
        provider.as = "bob";
        const before = interrupted;
        await page.getByRole("button", { name: "Sign in with GitHub" }).click();
        await page
          .getByText(/different account or portfolio/)
          .waitFor({ timeout: 30000 });
        assert.equal(await continuation(page), before);
        assert.equal((await stored()).profile?.name, "alice");
        assert.equal((await stored("draft-bob")).profile?.name ?? "", "");
        assert.equal(
          await page
            .getByRole("button", { name: "Continue preserved edits" })
            .count(),
          0,
        );
        await page.reload();
        await page
          .getByText(/different account or portfolio/)
          .waitFor({ timeout: 30000 });

        // The original account then recovers the input.
        provider.as = "alice";
        await page.getByRole("button", { name: "Sign in with GitHub" }).click();
        await recoveryReady(page).waitFor({ timeout: 30000 });
        await recoveryReady(page).click();
        await until(
          async () => (await stored()).profile?.name === "Kept name",
          "the original account did not recover its input",
        );
        assert.equal((await stored("draft-bob")).profile?.name ?? "", "");
      } finally {
        await other.close();
        await unrouteProviders();
        await cookie("alice");
      }
    },
  );

  // ---- The complete journeys -------------------------------------------

  const reviewFrame = async (page) => {
    await page.waitForFunction(
      () =>
        document.querySelector("[data-preview-state]")?.dataset.previewState ===
        "displayed",
      undefined,
      { timeout: 45000 },
    );
    const frame = page.frames().find((candidate) => {
      try {
        return new URL(candidate.url()).pathname === "/editor/preview";
      } catch {
        return false;
      }
    });
    assert.ok(frame, "the production /editor/preview document is mounted");
    return frame;
  };
  const sectionTypes = (frame) =>
    frame.evaluate(() =>
      [...document.querySelectorAll("[data-component-id]")].map(
        (element) => element.closest("[data-component]")?.dataset.component,
      ),
    );
  const pngFile = async (page, color) => ({
    name: "a.png",
    mimeType: "image/png",
    buffer: Buffer.from(await png(page, color)),
  });
  async function upload(page, purpose, file) {
    await page
      .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`), { exact: true })
      .setInputFiles(file);
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
  async function enterAddress(page, name) {
    await waitStep(page, "address");
    await field(page).fill(name);
    await field(page).press("Tab");
    await addressStatus(page).filter({ hasText: "Available" }).waitFor();
    await proceed(page);
    await waitStep(page, "profile");
  }
  // A signed-up owner whose provider account carries a name and a photo.
  async function signedUp(signup) {
    await reset();
    const page = await guidePage();
    await provision(page, "alice");
    // Earlier groups leave GitHub sign-ins on alice, some without a token.
    // The server reads one GitHub account per owner, so this sign-up's
    // account must be her only one.
    await sql(
      "DELETE FROM account WHERE id='journey-account' OR (user_id='draft-alice' AND provider_id='github')",
    );
    // A GitHub sign-up holds the sign-in token its graph connects with.
    await sql(
      "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES('journey-account',?,?,'draft-alice',?,?,?)",
      [
        signup === "github" ? "7399" : "google-7342",
        signup,
        signup === "github" ? github.issueSignInToken("Journey-Hub") : null,
        Date.now(),
        Date.now(),
      ],
    );
    await sql("UPDATE user SET name=?,image=? WHERE id='draft-alice'", [
      `${signup === "github" ? "GitHub" : "Google"} Owner`,
      signup === "github"
        ? "https://avatars.githubusercontent.com/fixture/valid"
        : "https://lh3.googleusercontent.com/fixture/valid",
    ]);
    await page.goto(`${browserOrigin}/auth/entry`);
    await page.waitForFunction(() => window.guideFixture?.ready);
    return page;
  }
  const published = async (name) => {
    const response = await context.request.get(
      `${browserOrigin}/_public?target=${encodeURIComponent(`https://${name}.hasaweb.site/`)}`,
    );
    assert.equal(response.status(), 200);
    return response.text();
  };
  async function publish(page) {
    const checklist = await openChecklist(page);
    await checklist
      .getByRole("button", { name: /^(Publish|Publish changes|Try again)$/ })
      .click();
    await checklist
      .getByText("You're live", { exact: true })
      .waitFor({ timeout: 100000 });
  }
  const text = (html) =>
    html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");

  // Phase 50: a name typed on the entry page rides through the provider
  // round trip in the tab's sessionStorage and fills Address once, as an
  // unchecked local edit. Only Continue reserves it.
  await guarded(
    "entry page address suggestion survives sign-in and prefills Address without reserving it",
    async () => {
      await reset();
      const page = await guidePage();
      await provision(page, "alice");
      const name = `entry-${suffix()}`;
      // What Start building stores (apps/web/lib/address-suggestion.ts).
      await page.evaluate(
        (name) => sessionStorage.setItem("hasaweb-address-suggestion-v1", name),
        name,
      );
      // The provider returns this tab to the fixed post-auth destination.
      await page.goto(
        `${browserOrigin}/__provider/return?${new URLSearchParams({ as: "alice", cb: `${browserOrigin}/auth/entry` })}`,
      );
      await waitStep(page, "address");
      assert.equal(await field(page).inputValue(), name);
      await addressStatus(page)
        .filter({ hasText: "Available" })
        .waitFor({ timeout: 30000 });
      assert.deepEqual(await claims(), []);
      assert.equal((await portfolio()).requested, null);
      assert.equal(
        await page.evaluate(() =>
          sessionStorage.getItem("hasaweb-address-suggestion-v1"),
        ),
        null,
      );
      await proceed(page);
      await waitStep(page, "profile");
      assert.deepEqual(await claims(), [{ name, state: "held" }]);
    },
  );

  await guarded(
    "new-user journey, GitHub signup, everything completed: saved values equal Review, editor and published output",
    async () => {
      const page = await signedUp("github");
      const name = `journey-${suffix()}`;
      await enterAddress(page, name);

      // A change to a reserved name fails and keeps the previous hold; an
      // available replacement swaps it atomically.
      await sql(
        "INSERT OR IGNORE INTO reserved_subdomain(name) VALUES('journey-taken')",
      );
      await click(page, "Back");
      await waitStep(page, "address");
      await field(page).fill("journey-taken");
      await page.keyboard.press("Enter");
      await addressStatus(page)
        .filter({ hasText: /not available|taken/i })
        .waitFor({ timeout: 30000 });
      assert.deepEqual(await claims(), [{ name, state: "held" }]);
      const replacement = `journey-${suffix()}`;
      await field(page).fill(replacement);
      await page.keyboard.press("Enter");
      await waitStep(page, "profile");
      assert.deepEqual(await claims(), [{ name: replacement, state: "held" }]);

      // Profile: the account name fills the empty Name field and stays
      // editable; the photo is used only on request; a failed photo import
      // keeps the form and a retry reaches the crop.
      const nameField = page.getByLabel("Name", { exact: true });
      await page.waitForFunction(
        () =>
          document.querySelector(".guide-profile-name input")?.value ===
          "GitHub Owner",
      );
      assert.equal(
        await page.getByRole("button", { name: "Use this name" }).count(),
        0,
      );
      await nameField.fill("GitHub Owner (edited)");
      assert.equal(await nameField.inputValue(), "GitHub Owner (edited)");
      await nameField.fill("GitHub Owner");
      await sql("UPDATE user SET image=? WHERE id='draft-alice'", [
        "https://avatars.githubusercontent.com/fixture/missing",
      ]);
      // The account photo is offered in the avatar's options.
      await click(page, "Edit avatar");
      await click(page, "Use my account photo");
      await page
        .getByRole("region", { name: "Avatar image", exact: true })
        .getByRole("alert")
        .waitFor({ timeout: 30000 });
      assert.equal((await stored()).profile?.avatar, undefined);
      await sql("UPDATE user SET image=? WHERE id='draft-alice'", [
        "https://avatars.githubusercontent.com/fixture/valid",
      ]);
      await click(page, "Edit avatar");
      await click(page, "Use my account photo");
      await page.getByRole("dialog", { name: "Adjust avatar" }).waitFor();
      await click(page, "Apply crop");
      await page
        .getByRole("region", { name: "Avatar image", exact: true })
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor();
      await page
        .getByLabel("Bio", { exact: true })
        .fill("I build careful things.");
      await upload(page, "banner", await pngFile(page, "#2448e8"));
      await proceed(page);

      // Links: one website link; no account email is added by itself.
      await waitStep(page, "links");
      await addLink(page, "https://example.com/me", "My site");
      await proceed(page);
      await waitStep(page, "skills");
      assert.equal(
        JSON.stringify(await stored()).includes("alice@draft"),
        false,
      );

      // Skills and Projects, entered in order.
      for (const skill of ["TypeScript", "Rust"]) await addSkill(page, skill);
      await proceed(page);
      await waitStep(page, "projects");
      // One project card at a time; each project has its own tab.
      for (const [title, summary] of [
        ["Alpha", "The first project."],
        ["Beta", "The second project."],
      ]) {
        await click(page, "Add project");
        await page.getByLabel("Project title").fill(title);
        await page.getByLabel("Summary", { exact: true }).fill(summary);
      }
      await page
        .getByRole("list", { name: "Your projects" })
        .getByRole("button", { name: "Alpha" })
        .click();
      await click(page, "Links");
      await page
        .getByLabel("Code URL", { exact: true })
        .fill("https://example.com/alpha");
      await page.getByLabel("Code URL", { exact: true }).press("Escape");
      // GitHub: the sign-up's own graph, public and private, is connected
      // when the step opens; Continue adds it.
      github.addUser({
        login: "Journey-Hub",
        databaseId: 7399,
        counts: { [recentDay]: 2 },
        privateCounts: { [recentDay]: 1 },
      });
      await proceed(page);
      await waitStep(page, "github");
      await page
        .getByRole("region", { name: "GitHub activity controls", exact: true })
        .getByText("Connected", { exact: true })
        .waitFor({ timeout: 30000 });
      await proceed(page);
      await waitStep(page, "review");
      await page.locator('.guide-save[data-save-status="saved"]').waitFor();

      // Review shows the saved draft in screen order with no issues.
      const saved = await stored();
      assert.deepEqual(
        saved.components.map((item) => item.type),
        ["skills", "projects", "github"],
      );
      let frame = await reviewFrame(page);
      for (const value of [
        "GitHub Owner",
        "My site",
        "TypeScript",
        "Rust",
        "Alpha",
        "Beta",
      ])
        await frame.getByText(value, { exact: true }).first().waitFor();
      assert.deepEqual(await sectionTypes(frame), [
        "skills",
        "projects",
        "github",
      ]);
      await page
        .locator('[data-review-status="checked"]')
        .waitFor({ state: "attached", timeout: 30000 });
      assert.equal(await page.locator("[data-review-issue]").count(), 0);
      assert.equal(await page.locator("[data-review-local-input]").count(), 0);
      await page.screenshot({
        path: join(evidence, "journey-github-review.png"),
        fullPage: true,
      });

      // Open editor: the editor holds exactly the saved draft and shows it.
      await click(page, "Open editor");
      await page.waitForURL(`${browserOrigin}/editor`, { timeout: 30000 });
      await page.waitForFunction(() => window.editorFixture?.ready);
      assert.deepEqual(await stored(), saved);
      assert.deepEqual(
        await page.evaluate(
          () =>
            window.editorFixture.recovery.store
              .getState()
              .controller.store.getState().working,
        ),
        saved,
      );
      frame = await reviewFrame(page);
      for (const value of [
        "GitHub Owner",
        "My site",
        "TypeScript",
        "Rust",
        "Alpha",
        "Beta",
      ])
        await frame.getByText(value, { exact: true }).first().waitFor();
      assert.deepEqual(await sectionTypes(frame), [
        "skills",
        "projects",
        "github",
      ]);
      assert.equal((await portfolio()).entered > 0, true);
      assert.equal((await portfolio()).subdomain, null);

      // Publish: the published page carries the same saved values.
      await publish(page);
      const html = await published(replacement);
      const visible = text(html);
      for (const value of [
        "GitHub Owner",
        "I build careful things.",
        "My site",
        "TypeScript",
        "Rust",
        "Alpha",
        "The first project.",
        "Beta",
        "The second project.",
      ])
        assert.ok(visible.includes(value), `published page lacks ${value}`);
      assert.match(html, /href="https:\/\/example\.com\/me"/);
      assert.match(html, /href="https:\/\/example\.com\/alpha"/);
      const order = [...html.matchAll(/data-component="([a-z-]+)"/g)].map(
        (m) => m[1],
      );
      assert.deepEqual(
        order.filter((type) => ["skills", "projects", "github"].includes(type)),
        ["skills", "projects", "github"],
      );
      assert.equal(html.includes("alice@draft"), false);
      assert.deepEqual(await claims(), [
        { name: replacement, state: "claimed" },
      ]);
      assert.deepEqual(await stored(), saved);
    },
  );

  // Address, Profile (name suggestion plus two uploaded images) and a website
  // link, ending on Skills.
  async function required(page, name, link = "https://example.com/me") {
    await enterAddress(page, name);
    await page.getByLabel("Name", { exact: true }).fill("Journey Owner");
    await page.getByLabel("Bio", { exact: true }).fill("A short bio.");
    await upload(page, "avatar", await pngFile(page, "#3a7d2c"));
    await upload(page, "banner", await pngFile(page, "#2448e8"));
    await proceed(page);
    await waitStep(page, "links");
    await addLink(page, link, "My site");
    await proceed(page);
    await waitStep(page, "skills");
  }
  const issuesFor = (page) =>
    page.evaluate(async () => {
      const { ownerId, portfolioId } = window.editorFixture.scope;
      const state = window.editorFixture.recovery.store
        .getState()
        .controller.store.getState();
      const response = await fetch("/api/owner/publication/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Expected-Owner-Id": ownerId,
        },
        body: JSON.stringify({
          portfolioId,
          revision: state.confirmed.revision,
        }),
      });
      return (await response.json()).issues;
    });

  await guarded(
    "new-user journey, Google signup, every optional step skipped: only the profile and the accepted email link",
    async () => {
      const page = await signedUp("google");
      const name = `skipped-${suffix()}`;
      await enterAddress(page, name);
      // The account name is already in the Name field.
      await page.waitForFunction(
        () => document.querySelector(".guide-profile-name input")?.value !== "",
      );
      await click(page, "Edit avatar");
      await click(page, "Use my account photo");
      await page.getByRole("dialog", { name: "Adjust avatar" }).waitFor();
      await click(page, "Apply crop");
      await page
        .getByRole("region", { name: "Avatar image", exact: true })
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor();
      await page.getByLabel("Bio", { exact: true }).fill("Skipping the rest.");
      await upload(page, "banner", await pngFile(page, "#2448e8"));
      await proceed(page);
      await waitStep(page, "links");

      // The account email is offered as a pill and becomes a link only when
      // picked; its row then shows it as Public.
      const email = page.getByRole("button", {
        name: "Add alice@draft.example.test as a public link",
      });
      await email.waitFor();
      assert.equal(
        JSON.stringify(await stored()).includes("alice@draft"),
        false,
      );
      await email.click();
      await page
        .locator("[data-link-id]")
        .filter({ hasText: "alice@draft.example.test" })
        .filter({ hasText: "Public" })
        .waitFor();
      await proceed(page);
      await waitStep(page, "skills");

      await click(page, "Skip to review");
      await waitStep(page, "review");
      await page.locator('.guide-save[data-save-status="saved"]').waitFor();
      const saved = await stored();
      assert.deepEqual(saved.components, []);
      assert.equal(saved.links.length, 1);
      assert.equal(saved.links[0].value, "alice@draft.example.test");
      assert.equal(saved.profile.name, "Google Owner");
      // No graph, and no GitHub sign-in link, was inferred.
      assert.equal(
        (
          await sql(
            "SELECT count(*) n FROM github_connection WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
          )
        )[0].n,
        0,
      );
      let frame = await reviewFrame(page);
      await frame.getByText("Google Owner", { exact: true }).first().waitFor();
      assert.deepEqual(await sectionTypes(frame), []);
      await page
        .locator('[data-review-status="checked"]')
        .waitFor({ state: "attached", timeout: 30000 });
      assert.equal(await page.locator("[data-review-issue]").count(), 0);

      await click(page, "Open editor");
      await page.waitForURL(`${browserOrigin}/editor`, { timeout: 30000 });
      await page.waitForFunction(() => window.editorFixture?.ready);
      assert.deepEqual(await stored(), saved);
      frame = await reviewFrame(page);
      await frame.getByText("Google Owner", { exact: true }).first().waitFor();
      assert.deepEqual(await sectionTypes(frame), []);
      await publish(page);
      const html = await published(name);
      assert.ok(text(html).includes("Google Owner"));
      assert.ok(text(html).includes("Skipping the rest."));
      assert.match(html, /href="mailto:alice@draft\.example\.test"/);
      assert.deepEqual(
        [...html.matchAll(/data-component="([a-z-]+)"/g)]
          .map((match) => match[1])
          .filter((type) => ["skills", "projects", "github"].includes(type)),
        [],
      );
    },
  );

  await guarded(
    "new-user journey with a partial project and an unfinished private graph: honest statuses, Publish blocked until repaired in the editor",
    async () => {
      github.addUser({
        login: "Journey-Private",
        databaseId: 6300,
        counts: { [recentDay]: 2 },
        privateCounts: { [recentDay]: 4 },
      });
      github.state.callbackOrigin = browserOrigin;
      github.state.failure = null;
      github.state.activityFailure = null;
      github.state.revokeFailure = null;
      github.state.consent = { as: null, cancel: false, hold: false };
      const page = await signedUp("google");
      await required(page, `partial-${suffix()}`);
      await click(page, "Skip");
      await waitStep(page, "projects");
      await click(page, "Add project");
      await page.getByLabel("Project title").fill("Half done");
      await click(page, "Skip");
      await waitStep(page, "github");
      const panel = page.getByRole("region", {
        name: "GitHub activity controls",
        exact: true,
      });
      // Link GitHub without a usable token, remount so status sees it, then
      // cancel authorization: the graph stays in the draft, unfinished.
      await sql(
        "DELETE FROM account WHERE user_id='draft-alice' AND provider_id='github'",
      );
      await sql(
        "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        [
          "journey-github-link",
          "6300",
          "github",
          "draft-alice",
          null,
          Date.now(),
          Date.now(),
        ],
      );
      await page.goto(`${browserOrigin}/auth/entry`);
      await page.waitForFunction(() => window.guideFixture?.ready);
      await waitStep(page, "github");
      const discard = page.getByRole("button", {
        name: "Discard local recovery",
        exact: true,
      });
      if (await discard.count()) await discard.click();
      await page.locator('.guide-save[data-save-status="saved"]').waitFor({
        timeout: 30000,
      });
      github.state.consent = { as: null, cancel: true, hold: false };
      // Prefer Authorize when the linked account is already selected.
      const authorize = panel.getByRole("button", {
        name: /^Authorize (again|on GitHub)$/,
      });
      const connect = panel.getByRole("button", { name: "Connect GitHub" });
      if (await authorize.count()) await authorize.click();
      else await connect.click();
      await page.waitForURL(/\/auth\/entry/, { timeout: 60000 });
      await page.waitForFunction(() => window.guideFixture?.ready);
      await waitStep(page, "github");
      await panel
        .locator("[data-github-status]")
        .getByText(/Authorization was cancelled/)
        .waitFor({ timeout: 30000 });
      github.state.consent = { as: null, cancel: false, hold: false };
      await click(page, "Finish later in the editor");
      await waitStep(page, "review");
      await page.locator('.guide-save[data-save-status="saved"]').waitFor();

      // Review reports both unfinished pieces and claims no readiness.
      await page
        .locator('[data-review-status="checked"]')
        .waitFor({ state: "attached", timeout: 30000 });
      const status = page.locator("[data-review-status]");
      await status
        .locator("[data-review-issue]")
        .filter({ hasText: /projects summary/i })
        .waitFor();
      assert.ok((await status.locator("[data-review-issue]").count()) >= 2);
      assert.equal(
        await page.getByText(/ready to publish|publish-ready/i).count(),
        0,
      );
      const saved = await stored();
      assert.deepEqual(
        saved.components.map((item) => item.type),
        ["projects", "github"],
      );
      assert.equal(saved.components[1].data.includePrivate, true);

      await click(page, "Open editor");
      await page.waitForURL(`${browserOrigin}/editor`, { timeout: 30000 });
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page.waitForFunction(
        () =>
          !window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().batch,
      );
      // Onboarding is not rerun; Publish is blocked on the saved issues.
      const before = await issuesFor(page);
      assert.ok(before.length >= 2, JSON.stringify(before));
      const checklist = await openChecklist(page);
      await checklist
        .getByRole("button", { name: /^(Publish|Publish changes|Try again)$/ })
        .click();
      assert.equal(
        (
          await sql(
            "SELECT count(*) n FROM publication_operation WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
          )
        )[0].n,
        0,
      );
      await page.screenshot({
        path: join(evidence, "journey-partial-blocked.png"),
        fullPage: true,
      });

      // Repair in the editor: complete the project, authorize the account.
      await openSection(page, "Projects");
      await page
        .getByLabel("Summary", { exact: true })
        .fill("Finished in the editor.");
      await until(
        async () =>
          (await stored()).components[0].data.entries[0].summary ===
          "Finished in the editor.",
        "the project repair was not saved",
      );
      await openSection(page, "GitHub activity");
      // A failed authorization removes the section. Adding it again connects.
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
      await sql(
        "UPDATE github_connection SET last_checked_at=0 WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
      );
      await addSection(page, "GitHub activity");
      await openSection(page, "GitHub activity");
      await page
        .getByRole("region", { name: "GitHub activity controls", exact: true })
        .getByRole("button", { name: "Connect GitHub" })
        .click();
      await page.waitForURL(/\/editor(\?github=consent)?$/, {
        timeout: 60000,
      });
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("region", { name: "GitHub activity controls", exact: true })
        .getByRole("status")
        .getByText(/Connected\. 6 contributions/)
        .waitFor({ timeout: 60000 });
      await page.waitForFunction(
        () =>
          !window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().batch,
      );
      assert.deepEqual(await issuesFor(page), []);
      assert.equal((await portfolio()).step, "review");
    },
  );

  await guarded(
    "editor after handoff: expired session during preserved setup input recovers through the callback without applying or losing it",
    async () => {
      const page = await signedUp("google");
      await routeProviders();
      try {
        await required(page, `editor-${suffix()}`);
        await addSkill(page, "TypeScript");
        await proceed(page);
        await waitStep(page, "projects");
        await click(page, "Add project");
        await page.getByLabel("Project title").fill("Half done");
        await click(page, "Links");
        await page.getByLabel("Code URL", { exact: true }).fill("htt");
        await page.getByLabel("Code URL", { exact: true }).press("Escape");
        await click(page, "Skip to review");
        await waitStep(page, "review");
        await until(
          async () => (await portfolio()).step === "review",
          "Review was not saved",
        );
        await click(page, "Open editor");
        await page.waitForURL(`${browserOrigin}/editor`, { timeout: 30000 });
        await page.waitForFunction(() => window.editorFixture?.ready);
        const saved = await stored();
        const preserved = page.getByRole("region", { name: "Preserved input" });
        await preserved.waitFor({ timeout: 30000 });

        // The session ends before the owner reviews the preserved input.
        await cookie("expired");
        await preserved
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        await signInButton(page, "Google").waitFor({ timeout: 30000 });
        provider.as = "alice";
        await signInButton(page, "Google").click();
        await page.waitForURL(`${browserOrigin}/auth/recovery`, {
          timeout: 30000,
        });
        await page.screenshot({
          path: join(evidence, "journey-editor-callback.png"),
          fullPage: true,
        });
        // Nothing is applied by signing in; the saved draft is unchanged and
        // the preserved input stays offered on the callback.
        assert.deepEqual(await stored(), saved);
        assert.equal(
          JSON.parse(await continuation(page)).ownerId,
          "draft-alice",
        );
        await page.getByRole("link", { name: "Open your account" }).waitFor({
          timeout: 30000,
        });
        await page.reload();
        await page.getByRole("link", { name: "Open your account" }).waitFor({
          timeout: 30000,
        });
        assert.deepEqual(await stored(), saved);

        // The editor opens with the same preserved input and the entered
        // milestone; onboarding is not reopened.
        await page.getByRole("link", { name: "Open your account" }).click();
        await page.waitForURL(`${browserOrigin}/editor`, { timeout: 30000 });
        await page.waitForFunction(() => window.editorFixture?.ready);
        await page
          .getByRole("region", { name: "Preserved input" })
          .waitFor({ timeout: 30000 });
        assert.deepEqual(await stored(), saved);
        assert.equal((await portfolio()).entered > 0, true);

        // Selected review still applies only what the owner selects.
        await page
          .getByRole("region", { name: "Preserved input" })
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        const review = page.getByRole("region", {
          name: "Review your preserved edits",
        });
        await review.getByText("Unfinished input, kept separately").click();
        await review.getByText(/codeUrl.*htt/).waitFor();
        await page.waitForFunction(
          () => !window.editorFixture.recovery.store.getState().busy,
        );
        await review
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await page.waitForFunction(
          () =>
            !window.editorFixture.recovery.store.getState().review &&
            !window.editorFixture.recovery.store.getState().busy,
        );
        assert.deepEqual(await stored(), saved);
      } finally {
        await unrouteProviders();
        await cookie("alice");
      }
    },
  );

  await guarded(
    "setup guide changed base: expiry during selected review keeps the selection through sign-in and saves against the newer draft",
    async (mark) => {
      await reset();
      await routeProviders();
      try {
        const first = await guidePage();
        await provision(first, "alice");
        const address = `base-${suffix()}`;
        await open(first);
        await enterAddress(first, address);
        await first.getByLabel("Name", { exact: true }).fill("Journey Owner");
        await first.getByLabel("Bio", { exact: true }).fill("A short bio.");
        await upload(first, "avatar", await pngFile(first, "#3a7d2c"));
        await upload(first, "banner", await pngFile(first, "#2448e8"));
        await proceed(first);
        await waitStep(first, "links");
        const firstRow = await addLink(
          first,
          "https://example.com/a",
          "Original",
        );
        await first.locator('.guide-save[data-save-status="saved"]').waitFor();
        const linkLabel = async () => (await stored()).links[0]?.label;
        await until(
          async () => (await linkLabel()) === "Original",
          "link not saved",
        );
        mark("stale tab");
        const stale = await guidePage();
        await open(stale, "links");
        await stale.locator("[data-link-id] .guide-link-open").first().click();
        const stalePopover = stale.locator(".wb-popover");
        await stalePopover.getByLabel("Link label", { exact: true }).waitFor();

        // Unfinished input in the stale tab blocks its base refresh, so it
        // meets the changed base with its edits kept in this browser.
        await stalePopover.getByLabel("Web address").fill("htt");
        await editLink(first, firstRow, { label: "Newer label" });
        await until(
          async () => (await linkLabel()) === "Newer label",
          "newer label not saved",
        );
        const resolve = stale.getByRole("region", {
          name: "Resolve saved version",
        });
        await resolve.waitFor({ timeout: 30000 });
        // The recovery choices take focus, which closes the popover. A label
        // edit made now joins the preserved edits.
        await stalePopover.waitFor({ state: "detached" });
        await stale.locator("[data-link-id] .guide-link-open").first().click();
        await stalePopover
          .getByLabel("Link label", { exact: true })
          .fill("Stale label");
        await stalePopover
          .getByLabel("Link label", { exact: true })
          .press("Escape");
        mark("resolve");
        await resolve
          .getByRole("button", { name: "Keep my edits for review" })
          .click();
        const review = stale.getByRole("region", {
          name: "Review your preserved edits",
        });
        await review.waitFor();
        await stale.waitForFunction(
          () => !window.guideFixture.recovery.store.getState().busy,
        );
        await review.getByRole("checkbox").first().click();
        await review
          .locator("input[type=checkbox]:checked")
          .first()
          .waitFor({ timeout: 30000 });

        mark("expiry");
        // The session ends while the selection is open.
        await cookie("expired");
        await stale
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await signInButton(stale, "GitHub").waitFor({ timeout: 30000 });
        assert.equal(await linkLabel(), "Newer label");
        provider.as = "alice";
        await signInButton(stale, "GitHub").click();
        await stale.waitForURL(`${browserOrigin}/auth/recovery`, {
          timeout: 30000,
        });
        await stale.getByRole("button", { name: "Reopen review" }).waitFor({
          timeout: 30000,
        });
        await stale.screenshot({
          path: join(evidence, "journey-review-callback.png"),
          fullPage: true,
        });
        assert.equal(await linkLabel(), "Newer label");
        mark("reopen");
        await stale.getByRole("button", { name: "Reopen review" }).click();
        await stale
          .locator("input[type=checkbox]:checked")
          .first()
          .waitFor({ timeout: 30000 });
        await stale
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await until(
          async () => (await linkLabel()) === "Stale label",
          "the reviewed selection was not saved",
        );
        // The reservation is untouched by the review.
        assert.deepEqual(await claims(), [{ name: address, state: "held" }]);
      } finally {
        await unrouteProviders();
        await cookie("alice");
      }
    },
  );
}
