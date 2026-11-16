import assert from "node:assert/strict";
import { join } from "node:path";

async function addWorkComponent(page) {
  const sections = page.getByRole("region", {
    name: "Portfolio sections",
    exact: true,
  });
  await sections
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Work experience", exact: true })
    .click();
  return sections;
}
const flush = (page) =>
  page.evaluate(() =>
    window.editorFixture.recovery.store.getState().controller.flushValid(),
  );

export async function checkWorkExperienceControls({
  getPage,
  boot,
  displayed,
  frame,
  sql,
  run,
  evidence,
}) {
  await run(
    "work experience: empty start, ongoing role, reversed dates, link recovery, ordering and confirmed removal",
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
      const sections = await addWorkComponent(page);
      assert.equal(await page.locator("[data-work-id]").count(), 0);
      await page.getByRole("button", { name: "Add role", exact: true }).click();
      const first = page.locator("[data-work-id]").first();
      assert.equal(
        await first
          .getByLabel("Start date", { exact: true })
          .getAttribute("aria-invalid"),
        "true",
      );
      await first.getByLabel("Role", { exact: true }).fill("Staff Engineer");
      await first.getByLabel("Start date", { exact: true }).fill("2024-05");
      const end = first.getByLabel("End date", { exact: true });
      await end.fill("2024-01");
      assert.equal(await end.getAttribute("aria-invalid"), "true");
      const noteId = await end.getAttribute("aria-describedby");
      assert.ok(noteId);
      assert.match(
        await page.locator(`[id="${noteId}"]`).innerText(),
        /End date must not precede start date/,
      );
      assert.equal((await flush(page)).hasLocalOnlyInput, true);
      // Reversed dates block Publish and are reported as the end date.
      const checklist = page.getByRole("region", {
        name: "Publication checklist",
      });
      await checklist
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await checklist
        .getByText(/Finish unsaved.*end date/i)
        .first()
        .waitFor();
      assert.equal(
        await checklist.getByText("Publication complete.").count(),
        0,
      );
      await first.getByLabel("End date", { exact: true }).fill("2024-09");
      assert.equal((await flush(page)).hasLocalOnlyInput, false);
      // Ongoing role: no end date is stored or required.
      await first.getByLabel("I currently work here", { exact: true }).check();
      assert.equal(
        await first.getByLabel("End date", { exact: true }).count(),
        0,
      );
      await first
        .getByLabel("Organization link (optional)", { exact: true })
        .fill("javascript:alert(1)");
      await first
        .getByLabel("Description", { exact: true })
        .fill("Line one\nLine two");
      await page.getByRole("button", { name: "Add role", exact: true }).click();
      const second = page.locator("[data-work-id]").nth(1);
      await second.getByLabel("Role", { exact: true }).fill("Intern");
      await second
        .getByLabel("Organization link (optional)", { exact: true })
        .fill("https://");
      const result = await flush(page);
      assert.equal(result.hasLocalOnlyInput, true);
      const saved = JSON.parse(
        (
          await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
        )[0].draft,
      );
      const [a, b] = saved.components[0].data.entries;
      assert.equal(a.current, true);
      assert.equal("endDate" in a, false);
      assert.equal(a.description, "Line one\nLine two");
      assert.equal(b.organization, "");
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("button", { name: "Continue preserved edits", exact: true })
        .click();
      await sections
        .getByRole("button", { name: "Work experience", exact: true })
        .click();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("label")).some(
          (label) =>
            label.textContent.includes("Organization link (optional)") &&
            label.control?.value === "javascript:alert(1)",
        ),
      );
      await page
        .locator("[data-work-id]")
        .first()
        .getByLabel("Organization link (optional)", { exact: true })
        .fill("");
      await page
        .getByRole("button", { name: "Move Intern up", exact: true })
        .click();
      assert.equal(
        await page
          .locator("[data-work-id]")
          .first()
          .getByLabel("Organization link (optional)", { exact: true })
          .inputValue(),
        "https://",
      );
      await page
        .locator("[data-work-id]")
        .first()
        .getByRole("button", { name: "Remove role", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Keep role", exact: true })
        .click();
      assert.equal(await page.locator("[data-work-id]").count(), 2);
      await page
        .locator("[data-work-id]")
        .first()
        .getByRole("button", { name: "Remove role", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm remove role", exact: true })
        .click();
      assert.equal((await flush(page)).hasLocalOnlyInput, false);
      assert.equal(
        await page.locator("[data-work-id]").getAttribute("data-work-id"),
        a.id,
      );
      await displayed();
      assert.equal(
        await frame().locator("[data-component-id] .pf-entry a").count(),
        0,
      );
      await page.screenshot({
        path: join(evidence, "work-experience-controls-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1500, height: 1000 });
    },
  );
}

export async function preparePublishedWork(page) {
  const sections = await addWorkComponent(page);
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  const checklist = page.getByRole("region", { name: "Publication checklist" });
  await checklist.getByRole("button", { name: "Publish", exact: true }).click();
  await checklist
    .getByText(/work experience role/i)
    .first()
    .waitFor();
  const first = page.locator("[data-work-id]").first();
  await first.getByLabel("Role", { exact: true }).fill("Senior Engineer");
  await first.getByLabel("Organization", { exact: true }).fill("Example Org");
  await first
    .getByLabel("Organization link (optional)", { exact: true })
    .fill("https://example.com/org");
  await first.getByLabel("Start date", { exact: true }).fill("2020-01");
  await first.getByLabel("I currently work here", { exact: true }).check();
  await first
    .getByLabel("Description", { exact: true })
    .fill("Built things.\nLed a team.");
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  const second = page.locator("[data-work-id]").nth(1);
  await second.getByLabel("Role", { exact: true }).fill("Intern");
  await second.getByLabel("Organization", { exact: true }).fill("Acme");
  await second.getByLabel("Start date", { exact: true }).fill("2018-06");
  await second.getByLabel("End date", { exact: true }).fill("2018-09");
  await second
    .getByLabel("Description", { exact: true })
    .fill("Summer placement");
  await page
    .getByRole("button", { name: "Move Intern up", exact: true })
    .click();
  await flush(page);
  await sections.getByRole("button", { name: "Profile", exact: true }).click();
}

export async function assertPublishedWork(page, html) {
  const rows = await page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    return [
      ...doc.querySelectorAll('[data-component="work-experience"] .pf-entry'),
    ].map((entry) => ({
      role: entry.querySelector("h3")?.textContent,
      text: entry.textContent,
      links: [...entry.querySelectorAll("a")].map((link) =>
        link.getAttribute("href"),
      ),
      description: entry.querySelector("p:last-child")?.textContent,
    }));
  }, html);
  assert.deepEqual(
    rows.map((row) => row.role),
    ["Intern", "Senior Engineer"],
  );
  assert.deepEqual(rows[0].links, []);
  assert.match(rows[0].text, /Acme/);
  assert.match(rows[0].text, /2018-06 · 2018-09/);
  assert.deepEqual(rows[1].links, ["https://example.com/org"]);
  assert.match(rows[1].text, /2020-01 · Present/);
  assert.equal(rows[1].description, "Built things.\nLed a team.");
  assert.doesNotMatch(html, /Education/);
  return rows;
}
