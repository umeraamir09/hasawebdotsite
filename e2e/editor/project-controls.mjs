import assert from "node:assert/strict";
import { join } from "node:path";
import { addSection, openChecklist, openSection } from "./shell.mjs";

export async function checkProjectControls({
  getPage,
  boot,
  displayed,
  frame,
  sql,
  run,
  evidence,
}) {
  await run(
    "project creation, partial saved entries, stable raw recovery, ordering and cancelled removal",
    async () => {
      await boot();
      const draft = await getPage().evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      draft.components = [];
      draft.samples = {};
      await boot(draft);
      const page = getPage();
      await page.setViewportSize({ width: 390, height: 844 });
      await addSection(page, "Projects");
      assert.equal(await page.locator("[data-project-id]").count(), 0);
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .click();
      await page
        .getByLabel("Project title", { exact: true })
        .fill("First project");
      assert.equal(
        await page
          .getByLabel("Summary", { exact: true })
          .getAttribute("aria-invalid"),
        "true",
      );
      await page
        .getByLabel("Code URL (optional)", { exact: true })
        .fill("https://");
      const result = await page.evaluate(() =>
        window.editorFixture.recovery.store.getState().controller.flushValid(),
      );
      assert.equal(result.hasLocalOnlyInput, true);
      const saved = JSON.parse(
        (
          await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
        )[0].draft,
      );
      const firstId = saved.components[0].data.entries[0].id;
      assert.equal(saved.components[0].data.entries[0].summary, "");
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("button", { name: "Continue preserved edits", exact: true })
        .click();
      await openSection(page, "Projects");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("label")).some(
          (label) =>
            label.textContent.includes("Code URL (optional)") &&
            label.control?.value === "https://",
        ),
      );
      await page.getByLabel("Code URL (optional)", { exact: true }).fill("");
      await page.getByLabel("Summary", { exact: true }).fill("First summary");
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .click();
      const second = page.locator("[data-project-id]").nth(1);
      await second
        .getByLabel("Project title", { exact: true })
        .fill("Second project");
      await second
        .getByLabel("Summary", { exact: true })
        .fill("Second summary");
      await second
        .getByLabel("Demo URL (optional)", { exact: true })
        .fill("javascript:alert(1)");
      await page
        .getByRole("button", { name: "Move Second project up", exact: true })
        .click();
      assert.equal(
        await page
          .locator("[data-project-id]")
          .first()
          .getByLabel("Demo URL (optional)", { exact: true })
          .inputValue(),
        "javascript:alert(1)",
      );
      await page
        .locator("[data-project-id]")
        .first()
        .getByRole("button", { name: "Remove project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Keep project", exact: true })
        .click();
      assert.equal(await page.locator("[data-project-id]").count(), 2);
      await page
        .locator("[data-project-id]")
        .first()
        .getByRole("button", { name: "Remove project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm remove project", exact: true })
        .click();
      const flushed = await page.evaluate(() =>
        window.editorFixture.recovery.store.getState().controller.flushValid(),
      );
      assert.equal(flushed.hasLocalOnlyInput, false);
      assert.equal(
        await page.locator("[data-project-id]").getAttribute("data-project-id"),
        firstId,
      );
      await displayed();
      assert.equal(
        await frame().locator("[data-component-id] .pf-entry img").count(),
        0,
      );
      assert.equal(
        await frame()
          .locator("[data-component-id] .pf-entry .pf-links")
          .count(),
        0,
      );
      await page.screenshot({
        path: join(evidence, "project-controls-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1500, height: 1000 });
    },
  );
}

export async function preparePublishedProjects(page, image) {
  await addSection(page, "Projects");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const checklist = () => openChecklist(page);
  await (await checklist())
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await (await checklist())
    .getByText(/projects title/i)
    .first()
    .waitFor();
  await page.getByLabel("Project title", { exact: true }).fill("Owner project");
  await (await checklist())
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await (await checklist())
    .getByText(/projects summary/i)
    .first()
    .waitFor();
  await page.getByLabel("Summary", { exact: true }).fill("Built by the owner");
  await page
    .getByLabel("Individual contribution (optional)", { exact: true })
    .fill("I designed and implemented the tool.");
  await page
    .getByLabel("Technologies (optional, one per line)", { exact: true })
    .fill("TypeScript\nSQLite");
  await page
    .getByLabel("Code URL (optional)", { exact: true })
    .fill("https://example.com/code");
  await page
    .getByLabel("Demo URL (optional)", { exact: true })
    .fill("https://example.com/demo");
  await page.getByLabel("Upload project", { exact: true }).setInputFiles({
    name: "project.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page
    .getByRole("region", { name: "Project image", exact: true })
    .getByText("Upload complete. Your draft image is ready.")
    .waitFor();
  const imageRegion = page.getByRole("region", {
    name: "Project image",
    exact: true,
  });
  const oldImage = await imageRegion.locator("img").getAttribute("src");
  await page.route("**/api/assets", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"fixture_upload_failure"}',
    }),
  );
  await page.getByLabel("Replace project", { exact: true }).setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: image,
  });
  await imageRegion
    .getByRole("button", { name: "Retry upload", exact: true })
    .waitFor();
  assert.equal(await imageRegion.locator("img").getAttribute("src"), oldImage);
  await page.unroute("**/api/assets");
  await imageRegion
    .getByRole("button", { name: "Retry upload", exact: true })
    .click();
  await imageRegion
    .getByText("Upload complete. Your draft image is ready.")
    .waitFor();
  assert.notEqual(
    await imageRegion.locator("img").getAttribute("src"),
    oldImage,
  );
  await imageRegion
    .getByRole("button", { name: "Remove project image", exact: true })
    .click();
  assert.equal(await imageRegion.locator("img").count(), 0);
  await page.getByLabel("Upload project", { exact: true }).setInputFiles({
    name: "project.png",
    mimeType: "image/png",
    buffer: image,
  });
  await imageRegion
    .getByText("Upload complete. Your draft image is ready.")
    .waitFor();
  await page
    .getByLabel("Project description", { exact: true })
    .fill("The owner project");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const second = page.locator("[data-project-id]").nth(1);
  await second
    .getByLabel("Project title", { exact: true })
    .fill("Minimal project");
  await second
    .getByLabel("Summary", { exact: true })
    .fill("Only required fields");
  await page
    .getByRole("button", { name: "Move Minimal project up", exact: true })
    .click();
  await page.evaluate(() =>
    window.editorFixture.recovery.store.getState().controller.flushValid(),
  );
  await openSection(page, "Profile");
}

