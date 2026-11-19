import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const TITLE = 'Sharing owner · "Designer" <&>';
const DESCRIPTION = "Product design notes & experiments.";

// Phase 46: search and sharing overrides, the sharing preview, draft privacy
// and the metadata served on every published page type.
export async function checkSharingJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
}) {
  await run(
    "sharing overrides and preview use profile defaults, stay private, and publish into every page's metadata",
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
        appearance: { themeId: "leaf", fontId: "dm-sans", colorMode: "system" },
        links: [
          {
            id: "website",
            kind: "website",
            label: "My website",
            value: "https://example.com",
            showInProfile: true,
            showInSocialComponent: false,
          },
        ],
      });
      draft.profile = {
        name: "Sharing owner",
        bio: "I design calm tools.\nThey ship on time.",
        faceReveal: { enabled: false },
      };
      await boot(draft);
      const page = getPage();
      const checklist = page.getByRole("region", {
        name: "Publication checklist",
      });
      const image = Buffer.from(
        await page.evaluate(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          canvas.getContext("2d").fillRect(0, 0, 1280, 720);
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }),
      );
      async function upload(label, dialog, region) {
        await page.getByLabel(label).setInputFiles({
          name: "owner.png",
          mimeType: "image/png",
          buffer: image,
        });
        await page.getByRole("dialog", { name: dialog }).waitFor();
        await page
          .getByRole("button", { name: "Apply crop", exact: true })
          .click();
        await page
          .getByRole("region", { name: region, exact: true })
          .getByText("Upload complete. Your draft image is ready.")
          .waitFor();
      }
      await upload(
        /^(Upload|Replace) avatar$/,
        "Adjust avatar",
        "Avatar image",
      );
      await upload(
        /^(Upload|Replace) banner$/,
        "Adjust banner",
        "Banner image",
      );
      await page.getByLabel("Address name").fill("sharing-site");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();

      // A project with a case study gives a page-specific title to check.
      const sections = page.getByRole("region", {
        name: "Portfolio sections",
        exact: true,
      });
      await sections
        .getByRole("button", { name: "Add component", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add Projects", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .click();
      const project = page.locator("[data-project-id]").first();
      await project
        .getByLabel("Project title", { exact: true })
        .fill("Calm tools");
      await project
        .getByLabel("Summary", { exact: true })
        .fill("A quieter task list.");
      await project
        .getByRole("button", { name: "Add case study", exact: true })
        .click();
      await project
        .getByRole("textbox", { name: "Case study body", exact: true })
        .focus();
      await page.keyboard.type("How the task list got quieter.");

      const portfolioId = (
        await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
      )[0].id;
      const saved = async () => {
        await page.evaluate(() =>
          window.editorFixture.recovery.store
            .getState()
            .controller.flushValid(),
        );
        return JSON.parse(
          (
            await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId])
          )[0].draft,
        );
      };
      const bannerId = (await saved()).profile.banner.assetId;

      // Defaults: the card shows the name, the bio and the banner.
      await page.getByRole("button", { name: "Sharing", exact: true }).click();
      const panel = page.getByRole("region", {
        name: "Search and sharing",
        exact: true,
      });
      const card = panel.getByRole("figure", { name: "Sharing preview" });
      const titleInput = panel.getByLabel("Page title", { exact: true });
      const descriptionInput = panel.getByLabel("Description", { exact: true });
      const cardText = async () => ({
        address: await card.locator(".sharing-card-address").textContent(),
        title: await card.locator(".sharing-card-title").textContent(),
        description: await card
          .locator(".sharing-card-description")
          .textContent(),
        image: await card.locator("img").getAttribute("src"),
      });
      assert.equal(await titleInput.inputValue(), "");
      assert.equal(
        await titleInput.getAttribute("placeholder"),
        "Sharing owner",
      );
      assert.equal(await titleInput.getAttribute("maxlength"), "70");
      assert.equal(await descriptionInput.getAttribute("maxlength"), "160");
      assert.deepEqual(await cardText(), {
        address: "sharing-site.hasaweb.site",
        title: "Sharing owner",
        description: "I design calm tools. They ship on time.",
        image: `/api/assets/${bannerId}?purpose=banner`,
      });
      await card.locator("img").evaluate((img) =>
        img.complete && img.naturalWidth > 0
          ? null
          : new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
            }),
      );

      // Overrides update the card and save; clearing returns to the default.
      await titleInput.fill(TITLE);
      await descriptionInput.fill(DESCRIPTION);
      assert.equal(
        await card.locator(".sharing-card-title").textContent(),
        TITLE,
      );
      assert.deepEqual((await saved()).seo, {
        title: TITLE,
        description: DESCRIPTION,
      });
      await titleInput.fill("");
      assert.equal(
        await card.locator(".sharing-card-title").textContent(),
        "Sharing owner",
      );
      assert.deepEqual((await saved()).seo, { description: DESCRIPTION });
      await titleInput.fill(TITLE);

      // A sharing image replaces the banner in the card, through the
      // private owner-only asset route with its own purpose.
      await upload(
        /^(Upload|Replace) sharing image$/,
        "Adjust sharing image",
        "Sharing image",
      );
      const ogId = (await saved()).seo.ogImage.assetId;
      assert.notEqual(ogId, bannerId);
      assert.equal(
        await card.locator("img").getAttribute("src"),
        `/api/assets/${ogId}?purpose=og`,
      );
      const crop = await page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return [img.naturalWidth, img.naturalHeight];
      }, `/api/assets/${ogId}?purpose=og`);
      assert.deepEqual(crop, [1200, 630]);
      assert.deepEqual((await saved()).seo, {
        title: TITLE,
        description: DESCRIPTION,
        ogImage: { assetId: ogId },
      });

      await page.evaluate(
        await readFile(
          createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
          "utf8",
        ),
      );
      assert.deepEqual(
        await page.evaluate(async () =>
          (
            await window.axe.run(
              { include: [['[aria-label="Search and sharing"]']] },
              {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
                },
              },
            )
          ).violations.map(({ id, nodes }) => ({
            id,
            nodes: nodes.map((node) => node.target),
          })),
        ),
        [],
      );

      // Drafts stay private: no public page or asset, no draft metadata for
      // a signed-out request, and owner previews stay noindex and no-store.
      const site = "https://sharing-site.hasaweb.site";
      const publicRead = (url) =>
        authority(
          "/__fixture/public",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, method: "GET" }),
          },
          "none",
        );
      const unpublished = await publicRead(`${site}/`);
      assert.equal(unpublished.status, 404);
      assert.doesNotMatch(await unpublished.text(), /Sharing owner|Designer/);
      for (const path of ["/preview", `/api/assets/${ogId}?purpose=og`]) {
        const anonymous = await authority(path, {}, "none");
        assert.equal(anonymous.status, 404, path);
        assert.doesNotMatch(await anonymous.text(), /Sharing owner|Designer/);
      }
      for (const path of ["/preview", "/editor/preview"]) {
        const owner = await authority(path, {}, "alice");
        assert.equal(owner.status, 200, path);
        assert.match(owner.headers.get("Cache-Control"), /private.*no-store/);
        assert.match(owner.headers.get("X-Robots-Tag"), /noindex/, path);
        const body = await owner.text();
        assert.match(body, /<meta name="robots" content="noindex/, path);
        assert.doesNotMatch(body, /og:|Designer/, path);
      }

      await page.getByRole("button", { name: "Content", exact: true }).click();
      await saved();
      await checklist
        .getByRole("button", { name: /^(Retry )?Publish$/ })
        .click();
      await checklist
        .getByText("Publication complete.", { exact: true })
        .waitFor({ timeout: 120000 });

      // Published pages carry the saved values, escaped, and allow indexing.
      const escaped = "Sharing owner · &quot;Designer&quot; &lt;&amp;&gt;";
      let imageUrl;
      for (const [path, title] of [
        ["/", escaped],
        ["/projects/calm-tools", "Calm tools · Sharing owner"],
      ]) {
        const response = await publicRead(`${site}${path}`);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("X-Robots-Tag"), null, path);
        const html = await response.text();
        const head = html.slice(0, html.indexOf("</head>"));
        assert.doesNotMatch(head, /noindex|name="robots"/, path);
        assert.ok(head.includes(`<title>${title}</title>`), path);
        assert.ok(
          head.includes(`<meta property="og:title" content="${title}">`),
          path,
        );
        assert.ok(
          head.includes(
            `<meta name="description" content="Product design notes &amp; experiments.">`,
          ),
          path,
        );
        assert.ok(
          head.includes(`<link rel="canonical" href="${site}${path}">`),
          path,
        );
        assert.ok(
          head.includes(
            '<meta name="twitter:card" content="summary_large_image">',
          ),
          path,
        );
        const og = /<meta property="og:image" content="([^"]+)">/.exec(head);
        assert.ok(og, path);
        assert.match(
          og[1],
          new RegExp(`/candidate/[0-9a-f-]+/assets/${ogId}$`),
        );
        imageUrl ??= og[1];
        assert.equal(og[1], imageUrl, "one sharing image for every page");
      }
      const published = await publicRead(imageUrl);
      assert.equal(published.status, 200);
      assert.match(published.headers.get("Content-Type"), /^image\//);
      const sitemap = await (await publicRead(`${site}/sitemap.xml`)).text();
      assert.ok(sitemap.includes(`<loc>${site}/</loc>`));
      assert.ok(sitemap.includes(`<loc>${site}/projects/calm-tools</loc>`));
    },
  );
}
