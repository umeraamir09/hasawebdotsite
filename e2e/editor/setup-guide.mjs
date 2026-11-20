import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { checkGuideGitHub } from "./guide-github.mjs";
import { checkGuideJourney } from "./guide-journey.mjs";
import { checkGuideReview } from "./guide-review.mjs";
import { addLink } from "./links.mjs";

// Phase 42A: the guide shell, progress, resume and required Address screen,
// mounted by the direct `/guide` fixture. Phase 42E's groups (Review, handoff
// and the activated account entry) use `/auth/entry` and `/editor`.
export async function checkSetupGuide({
  context,
  sql,
  run,
  evidence,
  browserOrigin,
  errors,
  github,
  part,
}) {
  const browser = context.browser();
  const owners = ["draft-alice", "draft-bob"];
  const suffix = () => randomBytes(3).toString("hex");
  const claims = (user = "draft-alice") =>
    sql(
      "SELECT c.name,c.state FROM subdomain_claim c JOIN portfolio p ON p.id=c.portfolio_id WHERE p.user_id=? ORDER BY c.name",
      [user],
    );
  const portfolio = async (user = "draft-alice") =>
    (
      await sql(
        "SELECT subdomain,first_editor_entered_at entered,json_extract(draft,'$.requestedSubdomain') requested,json_extract(setup_progress,'$.step') step FROM portfolio WHERE user_id=?",
        [user],
      )
    )[0];
  const opened = [];
  // The editor harness's failure hook captures its own page; capture every
  // open guide page here so a failed group shows the guide state too.
  // `part: "journeys"` runs only the Phase 42F groups, any other value only the
  // earlier ones, so the two halves run as separate tests.
  let journeys = false;
  const guarded = (name, work) =>
    (part === "journeys") !== journeys
      ? undefined
      : run(name, async () => {
          try {
            await work();
          } catch (error) {
            let index = 0;
            for (const page of opened) {
              if (page.isClosed()) continue;
              index++;
              await page
                .screenshot({
                  path: join(evidence, `guide-failure-${index}.png`),
                  fullPage: true,
                })
                .catch(() => {});
              const text = await page
                .evaluate(() => {
                  const recovery =
                    window.guideFixture?.recovery?.store.getState();
                  const draft = recovery?.controller.store.getState();
                  return JSON.stringify({
                    text: document.body.innerText.slice(0, 600),
                    recoveryBusy: recovery?.busy,
                    recoveryError: recovery?.error,
                    status: draft?.status,
                    error: draft?.error,
                    suspended: draft?.suspended,
                    batch: draft?.batch && {
                      mode: draft.batch.mode,
                      sent: draft.batch.sent?.action,
                    },
                    progress: draft?.progress,
                    confirmed: draft?.confirmed && {
                      revision: draft.confirmed.revision,
                      progress: draft.confirmed.progress,
                      name: draft.confirmed.draft.requestedSubdomain,
                    },
                    inputs: draft && Object.keys(draft.inputs),
                  });
                })
                .catch(() => "");
              console.error(`guide page ${index}:\n${text}`);
            }
            throw error;
          }
        });

  // A fresh signup: one provisioned private portfolio, setup not finished,
  // no held address and no browser recovery records.
  async function reset() {
    for (const page of opened.splice(0)) await page.close().catch(() => {});
    for (const page of context.pages()) await page.close();
    await sql(
      `DELETE FROM subdomain_claim WHERE state='held' AND portfolio_id IN (SELECT id FROM portfolio WHERE user_id IN (${owners.map(() => "?").join(",")}))`,
      owners,
    );
    await sql(
      `DELETE FROM owner_save_attempt WHERE user_id IN (${owners.map(() => "?").join(",")})`,
      owners,
    );
    await sql(
      `DELETE FROM portfolio WHERE user_id IN (${owners.map(() => "?").join(",")})`,
      owners,
    );
  }
  async function guidePage(target = context) {
    const page = await target.newPage();
    opened.push(page);
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  async function provision(page, session) {
    await page
      .context()
      .addCookies([
        { name: "fixture-session", value: session, url: browserOrigin },
      ]);
    await page.goto(`${browserOrigin}/empty`);
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/owner/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return response.status;
    });
    assert.ok(status < 300, `provisioning returned ${status}`);
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("hasaweb-draft-recovery-v1");
        request.onsuccess = resolve;
        request.onerror = reject;
        request.onblocked = resolve;
      });
    });
  }
  async function open(page, step = "address") {
    await page.goto(`${browserOrigin}/guide`);
    await page.waitForFunction(() => window.guideFixture?.ready);
    await waitStep(page, step);
  }
  const waitStep = (page, step) =>
    page.waitForFunction(
      (step) =>
        document.querySelector("[data-guide-step]")?.dataset.guideStep === step,
      step,
      { timeout: 30000 },
    );
  const field = (page) =>
    page
      .getByRole("form", { name: "Portfolio address" })
      .getByRole("textbox", { name: "Your address" });
  const addressStatus = (page) =>
    page.getByRole("form", { name: "Portfolio address" }).getByRole("status");
  const proceed = (page) =>
    page.getByRole("button", { name: "Continue", exact: true }).click();
  async function noBypass(page) {
    for (const name of [/skip/i, /open editor/i, /review/i])
      assert.equal(await page.getByRole("button", { name }).count(), 0);
    assert.equal(await page.getByRole("link", { name: /editor/i }).count(), 0);
  }

  await guarded(
    "setup guide address reservation, progress, resume and Back",
    async () => {
      await reset();
      const page = await guidePage();
      await provision(page, "alice");
      await open(page);
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        "Choose your address",
      );
      const progress = page.getByRole("list", { name: "Setup progress" });
      assert.equal(await progress.getByRole("listitem").count(), 7);
      assert.equal(
        await progress.locator('[aria-current="step"]').innerText(),
        "Address, current step",
      );
      assert.equal(
        await page.getByRole("button", { name: /back/i }).count(),
        0,
      );
      await noBypass(page);
      await page.screenshot({
        path: join(evidence, "guide-address-empty.png"),
      });

      // Invalid input never reserves and cannot advance.
      await field(page).fill("Bad Name");
      await addressStatus(page)
        .filter({ hasText: "Enter a valid address name." })
        .waitFor();
      await proceed(page);
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        await field(page).getAttribute("id"),
      );
      assert.equal(
        await page.locator("[data-guide-step]").getAttribute("data-guide-step"),
        "address",
      );
      assert.deepEqual(await claims(), []);

      // A valid name is checked, reserved, then progress advances.
      const name = `guide-${suffix()}`;
      await field(page).fill(name);
      await field(page).press("Tab");
      await addressStatus(page)
        .filter({ hasText: "Available now. Continue to reserve it." })
        .waitFor();
      await page.screenshot({
        path: join(evidence, "guide-address-available.png"),
      });
      await proceed(page);
      await waitStep(page, "profile");
      assert.deepEqual(await claims(), [{ name, state: "held" }]);
      await page.waitForFunction(
        () =>
          document.querySelector(".guide-save")?.dataset.saveStatus === "saved",
      );
      assert.deepEqual(await portfolio(), {
        subdomain: null,
        entered: null,
        requested: name,
        step: "profile",
      });
      // Focus moves to the new step heading for keyboard and reader users.
      assert.equal(
        await page.evaluate(() => document.activeElement?.tagName),
        "H1",
      );
      assert.equal(
        await progress.locator('[aria-current="step"]').innerText(),
        "Profile, current step",
      );
      await noBypass(page);
      await page.screenshot({ path: join(evidence, "guide-profile.png") });

      // Saved progress resumes after reload (and on another device).
      await page.reload();
      await page.waitForFunction(() => window.guideFixture?.ready);
      await waitStep(page, "profile");
      const other = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      try {
        const device = await guidePage(other);
        await other.addCookies([
          { name: "fixture-session", value: "alice", url: browserOrigin },
        ]);
        await open(device, "profile");
      } finally {
        await other.close();
      }

      // Back edits the same reservation; Continue keeps one hold.
      await page.getByRole("button", { name: "Back" }).click();
      await waitStep(page, "address");
      assert.equal(await field(page).inputValue(), name);
      await addressStatus(page)
        .filter({ hasText: "Reserved for your portfolio" })
        .waitFor();
      await page.screenshot({
        path: join(evidence, "guide-address-reserved.png"),
      });
      await proceed(page);
      await waitStep(page, "profile");
      assert.deepEqual(await claims(), [{ name, state: "held" }]);
      assert.equal(
        (
          await sql(
            "SELECT count(*) n FROM address_confirmation c JOIN portfolio p ON p.id=c.portfolio_id WHERE p.user_id='draft-alice'",
          )
        )[0].n,
        1,
      );

      // A confirmed change swaps the hold atomically.
      await page.getByRole("button", { name: "Back" }).click();
      await waitStep(page, "address");
      const replacement = `guide-${suffix()}`;
      await field(page).fill(replacement);
      await page.keyboard.press("Enter");
      await waitStep(page, "profile");
      assert.deepEqual(await claims(), [{ name: replacement, state: "held" }]);
    },
  );

  await guarded(
    "setup guide rejects forged progress and keeps local unsaved input",
    async () => {
      await reset();
      const page = await guidePage();
      await provision(page, "alice");
      await open(page);
      // Progress is client-saved navigation. A forged Review step saved
      // through the owner API still resumes at Address without a hold.
      const forge = (step) =>
        page.evaluate(async (step) => {
          const controller =
            window.guideFixture.recovery.store.getState().controller;
          controller.changeProgress({ schemaVersion: 1, step });
          await controller.flushValid();
        }, step);
      await forge("review");
      assert.equal((await portfolio()).step, "review");
      await page.reload();
      await page.waitForFunction(() => window.guideFixture?.ready);
      await waitStep(page, "address");
      await noBypass(page);

      // With an address held, forged later steps stop at Profile, the
      // first required step the server still reports as incomplete.
      const name = `forged-${suffix()}`;
      await field(page).fill(name);
      await proceed(page);
      await waitStep(page, "profile");
      await forge("github");
      await page.reload();
      await page.waitForFunction(() => window.guideFixture?.ready);
      await waitStep(page, "profile");
      assert.equal(
        await page.getByRole("button", { name: /skip/i }).count(),
        0,
      );

      // Invalid unfinished input stays in this browser only, marked unsaved.
      await page.getByRole("button", { name: "Back" }).click();
      await waitStep(page, "address");
      await field(page).fill("Not Valid!");
      await page.waitForTimeout(2300);
      await page.reload();
      await page.waitForFunction(() => window.guideFixture?.ready);
      await waitStep(page, "address");
      // After reload, unfinished input is offered for explicit recovery; the
      // field shows the saved reservation until the owner continues it.
      const preserved = page.getByRole("region", { name: "Preserved input" });
      await preserved.waitFor();
      assert.equal(await field(page).inputValue(), name);
      await page.screenshot({
        path: join(evidence, "guide-local-recovery.png"),
        fullPage: true,
      });
      await preserved
        .getByRole("button", { name: "Continue preserved edits" })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector('form[aria-label="Portfolio address"] input')
            ?.value === "Not Valid!",
      );
      await page.waitForFunction(
        () =>
          document.querySelector(".guide-save")?.dataset.saveStatus ===
          "unsaved",
      );
      assert.equal(await field(page).getAttribute("aria-invalid"), "true");
      assert.deepEqual(await claims(), [{ name, state: "held" }]);
      assert.equal((await portfolio()).requested, name);
      assert.match(
        await page.getByRole("form", { name: "Portfolio address" }).innerText(),
        new RegExp(`Current reservation: ${name}\\.hasaweb\\.site`),
      );
    },
  );

  await guarded(
    "two owners selecting one name produce one reservation",
    async () => {
      await reset();
      const alice = await guidePage();
      await provision(alice, "alice");
      const other = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      try {
        const bob = await guidePage(other);
        await provision(bob, "bob");
        await open(alice);
        await open(bob);
        const name = `race-${suffix()}`;
        await field(alice).fill(name);
        await field(bob).fill(name);
        await Promise.all([proceed(alice), proceed(bob)]);
        const outcome = async (page) => {
          await page.waitForFunction(
            () =>
              document.querySelector("[data-guide-step]")?.dataset.guideStep ===
                "profile" ||
              /unavailable/.test(
                document.querySelector(".guide-address-status")?.textContent ??
                  "",
              ),
            null,
            { timeout: 30000 },
          );
          return page
            .locator("[data-guide-step]")
            .getAttribute("data-guide-step");
        };
        const results = [await outcome(alice), await outcome(bob)];
        assert.deepEqual([...results].sort(), ["address", "profile"]);
        assert.equal(
          (
            await sql("SELECT count(*) n FROM subdomain_claim WHERE name=?", [
              name,
            ])
          )[0].n,
          1,
        );
        const loser = results[0] === "address" ? alice : bob;
        assert.match(
          await addressStatus(loser).innerText(),
          /That address is unavailable\. Choose another name\./,
        );
        await loser.screenshot({
          path: join(evidence, "guide-address-unavailable.png"),
        });
        // The other owner chooses again and continues.
        const second = `race-${suffix()}`;
        await field(loser).fill(second);
        await proceed(loser);
        await waitStep(loser, "profile");
        const winnerUser =
          results[0] === "profile" ? "draft-alice" : "draft-bob";
        const loserUser =
          winnerUser === "draft-alice" ? "draft-bob" : "draft-alice";
        assert.deepEqual(await claims(winnerUser), [{ name, state: "held" }]);
        assert.deepEqual(await claims(loserUser), [
          { name: second, state: "held" },
        ]);
      } finally {
        await other.close();
      }
    },
  );

  await guarded(
    "stale setup tab cannot replace the current reservation",
    async () => {
      await reset();
      const first = await guidePage();
      await provision(first, "alice");
      await open(first);
      const stale = await guidePage();
      await open(stale);
      // Unfinished input in the stale tab blocks its base refresh.
      await field(stale).fill(`stale-${suffix()}`);
      const name = `fresh-${suffix()}`;
      await field(first).fill(name);
      await proceed(first);
      await waitStep(first, "profile");
      await proceed(stale);
      // The stale confirmation is rejected on its old revision. Its input
      // stays local and the shared conflict choices are offered.
      const resolve = stale.getByRole("region", {
        name: "Resolve saved version",
      });
      await resolve.waitFor({ timeout: 30000 });
      await resolve
        .getByRole("button", { name: "Keep my edits for review" })
        .waitFor();
      await resolve
        .getByRole("button", { name: "Load newer version" })
        .waitFor();
      assert.match(
        await stale.locator(".guide-recovery").innerText(),
        /A newer version is saved\. Your edits are preserved for review\./,
      );
      assert.equal(
        await stale
          .locator("[data-guide-step]")
          .getAttribute("data-guide-step"),
        "address",
      );
      assert.deepEqual(await claims(), [{ name, state: "held" }]);
      assert.equal((await portfolio()).requested, name);
      await stale.screenshot({
        path: join(evidence, "guide-stale-tab.png"),
        fullPage: true,
      });
    },
  );

  await guarded(
    "setup guide keyboard, mobile, reduced motion and accessibility",
    async () => {
      await reset();
      const page = await guidePage();
      await provision(page, "alice");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page);
      // Keyboard: Tab reaches the address field, Enter continues.
      await page.locator("body").focus();
      let reached = false;
      for (let i = 0; i < 8 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await page.evaluate(
          () => document.activeElement?.getAttribute("name") === "address",
        );
      }
      assert.ok(reached, "Tab reaches the address field");
      const outline = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".guide-address-input"))
            .outlineStyle,
      );
      assert.equal(outline, "solid");
      assert.equal(
        await page.evaluate(
          () =>
            getComputedStyle(document.querySelector(".guide-progress li"))
              .transitionDuration,
        ),
        "0s",
      );
      await page.evaluate(
        await readFile(
          createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
          "utf8",
        ),
      );
      const axe = () =>
        page.evaluate(async () =>
          (
            await window.axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
              },
            })
          ).violations.map(({ id, nodes }) => ({
            id,
            nodes: nodes.map((node) => node.target),
          })),
        );
      assert.deepEqual(await axe(), []);

      // Mobile: no horizontal overflow and Continue stays reachable.
      await page.setViewportSize({ width: 390, height: 844 });
      await field(page).fill(`mobile-${suffix()}`);
      await field(page).press("Tab");
      await addressStatus(page).filter({ hasText: "Available now" }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: join(evidence, "guide-address-mobile.png"),
      });
      await field(page).press("Enter");
      await waitStep(page, "profile");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(await axe(), []);
      await page.screenshot({
        path: join(evidence, "guide-profile-mobile.png"),
      });
      await page.getByRole("button", { name: "Sign out" }).click();
      assert.equal(await page.evaluate(() => window.guideFixture.signOuts), 1);
      await page.setViewportSize({ width: 1500, height: 1000 });
      await reset();
    },
  );

  // Phase 42B: the combined Profile screen and the required Links screen.
  await guarded("setup guide profile images and required links", async () => {
    await reset();
    const page = await guidePage();
    await provision(page, "alice");
    await open(page);
    await field(page).fill(`profile-${suffix()}`);
    await field(page).press("Tab");
    await addressStatus(page).filter({ hasText: "Available now" }).waitFor();
    await proceed(page);
    await waitStep(page, "profile");
    const stored = async () =>
      JSON.parse(
        (
          await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
        )[0].draft,
      );
    const alert = page.getByRole("alert");

    // Missing required values keep the owner on Profile with an error.
    await proceed(page);
    await alert.filter({ hasText: "Still needed:" }).waitFor();
    assert.equal((await portfolio()).step, "profile");
    assert.equal(await page.getByRole("button", { name: /skip/i }).count(), 0);

    const png = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 900;
        canvas.height = 600;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#2448e8";
        ctx.fillRect(0, 0, 900, 600);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }),
    );
    await page.getByLabel("Name", { exact: true }).fill("Guide Owner");
    await page.getByLabel("Bio", { exact: true }).fill("I build things.");
    for (const purpose of ["avatar", "banner"]) {
      await page
        .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`), {
          exact: true,
        })
        .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
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
    await page.screenshot({ path: join(evidence, "guide-profile-filled.png") });
    await proceed(page);
    await waitStep(page, "links");
    const profile = (await stored()).profile;
    assert.equal(profile.name, "Guide Owner");
    assert.ok(profile.avatar?.assetId && profile.banner?.assetId);
    assert.equal(profile.avatar.accepted, true);

    // Links need one valid labeled link shown in the profile.
    await proceed(page);
    await alert.filter({ hasText: "Add at least one valid link" }).waitFor();
    assert.equal((await portfolio()).step, "links");
    await addLink(page);
    await page.getByLabel("Link label").fill("My site");
    await page.getByLabel("Destination URL").fill("nope");
    await proceed(page);
    await page
      .getByRole("alert")
      .filter({ hasText: /isn't valid|Add at least one valid/ })
      .waitFor();
    assert.equal((await portfolio()).step, "links");
    await page.getByLabel("Destination URL").fill("https://example.com");
    await page.screenshot({ path: join(evidence, "guide-links.png") });
    await proceed(page);
    await waitStep(page, "skills");
    const draft = await stored();
    assert.equal(draft.links.length, 1);
    assert.equal(draft.links[0].value, "https://example.com");
    assert.equal(
      draft.components.some((item) => item.type === "social-links"),
      false,
    );
    // Back and Continue again never duplicate the link.
    await page.getByRole("button", { name: "Back" }).click();
    await waitStep(page, "links");
    await proceed(page);
    await waitStep(page, "skills");
    assert.equal((await stored()).links.length, 1);

    // Optional Skills and Projects: untouched steps create no component.
    const components = async (type) => {
      await page.locator('[data-save-status="saved"]').waitFor();
      return (await stored()).components.filter((item) => item.type === type);
    };
    const skip = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "Skip this step" }).count(),
      1,
    );
    await proceed(page);
    await waitStep(page, "projects");
    assert.equal((await components("skills")).length, 0);
    await page.getByRole("button", { name: "Back" }).click();
    await waitStep(page, "skills");

    // A blank extra skill is dropped; the entered one keeps its id.
    const addSkill = page.getByRole("button", { name: "Add skill" });
    await addSkill.click();
    await page.getByLabel("Skill name").fill("TypeScript");
    await addSkill.click();
    await proceed(page);
    await waitStep(page, "projects");
    const [skills] = await components("skills");
    assert.equal(skills.data.entries.length, 1);
    assert.equal(skills.data.entries[0].name, "TypeScript");
    assert.equal(skills.data.categories.length, 0);
    const skillId = skills.data.entries[0].id;
    await page.getByRole("button", { name: "Back" }).click();
    await waitStep(page, "skills");
    await proceed(page);
    await waitStep(page, "projects");
    const again = await components("skills");
    assert.equal(again.length, 1);
    assert.equal(again[0].data.entries.length, 1);
    assert.equal(again[0].data.entries[0].id, skillId);

    // Projects: an untouched project is dropped and creates no component.
    await page.getByRole("button", { name: "Add project" }).click();
    await skip("Skip this step");
    await waitStep(page, "github");
    assert.equal((await components("projects")).length, 0);
    await page.getByRole("button", { name: "Back" }).click();
    await waitStep(page, "projects");

    // A partial project blocks Continue but survives Skip, once, with its id.
    await page.getByRole("button", { name: "Add project" }).click();
    await page.getByLabel("Project title").fill("Half done");
    await proceed(page);
    await alert.filter({ hasText: "Each project needs a title" }).waitFor();
    assert.equal((await portfolio()).step, "projects");
    await skip("Skip this step");
    await waitStep(page, "github");
    const [kept] = await components("projects");
    assert.equal(kept.data.entries.length, 1);
    assert.equal(kept.data.entries[0].title, "Half done");
    assert.equal(kept.data.entries[0].summary, "");
    const projectId = kept.data.entries[0].id;
    await page.getByRole("button", { name: "Back" }).click();
    await waitStep(page, "projects");
    await page.getByLabel("Summary", { exact: true }).fill("Now complete.");
    await proceed(page);
    await waitStep(page, "github");
    const [done] = await components("projects");
    assert.equal(done.data.entries.length, 1);
    assert.equal(done.data.entries[0].id, projectId);
    assert.equal(done.data.entries[0].summary, "Now complete.");

    // Skip remaining steps targets Review and keeps what was entered.
    await page.getByRole("button", { name: "Back" }).click();
    await waitStep(page, "projects");
    await skip("Skip remaining steps");
    await waitStep(page, "review");
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await portfolio()).step === "review") break;
      await page.waitForTimeout(200);
    }
    assert.equal((await portfolio()).step, "review");
    assert.equal((await components("projects"))[0].data.entries.length, 1);
    assert.equal((await components("skills"))[0].data.entries.length, 1);
    await page.screenshot({ path: join(evidence, "guide-optional.png") });
    await reset();
  });

  // Phase 42D: the optional GitHub screen.
  await checkGuideGitHub({
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
  });

  // Phase 42E: Review, handoff and the activated account entry.
  await checkGuideReview({
    context,
    guarded,
    reset,
    guidePage,
    provision,
    waitStep,
    field,
    addressStatus,
    proceed,
    portfolio,
    suffix,
    sql,
    evidence,
    browserOrigin,
  });

  // Phase 42F: callback continuation and the complete new-user journeys.
  journeys = true;
  await checkGuideJourney({
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
  });
}