export async function assertPublishedProjects(page, html) {
  const cards = await page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    return [
      ...doc.querySelectorAll('[data-component="projects"] .pf-entry'),
    ].map((entry) => ({
      title: entry.querySelector("h3")?.textContent,
      text: entry.textContent,
      links: [...entry.querySelectorAll("a")].map((link) =>
        link.getAttribute("href"),
      ),
      image: entry.querySelector("img")?.getAttribute("src"),
      alt: entry.querySelector("img")?.getAttribute("alt"),
      emptyControls: entry.querySelectorAll(".pf-links:empty, .pf-tags:empty")
        .length,
    }));
  }, html);
  assert.deepEqual(
    cards.map((card) => card.title),
    ["Minimal project", "Owner project"],
  );
  assert.deepEqual(cards[0].links, []);
  assert.equal(cards[0].image, undefined);
  assert.equal(cards[0].emptyControls, 0);
  assert.match(cards[1].text, /I designed and implemented the tool/);
  assert.match(cards[1].text, /TypeScript/);
  assert.match(cards[1].text, /SQLite/);
  assert.deepEqual(cards[1].links, [
    "https://example.com/code",
    "https://example.com/demo",
  ]);
  assert.equal(cards[1].alt, "The owner project");
  assert.match(cards[1].image, /^https:\/\/assets\.hasaweb\.site\/candidate\//);
  return cards;
}
