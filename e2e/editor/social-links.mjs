import assert from "node:assert/strict";
import { join } from "node:path";
import {
  linkFields,
  linkRow,
  linksRegion,
  openSection,
  pasteLink,
  resize,
  setLinkShown,
} from "./shell.mjs";

export async function checkSocialLinks({
  getPage,
  context,
  boot,
  displayed,
  frame,
  sql,
  run,
  evidence,
  browserOrigin,
}) {
  const control = () => linksRegion(getPage());
  const entries = () => control().locator("[data-link-id]");
  const flush = () =>
    getPage().evaluate(() =>
      window.editorFixture.recovery.store.getState().controller.flushValid(),
    );
  async function clean({ social = false } = {}) {
    await boot();
    const draft = await getPage().evaluate(() =>
      structuredClone(
        window.editorFixture.recovery.store
          .getState()
          .controller.store.getState().working,
      ),
    );
    draft.links = [];
    if (!social)
      draft.components = draft.components.filter(
        (component) => component.type !== "social-links",
      );
    await boot(draft);
    return getPage();
  }
  async function storedLinks() {
    return JSON.parse(
      (
        await sql(
          "SELECT json_extract(draft,'$.links') links FROM portfolio WHERE user_id='draft-alice'",
        )
      )[0].links,
    );
  }
  await run(
    "social links private account email suggestion authority",
    async () => {
      await clean();
      const ordinary = await context.request.get(`${browserOrigin}/api/owner`);
      const ordinaryBody = await ordinary.json();
      assert.equal(ordinary.status(), 200);
      assert.equal("emailSuggestion" in ordinaryBody, false);
      assert.equal("email" in ordinaryBody.user, false);
      const path = `${browserOrigin}/api/owner?include=email-suggestion`;
      for (const [headers, status] of [
        [{}, 400],
        [{ "X-Expected-Owner-Id": "draft-bob" }, 409],
        [{ "X-Expected-Owner-Id": "draft-alice" }, 200],
      ]) {
        const response = await context.request.get(path, { headers });
        assert.equal(response.status(), status);
        assert.match(response.headers()["cache-control"], /private.*no-store/);
        const body = await response.json();
        if (status === 200) {
          assert.equal(body.emailSuggestion, "alice@draft.example.test");
          assert.deepEqual(Object.keys(body).sort(), [
            "emailSuggestion",
            "portfolio",
            "user",
          ]);
        } else assert.equal("emailSuggestion" in body, false);
      }
      await sql("DELETE FROM session WHERE id='draft-session-revoked'");
      for (const [session, status] of [
        ["bob", 409],
        ["none", 401],
        ["expired", 401],
        ["deleting", 401],
        ["revoked", 401],
      ]) {
        await context.addCookies([
          { name: "fixture-session", value: session, url: browserOrigin },
        ]);
        const response = await context.request.get(path, {
          headers: { "X-Expected-Owner-Id": "draft-alice" },
        });
        assert.equal(response.status(), status);
        assert.equal(
          "emailSuggestion" in ((await response.json()) ?? {}),
          false,
        );
      }
    },
  );
  await run(
    "social links shared placements, stable ordering and raw recovery",
    async () => {
      const page = await clean({ social: true });
      // A pasted address becomes a profile link with a default label.
      await pasteLink(page, "example.com/work");
      await entries().first().waitFor();
      await flush();
      const [work] = await storedLinks();
      assert.deepEqual(
        { ...work, id: undefined },
        {
          id: undefined,
          kind: "website",
          label: "Website",
          value: "https://example.com/work",
          showInProfile: true,
          showInSocialComponent: false,
        },
      );
      await displayed();
      await frame()
        .locator('.pf-profile a[href="https://example.com/work"]')
        .waitFor();
      // The Social links section shows the same link with its own eye.
      await openSection(page, "Social links");
      assert.equal(await entries().count(), 1);
      assert.equal(
        await linkRow(page, work.id)
          .locator(".links-editor-eye")
          .getAttribute("aria-pressed"),
        "false",
      );
      await setLinkShown(page, work.id, true);
      await frame().waitForFunction(
        () =>
          document.querySelectorAll('a[href="https://example.com/work"]')
            .length === 2,
      );
      // One edit of the shared link updates both placements.
      const fields = await linkFields(page, work.id);
      await fields.getByLabel("Label", { exact: true }).fill("My work");
      await fields
        .getByLabel("Web address", { exact: true })
        .fill("https://example.com/updated");
      await frame().waitForFunction(() => {
        const links = [
          ...document.querySelectorAll('a[href="https://example.com/updated"]'),
        ];
        return (
          links.length === 2 &&
          links.every((link) => link.textContent === "My work")
        );
      });
      await page.keyboard.press("Escape");
      // A link pasted here starts in this placement only.
      await pasteLink(page, "mailto:hello@example.com");
      await entries().nth(1).waitFor();
      await flush();
      const [, hello] = await storedLinks();
      assert.equal(hello.kind, "email");
      assert.equal(hello.label, "Email");
      assert.equal(hello.showInProfile, false);
      assert.equal(hello.showInSocialComponent, true);
      // Alt with an arrow key moves a row and keeps its focus.
      const helloButton = linkRow(page, hello.id).locator(".links-editor-open");
      await helloButton.press("Alt+ArrowUp");
      await flush();
      assert.deepEqual(
        (await storedLinks()).map((link) => link.id),
        [hello.id, work.id],
      );
      assert.equal(
        await helloButton.evaluate((node) => node === document.activeElement),
        true,
      );
      // The grip drags a row with a pointer.
      const grip = await linkRow(page, work.id)
        .locator(".links-editor-grip")
        .boundingBox();
      const target = await linkRow(page, hello.id).boundingBox();
      assert.ok(grip && target);
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 20, target.y + 4, { steps: 15 });
      await page.mouse.up();
      await flush();
      assert.deepEqual(
        (await storedLinks()).map((link) => link.id),
        [work.id, hello.id],
      );
      await page.waitForTimeout(100);
      // Unfinished input stays local and survives a reload.
      const email = (await linkFields(page, hello.id)).getByLabel(
        "Email address",
        { exact: true },
      );
      await email.fill("unfinished@");
      assert.equal(await email.getAttribute("aria-invalid"), "true");
      assert.equal((await flush()).hasLocalOnlyInput, true);
      assert.equal((await storedLinks())[1].value, "hello@example.com");
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("button", { name: "Continue preserved edits", exact: true })
        .click();
      await entries().first().waitFor();
      assert.equal(
        await (await linkFields(page, hello.id))
          .getByLabel("Email address", { exact: true })
          .inputValue(),
        "unfinished@",
      );
      await (await linkFields(page, hello.id))
        .getByLabel("Email address", { exact: true })
        .fill("work@example.com");
      await flush();
      await frame()
        .locator('a[href="mailto:work@example.com"]')
        .first()
        .waitFor();
      // Hiding a link in the profile leaves the stored link alone.
      await openSection(page, "Profile");
      await setLinkShown(page, work.id, false);
      await flush();
      await frame().waitForFunction(
        () =>
          document.querySelectorAll('a[href="https://example.com/updated"]')
            .length === 1,
      );
      assert.equal((await storedLinks()).length, 2);
      assert.doesNotMatch(
        await frame().content(),
        /recipient-1|alice@draft\.example\.test|emailSuggestion/,
      );
    },
  );
  await run(
    "social links deliberate public email acceptance, removal and mobile keyboard",
    async () => {
      const page = await clean();
      const suggest = () =>
        control().getByRole("button", {
          name: "Use my account email",
          exact: true,
        });
      const accept = () =>
        control().getByRole("button", {
          name: "Add as public link",
          exact: true,
        });
      await suggest().click();
      await accept().waitFor();
      assert.match(
        await control().innerText(),
        /Visitors see this address after you publish/,
      );
      assert.deepEqual(await storedLinks(), []);
      assert.doesNotMatch(
        await frame().content(),
        /alice@draft\.example\.test/,
      );
      await control()
        .getByRole("button", { name: "Dismiss account email", exact: true })
        .click();
      assert.equal(await entries().count(), 0);
      await suggest().click();
      await accept().click();
      await flush();
      const accepted = await storedLinks();
      assert.equal(accepted.length, 1);
      assert.equal(accepted[0].value, "alice@draft.example.test");
      assert.equal(accepted[0].showInProfile, true);
      await frame()
        .locator('a[href="mailto:alice@draft.example.test"]')
        .waitFor();
      await suggest().click();
      await accept().click();
      await flush();
      assert.deepEqual(await storedLinks(), accepted);
      await resize(page, { width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await openSection(page, "Profile");
      const fields = await linkFields(page, accepted[0].id);
      const label = fields.getByLabel("Label", { exact: true });
      await label.focus();
      await label.press("Tab");
      assert.equal(
        await fields
          .getByLabel("Email address", { exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.screenshot({
        path: join(evidence, "social-links-mobile.png"),
        fullPage: true,
      });
      await fields
        .getByRole("button", { name: "Remove link", exact: true })
        .click();
      await flush();
      assert.deepEqual(await storedLinks(), []);
      assert.equal(
        await control()
          .getByLabel("Add a link", { exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await resize(page, { width: 1500, height: 1000 });
    },
  );
  await run(
    "social links preserve edits at the complete draft byte limit",
    async () => {
      await clean();
      const full = await getPage().evaluate(() => {
        const draft = structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        );
        draft.links = [
          {
            id: "maximum-link",
            kind: "website",
            label: "My website",
            value: "https://example.com",
            showInProfile: true,
            showInSocialComponent: true,
          },
        ];
        draft.profile.bio = "";
        const size = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
        draft.profile.bio = "x".repeat(1_048_576 - size);
        return draft;
      });
      await boot(full);
      const page = getPage();
      await pasteLink(page, "https://example.com/another");
      await control()
        .getByText(/This draft cannot fit another link/)
        .waitFor();
      assert.equal(await entries().count(), 1);
      const fields = await linkFields(page, "maximum-link");
      const label = fields.getByLabel("Label", { exact: true });
      await label.fill("My longer website label");
      assert.equal(await label.getAttribute("aria-invalid"), "true");
      assert.equal(await label.inputValue(), "My longer website label");
      const destination = fields.getByLabel("Web address", { exact: true });
      await destination.fill("https://example.com/a-longer-destination");
      assert.equal(await destination.getAttribute("aria-invalid"), "true");
      await fields
        .getByText(/Unfinished input stays in this browser/)
        .first()
        .waitFor();
      await page.keyboard.press("Escape");
      await setLinkShown(page, "maximum-link", false);
      assert.equal((await flush()).hasLocalOnlyInput, true);
      assert.deepEqual(await storedLinks(), full.links);
      await page
        .getByRole("textbox", { name: "Bio", exact: true })
        .fill("Room for links again.");
      const recovered = await linkFields(page, "maximum-link");
      await recovered
        .getByLabel("Label", { exact: true })
        .fill("My recovered website label");
      assert.equal(
        await recovered
          .getByLabel("Label", { exact: true })
          .getAttribute("aria-invalid"),
        null,
      );
      await recovered
        .getByLabel("Web address", { exact: true })
        .fill("https://example.com/recovered");
      await page.keyboard.press("Escape");
      await setLinkShown(page, "maximum-link", true);
      await setLinkShown(page, "maximum-link", false);
      await flush();
      const links = await storedLinks();
      assert.equal(links[0].id, "maximum-link");
      assert.equal(links[0].value, "https://example.com/recovered");
      assert.equal(links[0].label, "My recovered website label");
      assert.equal(links[0].showInProfile, false);
      await pasteLink(page, "https://example.com/another");
      await entries().nth(1).waitFor();
      assert.equal(await entries().count(), 2);
    },
  );
}
