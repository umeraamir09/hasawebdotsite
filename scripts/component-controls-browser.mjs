import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkComponentControls({
  getPage,
  boot,
  frame,
  displayed,
  sql,
  run,
  evidence,
}) {
  const sections = () =>
    getPage().getByRole("region", { name: "Portfolio sections", exact: true });
  const order = () =>
    sections()
      .locator("[data-order-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.orderId));
  const flush = () =>
    getPage().evaluate(() =>
      window.editorFixture.recovery.store.getState().controller.flushValid(),
    );
  const stored = async () =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'"))[0]
        .draft,
    );
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
  async function add(title) {
    await sections()
      .getByRole("button", { name: "Add component", exact: true })
      .click();
    await getPage()
      .getByRole("button", { name: `Add ${title}`, exact: true })
      .click();
  }
  await run(
    "component picker limits, multiple text sections, keyboard ordering and durable reload",
    async () => {
      const page = await empty();
      await add("Text section");
      await page
        .getByLabel("Section title", { exact: true })
        .fill("First story");
      await add("Text section");
      await page
        .getByLabel("Section title", { exact: true })
        .fill("Second story");
      await add("Skills and technologies");
      await sections()
        .getByRole("button", { name: "Add component", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Add Skills and technologies",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: /Education/ }).count(),
        0,
      );
      await sections()
        .getByRole("button", { name: "Add component", exact: true })
        .click();
      const before = await order();
      await sections()
        .getByRole("button", { name: "Move Second story up", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await order(), [before[1], before[0], before[2]]);
      const handle = sections().getByRole("button", {
        name: "Drag Second story",
        exact: true,
      });
      await handle.focus();
      await page.keyboard.press("Space");
      await page.waitForFunction(() =>
        document.querySelector('.editor-drag-handle[aria-pressed="true"]'),
      );
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[id^="DndLiveRegion"]')].some((node) =>
          node.textContent.includes("was moved over droppable area"),
        ),
      );
      await page.keyboard.press("Space");
      await page.waitForFunction(
        () =>
          !document.querySelector('.editor-drag-handle[aria-pressed="true"]'),
      );
      assert.deepEqual(await order(), before);
      await flush();
      assert.deepEqual(
        (await stored()).components.map((item) => item.id),
        before,
      );
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await displayed();
      assert.deepEqual(await order(), before);
      assert.equal(
        await sections().getByRole("button").first().innerText(),
        "Profile",
      );
      await frame().locator(`[data-component-id="${before[0]}"]`).waitFor();
    },
  );
  await run(
    "component drag, cancellation, mobile ordering and confirmed removal preserve unrelated data",
    async () => {
      const page = await empty();
      await add("Text section");
      await page.getByLabel("Section title", { exact: true }).fill("My story");
      await add("Projects");
      const before = await order();
      const source = await sections()
        .getByRole("button", { name: "Drag Projects", exact: true })
        .boundingBox();
      const target = await sections()
        .getByRole("button", { name: "Drag My story", exact: true })
        .boundingBox();
      assert.ok(source && target);
      await page.mouse.move(source.x + 20, source.y + 20);
      await page.mouse.down();
      await page.mouse.move(target.x + 20, target.y + 20, { steps: 15 });
      await page.mouse.up();
      assert.deepEqual(await order(), [before[1], before[0]]);
      await sections()
        .getByRole("button", { name: "Remove My story", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.deepEqual(await order(), [before[1], before[0]]);
      assert.equal(
        await sections()
          .getByRole("button", { name: "Remove My story", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await sections()
        .getByRole("button", { name: "Move My story up", exact: true })
        .click();
      assert.deepEqual(await order(), before);
      await sections()
        .getByRole("button", { name: "Remove My story", exact: true })
        .click();
      await page.keyboard.press("Escape");
      assert.deepEqual(await order(), before);
      await sections()
        .getByRole("button", { name: "My story", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Section title", { exact: true }).inputValue(),
        "My story",
      );
      await page.screenshot({
        path: join(evidence, "component-controls-mobile.png"),
        fullPage: true,
      });
      await sections()
        .getByRole("button", { name: "Remove My story", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await flush();
      assert.deepEqual(
        (await stored()).components.map((item) => item.id),
        [before[1]],
      );
      assert.equal(
        await sections()
          .getByRole("button", { name: "Profile", exact: true })
          .getAttribute("aria-current"),
        "true",
      );
      await page.setViewportSize({ width: 1500, height: 1000 });
    },
  );
  await run(
    "component entry and category ordering save stable identities and private graph removal is gated",
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
      await sections()
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
      await sections()
        .getByRole("button", { name: "Remove GitHub activity", exact: true })
        .click();
      assert.equal(
        await getPage()
          .getByRole("button", { name: "Remove section", exact: true })
          .isDisabled(),
        true,
      );
      await getPage()
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
    },
  );
}
