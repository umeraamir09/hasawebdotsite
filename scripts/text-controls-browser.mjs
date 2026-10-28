import assert from "node:assert/strict";
import { join } from "node:path";

const markup =
  '<h2>How I work</h2><p>A careful process <a href="https://example.com/process">Read more</a>.</p><ul><li><p>Listen first</p></li></ul><ol start="3"><li><p>Ship carefully</p></li></ol>';
const hostile =
  '<script>window.richTextExecuted=true</script><img src="/missing" onerror="window.richTextExecuted=true"><iframe srcdoc="<script>parent.richTextExecuted=true</script>"></iframe><p style="color:red" onclick="window.richTextExecuted=true"><a href="javascript:alert(1)">Unsafe destination</a></p>';

async function paste(page, html) {
  await page
    .getByRole("textbox", { name: "Section body", exact: true })
    .evaluate((node, html) => {
      node.focus();
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/html", html);
      clipboardData.setData("text/plain", "Pasted content");
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, html);
}

export async function preparePublishedText(page) {
  const sections = page.getByRole("region", {
    name: "Portfolio sections",
    exact: true,
  });
  await sections
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Text section", exact: true })
    .click();
  await page.getByLabel("Section title", { exact: true }).fill("My approach");
  await page
    .getByRole("textbox", { name: "Section body", exact: true })
    .click();
  await paste(page, markup + hostile);
  await page.evaluate(() =>
    window.editorFixture.recovery.store.getState().controller.flushValid(),
  );
  await sections.getByRole("button", { name: "Profile", exact: true }).click();
}

export async function assertPublishedText(page, html) {
  const content = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const section = doc.querySelector('[data-component="text"]');
    return {
      text: section?.textContent,
      heading: section?.querySelector(".pf-rich-text h3, .pf-richtext h3, h3")
        ?.textContent,
      lists: section?.querySelectorAll("ul li, ol li").length,
      start: section?.querySelector("ol")?.getAttribute("start"),
      href: section?.querySelector("a")?.getAttribute("href"),
      unsafe: section?.querySelectorAll(
        'script,iframe,img,[onclick],[style],a[href^="javascript:"]',
      ).length,
    };
  }, html);
  assert.match(content.text, /My approach/);
  assert.match(content.text, /How I work/);
  assert.equal(content.heading, "How I work");
  assert.equal(content.lists, 2);
  assert.equal(content.start, "3");
  assert.equal(content.href, "https://example.com/process");
  assert.equal(content.unsafe, 0);
}

export async function checkTextControls({
  getPage,
  boot,
  displayed,
  frame,
  sql,
  run,
  evidence,
}) {
  await run(
    "rich text formatting, hostile paste, safe links and saved reload",
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
      await preparePublishedText(page);
      const saved = JSON.parse(
        (
          await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
        )[0].draft,
      );
      const body = saved.components[0].data.body;
      assert.ok(body.content.some((node) => node.type === "heading"));
      assert.ok(
        body.content.some(
          (node) => node.type === "orderedList" && node.attrs.start === 3,
        ),
      );
      assert.doesNotMatch(
        JSON.stringify(body),
        /javascript:|onclick|srcdoc|"type":"script"/,
      );
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("region", { name: "Portfolio sections", exact: true })
        .getByRole("button", { name: "My approach", exact: true })
        .click();
      const input = page.getByRole("textbox", {
        name: "Section body",
        exact: true,
      });
      await input.locator("h2").waitFor();
      assert.equal(await input.locator("ol").getAttribute("start"), "3");
      await input.fill("x".repeat(1_048_576));
      const oversized = await page.evaluate(() =>
        window.editorFixture.recovery.store.getState().controller.flushValid(),
      );
      assert.equal(oversized.hasLocalOnlyInput, true);
      assert.equal((await input.innerText()).trim().length, 1_048_576);
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("button", { name: "Continue preserved edits", exact: true })
        .click();
      await page
        .getByRole("region", { name: "Portfolio sections", exact: true })
        .getByRole("button", { name: "My approach", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector(".rich-text-input")?.textContent.length ===
          1_048_576,
      );
      await input.fill("Linked words");
      await input.press("Control+a");
      await page
        .getByRole("button", { name: "Heading 3", exact: true })
        .click();
      await page
        .getByLabel("Link destination", { exact: true })
        .fill("javascript:alert(1)");
      await page
        .getByRole("button", { name: "Apply link", exact: true })
        .click();
      assert.equal(
        await page
          .getByLabel("Link destination", { exact: true })
          .getAttribute("aria-invalid"),
        "true",
      );
      await page
        .getByLabel("Link destination", { exact: true })
        .fill("mailto:owner@example.com");
      await page
        .getByRole("button", { name: "Apply link", exact: true })
        .click();
      assert.equal(
        await input.locator("a").getAttribute("href"),
        "mailto:owner@example.com",
      );
      await page
        .getByRole("button", { name: "Remove link", exact: true })
        .click();
      assert.equal(await input.locator("a").count(), 0);
      await page
        .getByRole("button", { name: "Paragraph", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Bullet list", exact: true })
        .click();
      await input.locator("ul li").waitFor();
      await page
        .getByRole("button", { name: "Bullet list", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Numbered list", exact: true })
        .click();
      await input.locator("ol li").waitFor();
      await page.evaluate(() =>
        window.editorFixture.recovery.store.getState().controller.flushValid(),
      );
      await displayed();
      assert.match(
        await frame().locator("[data-component-id]").innerText(),
        /Linked words/,
      );
      assert.equal(
        await page.evaluate(() => window.richTextExecuted),
        undefined,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: join(evidence, "text-controls-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1500, height: 1000 });
      const sections = page.getByRole("region", {
        name: "Portfolio sections",
        exact: true,
      });
      await sections
        .getByRole("button", { name: "Add component", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add Text section", exact: true })
        .click();
      await page
        .getByLabel("Section title", { exact: true })
        .fill("Second note");
      await input.fill("An independent body");
      await sections
        .getByRole("button", { name: "Move Second note up", exact: true })
        .click();
      await sections
        .getByRole("button", { name: "My approach", exact: true })
        .click();
      assert.match(await input.innerText(), /Linked words/);
      await sections
        .getByRole("button", { name: "Remove My approach", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.match(await input.innerText(), /Linked words/);
      await sections
        .getByRole("button", { name: "Remove My approach", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await page.evaluate(() =>
        window.editorFixture.recovery.store.getState().controller.flushValid(),
      );
      const final = JSON.parse(
        (
          await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
        )[0].draft,
      );
      assert.equal(final.components.length, 1);
      assert.equal(final.components[0].data.title, "Second note");
      assert.equal(
        final.components[0].data.body.content[0].content[0].text,
        "An independent body",
      );
    },
  );
}
