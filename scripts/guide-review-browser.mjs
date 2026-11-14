import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

// Phase 42E: Review, the permanent first editor handoff and the activated
// account entry. These groups go through `/auth/entry` and `/editor`, which
// the harness serves with the production `OwnerEntry` resolver, and through
// the production Worker's `/editor/preview` iframe document (gate open in
// this harness only).
export async function checkGuideReview({
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
}) {
  const stored = async (user = "draft-alice") =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id=?", [user]))[0]
        .draft,
    );
  const saved = (page) =>
    page.locator('.guide-save[data-save-status="saved"]').waitFor();
  const skip = (page, name) =>
    page.getByRole("button", { name, exact: true }).click();
  const until = async (check, message) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.fail(message);
  };
  // Leaving for sign-in loads no fixture bundle in this harness.
  async function stubSignIn(page) {
    await page.route("**/sign-in**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Sign in</title><h1>Sign in</h1>",
      }),
    );
  }
  // The activated account entry, as an OAuth callback would open it.
  async function entry(page) {
    await page.goto(`${browserOrigin}/auth/entry`);
    await page.waitForFunction(() => window.guideFixture?.ready);
  }
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

  // Address, Profile and Links through the real screens and uploads.
  async function completeRequired(page, name) {
    await waitStep(page, "address");
    await field(page).fill(name);
    await field(page).press("Tab");
    await addressStatus(page).filter({ hasText: "Available now" }).waitFor();
    await proceed(page);
    await waitStep(page, "profile");
    const image = Buffer.from(await png(page, "#2448e8"));
    await page.getByLabel("Name", { exact: true }).fill("Review Owner");
    await page
      .getByLabel("Bio", { exact: true })
      .fill("I build careful things.");
    for (const purpose of ["avatar", "banner"]) {
      await page
        .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`), {
          exact: true,
        })
        .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: image });
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
    await proceed(page);
    await waitStep(page, "links");
    await page.getByRole("button", { name: "Add link", exact: true }).click();
    await page.getByLabel("Link label").fill("My site");
    await page.getByLabel("Destination URL").fill("https://example.com");
    await proceed(page);
    await waitStep(page, "skills");
  }

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
    assert.ok(frame, "Review uses the production /editor/preview document");
    return frame;
  };
  const sectionTypes = (frame) =>
    frame.evaluate(() =>
      [...document.querySelectorAll("[data-component-id]")].map(
        (element) => element.closest("[data-component]")?.dataset.component,
      ),
    );

  await guarded(
    "setup guide Review, Skip remaining, statuses and handoff into the editor",
    async () => {
      await reset();
      const page = await guidePage();
      await provision(page, "alice");
      await stubSignIn(page);
      // A setup owner sent to /editor is resolved back to the guide.
      await page.goto(`${browserOrigin}/editor`);
      await page.waitForURL(`${browserOrigin}/auth/entry`);
      await page.waitForFunction(() => window.guideFixture?.ready);
      const name = `review-${suffix()}`;
      await completeRequired(page, name);

      // Skills, then a partial project, then Skip remaining steps.
      await page.getByRole("button", { name: "Add skill" }).click();
      await page.getByLabel("Skill name").fill("TypeScript");
      await proceed(page);
      await waitStep(page, "projects");
      await page.getByRole("button", { name: "Add project" }).click();
      await page.getByLabel("Project title").fill("Half done");
      // Unfinished optional input stays local for editor recovery.
      await page.getByLabel("Code URL (optional)").fill("htt");
      await skip(page, "Skip remaining steps");
      await waitStep(page, "review");
      await until(
        async () => (await portfolio()).step === "review",
        "Skip remaining did not save Review",
      );

      // Review: heading, private address line, Back, no skips, Open editor.
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        "Take a look around",
      );
      await page
        .locator(".guide-review-address")
        .filter({ hasText: `${name}.hasaweb.site` })
        .filter({ hasText: "Private draft" })
        .waitFor();
      assert.equal(await page.getByRole("button", { name: "Back" }).count(), 1);
      assert.equal(
        await page.getByRole("button", { name: /skip/i }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("button", { name: "Continue" }).count(),
        0,
      );
      await page
        .getByText("Your portfolio stays private until you Publish.")
        .waitFor();

      // The shared renderer shows the saved draft: profile, link, then the
      // entered optional sections in Skills/Projects order.
      let frame = await reviewFrame(page);
      await frame.getByText("Review Owner", { exact: true }).first().waitFor();
      await frame.getByText("My site", { exact: true }).first().waitFor();
      await frame.getByText("TypeScript", { exact: true }).first().waitFor();
      await frame.getByText("Half done", { exact: true }).first().waitFor();
      assert.deepEqual(await sectionTypes(frame), ["skills", "projects"]);
      assert.equal(await frame.getByText("htt", { exact: true }).count(), 0);
      const draftBefore = await stored();
      assert.equal(draftBefore.components.length, 2);

      // Honest statuses: the partial project is reported, not hidden, and
      // the local-only input is identified as unsaved.
      const status = page.locator("[data-review-status]");
      await page
        .locator('[data-review-status="checked"]')
        .waitFor({ timeout: 30000 });
      await status
        .locator("[data-review-issue]")
        .filter({ hasText: /projects summary/i })
        .waitFor();
      await status.getByText(/Your required profile is complete/).waitFor();
      await page.locator("[data-review-local-input]").waitFor();
      assert.equal(
        await page.getByText(/ready to publish|publish-ready/i).count(),
        0,
      );

      // Desktop/mobile switching uses the actual child widths.
      const width = page.getByRole("group", { name: "Preview width" });
      await width.getByRole("button", { name: "Mobile" }).click();
      assert.equal(
        await width
          .getByRole("button", { name: "Mobile" })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page
          .locator("iframe.editor-preview-frame")
          .evaluate((element) => element.getBoundingClientRect().width),
        392,
      );
      await page.screenshot({
        path: join(evidence, "guide-review-mobile-preview.png"),
        fullPage: true,
      });
      await width.getByRole("button", { name: "Desktop" }).click();

      // Back returns to GitHub; Skip remaining from there lands on Review.
      await page.getByRole("button", { name: "Back" }).click();
      await waitStep(page, "github");
      await skip(page, "Skip remaining steps");
      await waitStep(page, "review");
      await page.screenshot({
        path: join(evidence, "guide-review.png"),
        fullPage: true,
      });

      // A lost handoff request is a failure, never a false success.
      let blocked = 0;
      await page.route("**/api/owner/setup/handoff", (route) => {
        blocked++;
        return route.abort();
      });
      await page.getByRole("button", { name: "Open editor" }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Your draft is safe" })
        .waitFor();
      assert.equal(blocked, 1);
      assert.equal((await portfolio()).entered, null);
      assert.equal(page.url(), `${browserOrigin}/auth/entry`);
      await page.unroute("**/api/owner/setup/handoff");
      const savedBefore = await stored();
      await page.getByRole("button", { name: "Retry opening editor" }).click();

      // The permanent handoff opens the editor in the same tab with exactly
      // the prepared content.
      await page.waitForURL(`${browserOrigin}/editor`, { timeout: 30000 });
      await page.waitForFunction(() => window.editorFixture?.ready);
      const row = await portfolio();
      assert.ok(row.entered, "handoff recorded the permanent milestone");
      assert.equal(row.step, "review");
      const working = await page.evaluate(
        () =>
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
      );
      assert.deepEqual(working, savedBefore);
      assert.deepEqual(await stored(), savedBefore);
      frame = await reviewFrame(page);
      await frame.getByText("Half done", { exact: true }).first().waitFor();
      // The unfinished setup input is offered for explicit recovery only.
      await page
        .getByRole("region", { name: "Preserved input" })
        .filter({ hasText: "Preserved setup input" })
        .waitFor({ timeout: 30000 });
      assert.deepEqual(await stored(), savedBefore);
      // The activated editor offers sign-out.
      await page.getByRole("button", { name: "Sign out" }).click();
      assert.equal(await page.evaluate(() => window.editorFixture.signOuts), 1);

      // Returning sign-ins reopen the editor; the consent marker survives.
      await page.goto(`${browserOrigin}/auth/entry`);
      await page.waitForURL(`${browserOrigin}/editor`);
      await page.goto(`${browserOrigin}/auth/entry?github=consent`);
      await page.waitForURL(/\/editor$/, { timeout: 30000 });
      await page.waitForFunction(() => window.editorFixture?.ready);

      // A stale setup tab cannot reapply setup or replay progress.
      const stale = await guidePage();
      await stale.goto(`${browserOrigin}/guide`);
      await stale.waitForFunction(() => window.guideFixture?.ready);
      await stale.locator("[data-guide-closed]").waitFor({ timeout: 30000 });
      // No step navigation: the guide's own Back, Continue and skips are gone.
      for (const name of [
        "Back",
        "Continue",
        "Skip this step",
        "Skip remaining steps",
      ])
        assert.equal(
          await stale.getByRole("button", { name, exact: true }).count(),
          0,
          name,
        );
      const progressBefore = (await portfolio()).step;
      await stale.getByRole("button", { name: "Open editor" }).click();
      await stale.waitForURL(`${browserOrigin}/editor`);
      assert.equal((await portfolio()).step, progressBefore);
      assert.equal((await portfolio()).entered, row.entered);

      await stale.close();

      // The preserved setup input goes through Phase 15 selected review into
      // a fresh content scope: it is shown, nothing is applied unselected,
      // and setup progress stays frozen.
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("region", { name: "Preserved input" })
        .getByRole("button", { name: "Keep my edits for review", exact: true })
        .click();
      const review = page.getByRole("region", {
        name: "Review your preserved edits",
      });
      await review
        .getByText(/Setup has ended\. Selected content opens/)
        .waitFor();
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
      assert.deepEqual(await stored(), savedBefore);
      assert.equal((await portfolio()).step, "review");
      assert.equal((await portfolio()).entered, row.entered);

      // Later missing required content blocks Publish without onboarding.
      await page.evaluate(() =>
        window.editorFixture.recovery.store
          .getState()
          .controller.edit(["profile", "name"], ""),
      );
      await until(
        async () => (await stored()).profile.name === "",
        "the editor did not save the removed name",
      ).catch(async (error) => {
        const state = await page.evaluate(() => {
          const recovery = window.editorFixture.recovery.store.getState();
          const draft = recovery.controller.store.getState();
          return JSON.stringify({
            busy: recovery.busy,
            error: recovery.error,
            status: draft.status,
            draftError: draft.error,
            suspended: draft.suspended,
            name: draft.working?.profile.name,
            recoveries: draft.recoveries.map((entry) => entry.context),
          });
        });
        throw new Error(`${error.message}: ${state}`);
      });
      await page.waitForFunction(
        () =>
          !window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().batch,
      );
      const issues = await page.evaluate(async () => {
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
      assert.ok(
        issues.some(
          (issue) =>
            issue.code === "required" &&
            issue.path.join(".") === "profile.name",
        ),
        JSON.stringify(issues),
      );
      await page.goto(`${browserOrigin}/auth/entry`);
      await page.waitForURL(`${browserOrigin}/editor`);
      await page.waitForFunction(() => window.editorFixture?.ready);
      assert.equal((await portfolio()).entered, row.entered);
      await reset();
    },
  );

  await guarded(
    "setup guide Review with every optional step skipped, missing content and access",
    async () => {
      await reset();
      const page = await guidePage();
      await provision(page, "alice");
      await stubSignIn(page);
      await entry(page);
      const name = `skipped-${suffix()}`;
      await completeRequired(page, name);
      await skip(page, "Skip remaining steps");
      await waitStep(page, "review");

      // Only the real profile and link: no sections, no samples.
      const frame = await reviewFrame(page);
      await frame.getByText("Review Owner", { exact: true }).first().waitFor();
      await frame.getByText("My site", { exact: true }).first().waitFor();
      assert.deepEqual(await sectionTypes(frame), []);
      assert.deepEqual((await stored()).components, []);
      await page
        .locator('[data-review-status="checked"]')
        .getByText(/Nothing in your saved draft is unfinished/)
        .waitFor({ timeout: 30000 });

      // Accessibility and layout at desktop and phone widths.
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
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(await axe(), []);
      await page.screenshot({
        path: join(evidence, "guide-review-skipped-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1500, height: 1000 });

      // Another owner and a signed-out visitor get none of the draft's data,
      // images or graph preview.
      const avatar = (await stored()).profile.avatar.assetId;
      for (const session of ["bob", "none"]) {
        const other = await context.browser().newContext();
        try {
          await other.addCookies([
            { name: "fixture-session", value: session, url: browserOrigin },
          ]);
          const image = await other.request.get(
            `${browserOrigin}/api/assets/${avatar}?purpose=avatar`,
          );
          assert.ok([401, 404].includes(image.status()), `${session} image`);
          // Bob reads only Bob's own draft; a visitor reads nothing.
          const draft = await other.request.get(
            `${browserOrigin}/api/owner/draft`,
          );
          if (session === "none") assert.equal(draft.status(), 401);
          assert.doesNotMatch(await draft.text(), new RegExp(name));
          const graph = await other.request.get(
            `${browserOrigin}/api/owner/github/preview`,
          );
          assert.doesNotMatch(await graph.text(), new RegExp(name));
          if (session === "none") {
            const document = await other.request.get(
              `${browserOrigin}/editor/preview`,
            );
            assert.equal(document.status(), 401);
          }
        } finally {
          await other.close();
        }
      }

      // Required content that stops being valid after Review cannot hand
      // off: the guide returns to its step and records no milestone.
      await sql("UPDATE asset SET status='failed' WHERE id=?", [avatar]);
      await page.getByRole("button", { name: "Open editor" }).click();
      await waitStep(page, "profile");
      await page
        .getByRole("alert")
        .filter({ hasText: "Required content is missing: avatar" })
        .waitFor();
      assert.equal((await portfolio()).entered, null);
      assert.equal((await portfolio()).step, "review");
      await sql("UPDATE asset SET status='ready' WHERE id=?", [avatar]);
      await page.reload();
      await page.waitForFunction(() => window.guideFixture?.ready);
      await waitStep(page, "review");
      await saved(page);
      await page.getByRole("button", { name: "Open editor" }).click();
      await page.waitForURL(`${browserOrigin}/editor`, { timeout: 30000 });
      await page.waitForFunction(() => window.editorFixture?.ready);
      assert.ok((await portfolio()).entered);
      assert.deepEqual(
        await page.evaluate(
          () =>
            window.editorFixture.recovery.store
              .getState()
              .controller.store.getState().working.components,
        ),
        [],
      );

      // A signed-out entry leaves for sign-in without showing any draft.
      await page.context().clearCookies();
      await page.goto(`${browserOrigin}/auth/entry`);
      await page.waitForURL(/\/sign-in\?reason=session_expired$/);
      await reset();
    },
  );
}
