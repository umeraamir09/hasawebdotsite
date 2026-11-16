import assert from "node:assert/strict";
import { join } from "node:path";

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
  const control = () =>
    getPage().getByRole("region", { name: "Social and contact links" });
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
      await control()
        .getByRole("button", { name: "Add link", exact: true })
        .click();
      const first = entries().first();
      assert.equal(
        await first
          .getByLabel("Link label", { exact: true })
          .getAttribute("aria-invalid"),
        "true",
      );
      await first
        .getByText(
          "Add an understandable label, such as My website or Email.",
          { exact: true },
        )
        .waitFor();
      await first.getByLabel("Link label", { exact: true }).fill("My work");
      await first
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.com/work");
      await first
        .getByLabel("Show in social links component", { exact: true })
        .check();
      await flush();
      await displayed();
      await frame()
        .getByRole("link", { name: "My work", exact: true })
        .first()
        .waitFor();
      assert.equal(
        await frame()
          .getByRole("link", { name: "My work", exact: true })
          .count(),
        2,
      );
      const original = await storedLinks();
      assert.equal(original.length, 1);
      await first
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.com/updated");
      await frame().waitForFunction(
        () =>
          [
            ...document.querySelectorAll(
              'a[href="https://example.com/updated"]',
            ),
          ].length === 2,
      );
      await control()
        .getByRole("button", { name: "Add link", exact: true })
        .click();
      const second = entries().nth(1);
      await second.getByLabel("Link label", { exact: true }).fill("Say hello");
      await second
        .getByLabel("Link type", { exact: true })
        .selectOption("email");
      await second
        .getByLabel("Email address", { exact: true })
        .fill("hello@example.com");
      await second
        .getByRole("button", { name: "Move up", exact: true })
        .click();
      await flush();
      const reordered = await storedLinks();
      assert.equal(reordered[1].id, original[0].id);
      assert.equal(reordered[1].value, "https://example.com/updated");
      await frame()
        .locator('.pf-profile a[href="mailto:hello@example.com"]')
        .waitFor();
      const website = entries().nth(1);
      await website
        .getByLabel("Link type", { exact: true })
        .selectOption("email");
      await website
        .getByLabel("Email address", { exact: true })
        .fill("unfinished@");
      assert.equal((await flush()).hasLocalOnlyInput, true);
      assert.equal(
        (await storedLinks())[1].value,
        "https://example.com/updated",
      );
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page
        .getByRole("button", { name: "Continue preserved edits", exact: true })
        .click();
      await page.getByLabel("Email address", { exact: true }).nth(1).waitFor();
      assert.equal(
        await entries()
          .nth(1)
          .getByLabel("Email address", { exact: true })
          .inputValue(),
        "unfinished@",
      );
      assert.equal(
        await entries().nth(1).getAttribute("data-link-id"),
        original[0].id,
      );
      await entries()
        .nth(1)
        .getByRole("button", { name: "Move up", exact: true })
        .click();
      assert.equal(
        await entries()
          .first()
          .getByLabel("Email address", { exact: true })
          .inputValue(),
        "unfinished@",
      );
      await entries()
        .first()
        .getByLabel("Email address", { exact: true })
        .fill("work@example.com");
      await flush();
      await frame().waitForFunction(
        () =>
          [...document.querySelectorAll('a[href="mailto:work@example.com"]')]
            .length === 2,
      );
      await page
        .getByRole("region", { name: "Portfolio sections", exact: true })
        .getByRole("button", { name: "Social links", exact: true })
        .click();
      assert.equal(await entries().count(), 2);
      await entries()
        .first()
        .getByLabel("Link label", { exact: true })
        .fill("Work contact");
      await frame().waitForFunction(() => {
        const links = [
          ...document.querySelectorAll('a[href="mailto:work@example.com"]'),
        ];
        return (
          links.length === 2 &&
          links.every((link) => link.textContent === "Work contact")
        );
      });
      await entries()
        .first()
        .getByLabel("Show in profile", { exact: true })
        .uncheck();
      await flush();
      await frame().waitForFunction(
        () =>
          document.querySelectorAll('a[href="mailto:work@example.com"]')
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
      assert.match(await control().innerText(), /contact form alone/);
      assert.match(await control().innerText(), /Add at least one valid link/);
      await control()
        .getByRole("button", { name: "Suggest account email", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "Use email as public link", exact: true })
        .waitFor();
      assert.match(await control().innerText(), /public profile link/);
      assert.match(await control().innerText(), /private recipient/);
      assert.deepEqual(await storedLinks(), []);
      assert.doesNotMatch(
        await frame().content(),
        /alice@draft\.example\.test/,
      );
      await control()
        .getByRole("button", { name: "Dismiss suggestion", exact: true })
        .click();
      assert.equal(await entries().count(), 0);
      await control()
        .getByRole("button", { name: "Suggest account email", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "Use email as public link", exact: true })
        .click();
      await flush();
      const accepted = await storedLinks();
      assert.equal(accepted.length, 1);
      assert.equal(accepted[0].value, "alice@draft.example.test");
      assert.equal(accepted[0].showInProfile, true);
      await frame()
        .locator('a[href="mailto:alice@draft.example.test"]')
        .waitFor();
      await control()
        .getByRole("button", { name: "Suggest account email", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "Use email as public link", exact: true })
        .click();
      await flush();
      assert.deepEqual(await storedLinks(), accepted);
      const row = entries().first();
      await row
        .getByLabel("Show in social links component", { exact: true })
        .check();
      assert.match(await row.innerText(), /Add a Social links component/);
      await flush();
      const components = await page.evaluate(
        () =>
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working.components,
      );
      assert.equal(
        components.some((component) => component.type === "social-links"),
        false,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const label = row.getByLabel("Link label", { exact: true });
      await label.focus();
      await label.press("Tab");
      assert.equal(
        await row
          .getByLabel("Link type", { exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.screenshot({
        path: join(evidence, "social-links-mobile.png"),
        fullPage: true,
      });
      await row
        .getByRole("button", { name: "Remove link", exact: true })
        .click();
      await row.getByRole("button", { name: "Keep link", exact: true }).click();
      assert.equal(await entries().count(), 1);
      await row
        .getByRole("button", { name: "Remove link", exact: true })
        .click();
      await row
        .getByRole("button", { name: "Confirm remove", exact: true })
        .click();
      await flush();
      assert.deepEqual(await storedLinks(), []);
      await page.setViewportSize({ width: 1500, height: 1000 });
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
      await control()
        .getByRole("button", { name: "Add link", exact: true })
        .click();
      await control()
        .getByRole("status")
        .filter({ hasText: "Shorten text or remove unused content" })
        .waitFor();
      assert.equal(await entries().count(), 1);
      const entry = entries().first();
      const label = entry.getByLabel("Link label", { exact: true });
      await label.fill("My longer website label");
      const labelHelp = entry.getByText(
        /This label change does not fit in the draft/,
      );
      await labelHelp.waitFor();
      assert.equal(await label.getAttribute("aria-invalid"), "true");
      assert.equal(
        await label.getAttribute("aria-describedby"),
        await labelHelp.getAttribute("id"),
      );
      assert.equal(await label.inputValue(), "My longer website label");
      await entry
        .getByLabel("Link type", { exact: true })
        .selectOption("mastodon");
      await entry
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.com/a-longer-destination");
      await entry.getByText(/This change does not fit in the draft/).waitFor();
      assert.equal(
        await entry
          .getByLabel("Destination URL", { exact: true })
          .getAttribute("aria-invalid"),
        "true",
      );
      await entry.getByLabel("Show in profile", { exact: true }).uncheck();
      assert.equal(
        await entry.getByLabel("Show in profile", { exact: true }).isChecked(),
        false,
      );
      await entry
        .getByText(/This placement change stays in this browser/)
        .waitFor();
      assert.equal((await flush()).hasLocalOnlyInput, true);
      assert.deepEqual(await storedLinks(), full.links);
      assert.equal(
        await entry.getByLabel("Destination URL", { exact: true }).inputValue(),
        "https://example.com/a-longer-destination",
      );
      await page
        .getByRole("textbox", { name: "Bio", exact: true })
        .fill("Room for links again.");
      await label.fill("My recovered website label");
      assert.equal(await label.getAttribute("aria-invalid"), "false");
      assert.equal(await label.getAttribute("aria-describedby"), null);
      await entry
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.com/recovered");
      await entry.getByLabel("Show in profile", { exact: true }).check();
      await entry.getByLabel("Show in profile", { exact: true }).uncheck();
      await flush();
      const links = await storedLinks();
      assert.equal(links[0].id, "maximum-link");
      assert.equal(links[0].value, "https://example.com/recovered");
      assert.equal(links[0].label, "My recovered website label");
      assert.equal(links[0].kind, "mastodon");
      assert.equal(links[0].showInProfile, false);
      await control()
        .getByRole("button", { name: "Add link", exact: true })
        .click();
      assert.equal(await entries().count(), 2);
    },
  );
}
