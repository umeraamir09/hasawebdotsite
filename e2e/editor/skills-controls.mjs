import assert from "node:assert/strict";
import { join } from "node:path";
import { addSection, openChecklist, openSection } from "./shell.mjs";

const readGroups = (root) =>
  [...root.querySelectorAll(".pf-entry")].map((entry) => ({
    name: entry.querySelector("h3")?.textContent ?? "",
    skills: [...entry.querySelectorAll("li")].map((li) => li.textContent),
  }));

async function openSkillsSection(page) {
  const sections = page.getByRole("region", {
    name: "Page",
    exact: true,
  });
  await addSection(page, "Skills and technologies");
  return sections;
}

// Adds skills in the order given, then categories, via the real controls.
async function fillSkills(page, skills, categories) {
  for (const name of skills) {
    await page.getByRole("button", { name: "Add skill", exact: true }).click();
    await page
      .locator("[data-skill-id]")
      .last()
      .getByLabel("Skill name", { exact: true })
      .fill(name);
  }
  for (const name of categories) {
    await page
      .getByRole("button", { name: "Add category", exact: true })
      .click();
    await page
      .locator("[data-category-id]")
      .last()
      .getByLabel("Category name", { exact: true })
      .fill(name);
  }
}

const skill = (page, name) =>
  page.locator("[data-skill-id]").filter({
    has: page.locator(`input[value="${name}"]`),
  });
const assign = (page, name, category) =>
  skill(page, name)
    .getByLabel("Category (optional)", { exact: true })
    .selectOption({ label: category });

export async function checkSkillsControls({
  getPage,
  boot,
  displayed,
  frame,
  run,
  evidence,
}) {
  await run(
    "skills and categories: names, assignment, ordering, confirmed removal and saved-order preview",
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
      await openSkillsSection(page);
      assert.equal(await page.locator("[data-skill-id]").count(), 0);
      assert.equal(
        await page.getByLabel("Category (optional)", { exact: true }).count(),
        0,
      );
      await fillSkills(page, ["Zig", "Rust", "TypeScript", "Go"], []);
      assert.equal(
        await page.getByLabel("Category (optional)", { exact: true }).count(),
        0,
        "category select is omitted until a category exists",
      );
      await fillSkills(page, [], ["Languages", "Tools"]);
      await assign(page, "Rust", "Tools");
      await assign(page, "TypeScript", "Languages");
      await assign(page, "Go", "Languages");
      await page
        .getByRole("button", { name: "Move Go up", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Move Tools up", exact: true })
        .click();
      await displayed();
      const preview = () =>
        frame().evaluate(
          (source) =>
            new Function(`return (${source})`)()(
              document.querySelector("[data-component-id]"),
            ),
          readGroups.toString(),
        );
      assert.deepEqual(await preview(), [
        { name: "Tools", skills: ["Rust"] },
        { name: "Languages", skills: ["Go", "TypeScript"] },
        { name: "", skills: ["Zig"] },
      ]);
      // Cancelled and confirmed category removal keep the skills.
      const tools = page.locator("[data-category-id]").first();
      await tools
        .getByRole("button", { name: "Remove category", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Keep category", exact: true })
        .click();
      assert.equal(await page.locator("[data-category-id]").count(), 2);
      await tools
        .getByRole("button", { name: "Remove category", exact: true })
        .click();
      await page
        .getByText("stays in your list as uncategorized", { exact: false })
        .waitFor();
      await page
        .getByRole("button", { name: "Confirm remove category", exact: true })
        .click();
      assert.equal(await page.locator("[data-category-id]").count(), 1);
      assert.equal(await page.locator("[data-skill-id]").count(), 4);
      assert.equal(
        await skill(page, "Rust")
          .getByLabel("Category (optional)", { exact: true })
          .inputValue(),
        "",
      );
      await displayed();
      assert.deepEqual(await preview(), [
        { name: "Languages", skills: ["Go", "TypeScript"] },
        { name: "", skills: ["Zig", "Rust"] },
      ]);
      // Skill removal is confirmed; a blank name is flagged before Publish.
      await page
        .getByRole("button", { name: "Add skill", exact: true })
        .click();
      assert.equal(
        await page
          .locator("[data-skill-id]")
          .last()
          .getByLabel("Skill name", { exact: true })
          .getAttribute("aria-invalid"),
        "true",
      );
      await page
        .locator("[data-skill-id]")
        .last()
        .getByRole("button", { name: "Remove skill", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Keep skill", exact: true })
        .click();
      assert.equal(await page.locator("[data-skill-id]").count(), 5);
      await page
        .locator("[data-skill-id]")
        .last()
        .getByRole("button", { name: "Remove skill", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm remove skill", exact: true })
        .click();
      assert.equal(await page.locator("[data-skill-id]").count(), 4);
      await page.screenshot({
        path: join(evidence, "skills-controls-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1500, height: 1000 });
    },
  );
}

// Builds a published-journey fixture: saved order differs from category order.
export async function preparePublishedSkills(page) {
  await openSkillsSection(page);
  const checklist = () => openChecklist(page);
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await (await checklist())
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await (await checklist())
    .getByText(/skills and technologies name/i)
    .first()
    .waitFor();
  await page
    .locator("[data-skill-id]")
    .first()
    .getByLabel("Skill name", { exact: true })
    .fill("Zig");
  await fillSkills(page, ["Rust", "TypeScript", "Go"], ["Languages", "Tools"]);
  await assign(page, "Rust", "Tools");
  await assign(page, "TypeScript", "Languages");
  await assign(page, "Go", "Languages");
  await page.getByRole("button", { name: "Move Go up", exact: true }).click();
  await page
    .getByRole("button", { name: "Move Tools up", exact: true })
    .click();
  await page.evaluate(() =>
    window.editorFixture.recovery.store.getState().controller.flushValid(),
  );
  await openSection(page, "Profile");
}

export async function assertPublishedSkills(page, html) {
  const result = await page.evaluate(
    ({ markup, source }) => {
      const read = new Function(`return (${source})`)();
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const section = doc.querySelector('[data-component="skills"]');
      const draft = window.editorFixture.recovery.store
        .getState()
        .controller.store.getState().working;
      const component = draft.components.find((item) => item.type === "skills");
      // Expected groups come from the saved draft: category order, then the
      // uncategorized group, each in saved entry order.
      const expected = component.data.categories
        .map((category) => ({
          name: category.name,
          skills: component.data.entries
            .filter((entry) => entry.categoryId === category.id)
            .map((entry) => entry.name),
        }))
        .concat([
          {
            name: "",
            skills: component.data.entries
              .filter((entry) => !entry.categoryId)
              .map((entry) => entry.name),
          },
        ])
        .filter((group) => group.skills.length);
      return {
        groups: section ? read(section) : null,
        expected,
        text: section?.textContent ?? "",
        extras: section?.querySelectorAll("meter,progress,[role=meter],img")
          .length,
      };
    },
    { markup: html, source: readGroups.toString() },
  );
  assert.deepEqual(result.groups, [
    { name: "Tools", skills: ["Rust"] },
    { name: "Languages", skills: ["Go", "TypeScript"] },
    { name: "", skills: ["Zig"] },
  ]);
  assert.deepEqual(result.groups, result.expected);
  assert.equal(result.extras, 0);
  assert.doesNotMatch(result.text, /\d\s*\/\s*\d|%|level|rating|expert/i);
}
