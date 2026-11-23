import assert from "node:assert/strict";
import { join } from "node:path";
import { addSection, outline, outlineOrder, removeSection } from "./shell.mjs";

// The editor shell's page outline, canvas and Add section gallery
// (Phase 51.2): one selection shared by the canvas, the outline and the
// keyboard, section moves from each, confirmed removal and the mobile dock.
export async function checkComponentControls({
  getPage,
  boot,
  frame,
  displayed,
  sql,
  run,
  evidence,
}) {
  const flush = () =>
    getPage().evaluate(() =>
      window.editorFixture.recovery.store.getState().controller.flushValid(),
    );
  const stored = async () =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'"))[0]
        .draft,
    );
  const selectedInFrame = () =>
    frame()
      .locator("[data-editor-selected]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.dataset.componentId ?? node.dataset.component),
      );
  const currentRow = async () =>
    (await outline(getPage()))
      .locator('[aria-current="true"]')
      .getAttribute("aria-label");
  async function empty() {
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
    return getPage();
  }
  await run(
    "Add section gallery renders each type, marks added singletons and allows several text sections",
    async () => {
      const page = await empty();
      await addSection(page, "Text section");
      await page
        .getByLabel("Section title", { exact: true })
        .fill("First story");
      await addSection(page, "Text section");
      await page
        .getByLabel("Section title", { exact: true })
        .fill("Second story");
      await addSection(page, "Skills and technologies");
      const sections = await outline(page);
      await sections
        .getByRole("button", { name: "Add section", exact: true })
        .first()
        .click();
      const gallery = page.getByRole("dialog", { name: "Add section" });
      assert.equal(
        await gallery
          .getByRole("button", {
            name: "Add Skills and technologies",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      assert.equal(
        await gallery
          .getByRole("button", { name: "Add Text section", exact: true })
          .isDisabled(),
        false,
      );
      assert.equal(
        await gallery.getByRole("button", { name: /Education/ }).count(),
        0,
      );
      // Each tile is a render of the real renderer's markup.
      const tiles = gallery.locator(".section-gallery-thumb iframe");
      assert.equal(await tiles.count(), 8);
      await gallery
        .locator('iframe[title="Projects"]')
        .contentFrame()
        .locator('[data-component="projects"]')
        .waitFor();
      await page.screenshot({ path: join(evidence, "section-gallery.png") });
      await page.keyboard.press("Escape");
      await gallery.waitFor({ state: "hidden" });
      assert.equal(
        await sections
          .getByRole("button", { name: "Add section", exact: true })
          .first()
          .evaluate((node) => node === document.activeElement),
        true,
      );
      const before = await outlineOrder(page);
      await flush();
      assert.deepEqual(
        (await stored()).components.map((item) => item.id),
        before,
      );
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await displayed();
      assert.deepEqual(await outlineOrder(page), before);
      await frame().locator(`[data-component-id="${before[0]}"]`).waitFor();
    },
  );
  await run("canvas, outline and keyboard share one selection", async () => {
    const page = await empty();
    await addSection(page, "Text section");
    await page.getByLabel("Section title", { exact: true }).fill("My story");
    await addSection(page, "Projects");
    const [story, projects] = await outlineOrder(page);
    // Added sections are selected everywhere.
    assert.equal(await currentRow(), "Projects");
    await frame().waitForFunction(
      (id) =>
        document
          .querySelector(`[data-component-id="${id}"]`)
          ?.hasAttribute("data-editor-selected"),
      projects,
    );
    // Canvas to outline and panel.
    await frame()
      .locator(`[data-component-id="${story}"]`)
      .click({ position: { x: 12, y: 12 } });
    await page.waitForFunction(
      () =>
        document
          .querySelector('.page-outline [aria-current="true"]')
          ?.getAttribute("aria-label") === "My story",
    );
    assert.equal(
      await page.getByLabel("Section title", { exact: true }).inputValue(),
      "My story",
    );
    // Outline to canvas.
    await (await outline(page))
      .getByRole("button", { name: /^Profile\b/ })
      .click();
    await frame().waitForFunction(() =>
      document
        .querySelector("[data-component=profile]")
        ?.hasAttribute("data-editor-selected"),
    );
    assert.deepEqual(await selectedInFrame(), ["profile"]);
    // Arrow keys on the outline move the selection; the canvas follows.
    await page.keyboard.press("ArrowDown");
    assert.equal(await currentRow(), "My story");
    await frame().waitForFunction(
      (id) =>
        document
          .querySelector(`[data-component-id="${id}"]`)
          ?.hasAttribute("data-editor-selected"),
      story,
    );
    // Keyboard selection on the canvas reaches the outline.
    await frame().locator(`[data-component-id="${projects}"]`).focus();
    await frame().locator(`[data-component-id="${projects}"]`).press("Enter");
    await page.waitForFunction(
      () =>
        document
          .querySelector('.page-outline [aria-current="true"]')
          ?.getAttribute("aria-label") === "Projects",
    );
    // Hover shows a dashed outline and tag on another section.
    await frame()
      .locator("[data-component=profile]")
      .hover({ position: { x: 20, y: 20 } });
    await frame().waitForFunction(
      () =>
        !document.querySelector('.hw-outline-box[data-state="hover"]')?.hidden,
    );
    await page.screenshot({ path: join(evidence, "editor-shell.png") });
    // The top bar's scheme toggle and the preview's own toggle stay in step.
    const scheme = page.getByRole("button", { name: "Dark preview" });
    await scheme.click();
    await frame().waitForFunction(
      () => document.documentElement.dataset.colorMode === "dark",
    );
    assert.equal(await scheme.getAttribute("aria-pressed"), "true");
    await frame().locator("[data-theme-toggle]").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Dark preview"]')
          ?.getAttribute("aria-pressed") === "false",
    );
    assert.equal(
      await frame().evaluate(() => document.documentElement.dataset.colorMode),
      "light",
    );
  });
  await run(
    "sections move by keyboard, drag and canvas actions, and removal asks first",
    async () => {
      const page = await empty();
      await addSection(page, "Text section");
      await page.getByLabel("Section title", { exact: true }).fill("My story");
      await addSection(page, "Projects");
      const before = await outlineOrder(page);
      const sections = await outline(page);
      // Alt with an arrow key on an outline row.
      await sections
        .getByRole("button", { name: "Projects", exact: true })
        .press("Alt+ArrowUp");
      assert.deepEqual(await outlineOrder(page), [before[1], before[0]]);
      assert.equal(
        await sections
          .getByRole("button", { name: "Projects", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      // Pointer drag of a row.
      const source = await sections
        .getByRole("button", { name: "Projects", exact: true })
        .boundingBox();
      const target = await sections
        .getByRole("button", { name: "My story", exact: true })
        .boundingBox();
      assert.ok(source && target);
      await page.mouse.move(source.x + 40, source.y + 20);
      await page.mouse.down();
      await page.mouse.move(target.x + 40, target.y + 40, { steps: 15 });
      await page.mouse.up();
      assert.deepEqual(await outlineOrder(page), before);
      // dnd-kit briefly suppresses clicks after a pointer drag.
      await page.waitForTimeout(100);
      // The selected section's canvas actions.
      await sections
        .getByRole("button", { name: "Projects", exact: true })
        .click();
      const toolbar = frame().getByRole("toolbar", {
        name: "Projects actions",
      });
      await toolbar.waitFor();
      assert.equal(
        await toolbar
          .getByRole("button", { name: "Move Projects down" })
          .isDisabled(),
        true,
      );
      await toolbar.getByRole("button", { name: "Move Projects up" }).click();
      await page.waitForFunction(
        (id) =>
          document.querySelector(".page-outline-sections [data-order-id]")
            ?.dataset.orderId === id,
        before[1],
      );
      // Alt with an arrow key on a focused canvas section.
      await frame()
        .locator(`[data-component-id="${before[1]}"]`)
        .press("Alt+ArrowDown");
      await page.waitForFunction(
        (id) =>
          document.querySelector(".page-outline-sections [data-order-id]")
            ?.dataset.orderId === id,
        before[0],
      );
      await flush();
      assert.deepEqual(
        (await stored()).components.map((item) => item.id),
        before,
      );
      // Removal from the canvas asks first; Cancel changes nothing.
      await sections
        .getByRole("button", { name: "My story", exact: true })
        .click();
      await frame()
        .getByRole("toolbar", { name: "My story actions" })
        .getByRole("button", { name: "Remove My story" })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.deepEqual(await outlineOrder(page), before);
      // Delete on an outline row asks too; confirming removes the section and
      // selects the profile.
      await removeSection(page, "My story");
      await page
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await flush();
      assert.deepEqual(
        (await stored()).components.map((item) => item.id),
        [before[1]],
      );
      assert.equal(
        await (await outline(page))
          .getByRole("button", { name: /^Profile\b/ })
          .getAttribute("aria-current"),
        "true",
      );
      assert.deepEqual(await selectedInFrame(), ["profile"]);
    },
  );
  await run(
    "on a phone the preview comes first, a tapped section opens the dock and editors open as sheets",
    async () => {
      const page = await empty();
      await addSection(page, "Text section");
      await page.getByLabel("Section title", { exact: true }).fill("My story");
      await addSection(page, "Projects");
      const before = await outlineOrder(page);
      for (const width of [360, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForFunction(
          () =>
            document.querySelector("main.owner-editor")?.dataset.layout ===
            "compact",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.equal(
          await page.getByRole("region", { name: "Page" }).count(),
          0,
        );
        assert.equal(
          await page.getByRole("button", { name: "View preview" }).count(),
          0,
        );
        await page.screenshot({
          path: join(evidence, `editor-compact-${width}.png`),
        });
      }
      // Tap a section on the canvas: the dock offers its actions.
      await frame()
        .locator(`[data-component-id="${before[1]}"]`)
        .click({ position: { x: 12, y: 12 } });
      const dock = page.getByRole("toolbar", { name: "Projects actions" });
      await dock.waitFor();
      assert.equal(
        await frame()
          .getByRole("toolbar", { name: "Projects actions" })
          .isVisible(),
        false,
      );
      // The outline is closed on a phone, so the order is read from the canvas.
      const canvasOrder = (expected) =>
        frame().waitForFunction(
          (ids) =>
            [...document.querySelectorAll("[data-component-id]")]
              .map((node) => node.dataset.componentId)
              .join() === ids.join(),
          expected,
          { timeout: 10000 },
        );
      await dock.getByRole("button", { name: "Move Projects up" }).click();
      await canvasOrder([before[1], before[0]]);
      await dock.getByRole("button", { name: "Remove Projects" }).click();
      await page.keyboard.press("Escape");
      await canvasOrder([before[1], before[0]]);
      // Edit opens the section's editor in a sheet over the preview.
      await dock.getByRole("button", { name: "Edit", exact: true }).click();
      const sheet = page.getByRole("region", { name: "Build", exact: true });
      await sheet.getByRole("button", { name: "Add project" }).waitFor();
      assert.equal(
        await page.locator(".editor-stage").evaluate((node) => node.inert),
        true,
      );
      await page.screenshot({
        path: join(evidence, "editor-compact-edit.png"),
      });
      // Back shows the page outline in the same sheet.
      await sheet.getByRole("button", { name: "Back to page" }).click();
      await sheet.getByRole("region", { name: "Page" }).waitFor();
      await sheet
        .getByRole("button", { name: "My story", exact: true })
        .click();
      assert.equal(
        await sheet.getByLabel("Section title", { exact: true }).inputValue(),
        "My story",
      );
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "hidden" });
      // Closing the actions brings back Build, Style and Share.
      await page
        .getByRole("toolbar", { name: "My story actions" })
        .getByRole("button", { name: "Close actions" })
        .click();
      await page
        .getByRole("navigation", { name: "Editor" })
        .getByRole("button", { name: "Style", exact: true })
        .click();
      const style = page.getByRole("region", { name: "Style", exact: true });
      await style.getByRole("region", { name: "Customization" }).waitFor();
      await style.getByRole("button", { name: "Close", exact: true }).click();
      await page.setViewportSize({ width: 1500, height: 1000 });
    },
  );
  await run(
    "entry and category ordering save stable identities and graph removal explains withdrawal",
    async () => {
      await boot();
      const page = getPage();
      const draft = await page.evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      draft.samples = {};
      draft.components = [
        {
          id: "skills-order",
          type: "skills",
          version: 1,
          data: {
            categories: [
              { id: "c1", name: "Languages" },
              { id: "c2", name: "Tools" },
            ],
            entries: [
              { id: "e1", name: "TypeScript", categoryId: "c1" },
              { id: "e2", name: "Git", categoryId: "c2" },
            ],
          },
        },
        {
          id: "private-graph",
          type: "github",
          version: 1,
          data: { username: "alice", includePrivate: true },
        },
      ];
      await boot(draft);
      const sections = await outline(getPage());
      await sections
        .getByRole("button", { name: "Skills and technologies", exact: true })
        .click();
      await getPage()
        .getByRole("button", { name: "Move Git up", exact: true })
        .click();
      await getPage()
        .getByRole("button", { name: "Move Tools up", exact: true })
        .click();
      await flush();
      const saved = (await stored()).components[0].data;
      assert.deepEqual(
        saved.entries.map((item) => item.id),
        ["e2", "e1"],
      );
      assert.deepEqual(
        saved.categories.map((item) => item.id),
        ["c2", "c1"],
      );
      assert.equal(saved.entries[0].categoryId, "c2");
      await removeSection(getPage(), "GitHub activity");
      // Removal explains the immediate private-access withdrawal (Phase 41).
      await getPage()
        .getByRole("dialog")
        .getByText("also removes private activity access now")
        .waitFor();
      assert.equal(
        await getPage()
          .getByRole("button", { name: "Remove section", exact: true })
          .isDisabled(),
        false,
      );
      await getPage()
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.equal(
        (await stored()).components.some((item) => item.type === "github"),
        true,
      );
    },
  );
}
