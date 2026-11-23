import assert from "node:assert/strict";
import { join } from "node:path";
import { addSection, openChecklist, openPanel } from "./shell.mjs";

function parse(page, html) {
  return page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const links = (root) =>
      [...(root?.querySelectorAll("a") ?? [])].map((link) => ({
        text: link.textContent,
        href: link.getAttribute("href"),
      }));
    return {
      sections: [...doc.querySelectorAll("[data-component-id]")].map((node) =>
        node.getAttribute("data-component"),
      ),
      profile: links(doc.querySelector(".pf-profile")),
      social: links(doc.querySelector('[data-component="social-links"]')),
    };
  }, html);
}

export async function checkSocialLinksJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  evidence,
}) {
  await run(
    "social links component publishes shared links, ordering and removal",
    async () => {
      await boot();
      const draft = await getPage().evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      Object.assign(draft, {
        components: [],
        samples: {},
        seo: {},
        links: [
          {
            id: "website",
            kind: "website",
            label: "My website",
            value: "https://example.com/first",
            showInProfile: true,
            showInSocialComponent: true,
          },
          {
            id: "profile-only",
            kind: "website",
            label: "Profile only",
            value: "https://example.com/profile-only",
            showInProfile: true,
            showInSocialComponent: false,
          },
        ],
        appearance: { themeId: "leaf", fontId: "dm-sans", colorMode: "system" },
      });
      draft.profile = {
        name: "Links owner",
        bio: "I share links in two places.",
        faceReveal: { enabled: false },
      };
      await boot(draft);
      const page = getPage();
      const checklist = () => openChecklist(page);
      const image = Buffer.from(
        await page.evaluate(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          canvas.getContext("2d").fillRect(0, 0, 640, 360);
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }),
      );
      for (const purpose of ["avatar", "banner"]) {
        await page
          .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`))
          .setInputFiles({
            name: "owner.png",
            mimeType: "image/png",
            buffer: image,
          });
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
      await openPanel(page, "Share");
      await page.getByLabel("Address name").fill("links-site");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      await openPanel(page, "Build");
      const site = "https://links-site.hasaweb.site";
      async function read(path = "/") {
        const response = await authority(
          "/__fixture/public",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: `${site}${path}`, method: "GET" }),
          },
          "none",
        );
        return {
          status: response.status,
          ...(await parse(page, await response.text())),
        };
      }
      const flush = () =>
        page.evaluate(() =>
          window.editorFixture.recovery.store
            .getState()
            .controller.flushValid(),
        );
      async function publish() {
        await flush();
        await (await checklist())
          .getByRole("button", { name: /^(Retry )?Publish$/ })
          .click();
        await (await checklist())
          .getByText("Publication complete.", { exact: true })
          .waitFor({ timeout: 120000 });
      }
      const storedLinks = async () =>
        JSON.parse(
          (
            await sql(
              "SELECT json_extract(draft,'$.links') links FROM portfolio WHERE user_id='draft-alice'",
            )
          )[0].links,
        );
      const sections = page.getByRole("region", {
        name: "Page",
        exact: true,
      });
      const control = page.getByRole("region", {
        name: "Social and contact links",
        exact: true,
      });
      const entry = (id) => control.locator(`[data-link-id="${id}"]`);

      // Add the optional component from the picker; no link is re-entered.
      await addSection(page, "Social links");
      await sections
        .getByRole("button", { name: "Social links", exact: true })
        .click();
      await control.waitFor();
      assert.equal((await storedLinks()).length, 2);

      await publish();
      let home = await read();
      assert.equal(home.status, 200);
      assert.deepEqual(home.sections, ["social-links"]);
      assert.deepEqual(
        home.profile.map((link) => link.href),
        ["https://example.com/first", "https://example.com/profile-only"],
      );
      assert.deepEqual(home.social, [
        { text: "My website", href: "https://example.com/first" },
      ]);

      // One edit of the shared record updates both placements after Publish.
      await entry("website")
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.com/updated");
      await flush();
      const links = await storedLinks();
      assert.equal(links.length, 2);
      assert.equal(links[0].value, "https://example.com/updated");
      // Draft changes stay private until Publish.
      assert.equal((await read()).social[0].href, "https://example.com/first");
      await publish();
      home = await read();
      assert.equal(home.profile[0].href, "https://example.com/updated");
      assert.deepEqual(home.social, [
        { text: "My website", href: "https://example.com/updated" },
      ]);
      assert.equal(
        home.profile.filter((link) => link.text === "My website").length,
        1,
      );

      // Placements are independent: add the second link to the component and
      // remove the first from it. Profile placement is unchanged.
      await entry("profile-only")
        .getByLabel("Show in social links component", { exact: true })
        .check();
      await entry("website")
        .getByLabel("Show in social links component", { exact: true })
        .uncheck();
      await publish();
      home = await read();
      assert.deepEqual(
        home.profile.map((link) => link.text),
        ["My website", "Profile only"],
      );
      assert.deepEqual(
        home.social.map((link) => link.text),
        ["Profile only"],
      );

      // Shared order drives both placements.
      await entry("profile-only")
        .getByRole("button", { name: "Move up", exact: true })
        .click();
      await publish();
      home = await read();
      assert.deepEqual(
        home.profile.map((link) => link.text),
        ["Profile only", "My website"],
      );

      // A component with no selected link blocks publication.
      await entry("profile-only")
        .getByLabel("Show in social links component", { exact: true })
        .uncheck();
      await flush();
      await (await checklist())
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await (await checklist())
        .getByRole("button", {
          name: "Complete your profile link",
          exact: true,
        })
        .waitFor({ timeout: 60000 });
      assert.equal(
        await (await checklist()).getByText("Publication complete.").count(),
        0,
      );
      assert.deepEqual(
        (await read()).social.map((link) => link.text),
        ["Profile only"],
      );

      // Confirmed removal keeps the shared links and removes the section.
      await sections
        .getByRole("button", { name: "Social links", exact: true })
        .press("Delete");
      await page
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await flush();
      assert.equal((await storedLinks()).length, 2);
      await publish();
      home = await read();
      assert.deepEqual(home.sections, []);
      assert.deepEqual(
        home.profile.map((link) => link.text),
        ["Profile only", "My website"],
      );
      await page.screenshot({
        path: join(evidence, "social-links-published.png"),
        fullPage: true,
      });
    },
  );
}
