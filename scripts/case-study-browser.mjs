import assert from "node:assert/strict";
import { join } from "node:path";

const allowed =
  '<h2>The problem</h2><p>We needed <a href="https://example.com/case">a faster build</a>.</p><ul><li><p>Measure first</p></li></ul>';
const hostile =
  '<img src="https://evil.example/pixel.png" onerror="window.caseStudyExecuted=true"><script>window.caseStudyExecuted=true</script><figure><img src="/api/assets/x?purpose=case_study"></figure><p onclick="window.caseStudyExecuted=true"><a href="javascript:alert(1)">Unsafe</a></p>';

async function paste(body, html) {
  await body.evaluate(async (node, html) => {
    node.focus();
    // Place the caret in the last text block. Selecting past a trailing image
    // block would select the image, and a paste would replace it.
    const blocks = [...node.children].filter(
      (child) => child.tagName !== "FIGURE",
    );
    const range = document.createRange();
    range.selectNodeContents(blocks.at(-1) ?? node);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    // Let ProseMirror observe the selection before the paste event.
    await new Promise((resolve) => setTimeout(resolve, 100));
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

function parse(page, html) {
  return page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const section = doc.querySelector('[data-component-id^="case-"]');
    return {
      title: doc.title,
      back: [...doc.querySelectorAll("nav.pf-page-nav a")].map((link) => ({
        href: link.getAttribute("href"),
        text: link.textContent,
      })),
      heading: section?.querySelector("h2")?.textContent,
      text: section?.textContent ?? "",
      images: [...(section?.querySelectorAll("img") ?? [])].map((img) => ({
        src: img.getAttribute("src"),
        alt: img.getAttribute("alt"),
      })),
      links: [...(section?.querySelectorAll("a") ?? [])].map((link) =>
        link.getAttribute("href"),
      ),
      unsafe: doc.querySelectorAll(
        'script:not([src]),iframe,[onclick],[onerror],[style],a[href^="javascript:"]',
      ).length,
      unavailable: doc.querySelector("h1")?.textContent,
      cards: [
        ...doc.querySelectorAll('[data-component="projects"] .pf-entry'),
      ].map((entry) => ({
        title: entry.querySelector("h3")?.textContent,
        text: entry.textContent,
        caseStudy: entry.querySelector("a.pf-page-link")?.getAttribute("href"),
        caseLabel: entry.querySelector("a.pf-page-link")?.textContent,
      })),
    };
  }, html);
}

export async function checkCaseStudyJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  evidence,
}) {
  await run(
    "case studies publish with cards, keep frozen URLs and withdraw removed pages and images",
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
            value: "https://example.com",
            showInProfile: true,
            showInSocialComponent: false,
          },
        ],
        appearance: { themeId: "leaf", fontId: "dm-sans", colorMode: "system" },
      });
      draft.profile = {
        name: "Case study owner",
        bio: "I write about the projects I build.",
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
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#3d6b8f";
          ctx.fillRect(0, 0, 640, 360);
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
      await page.getByLabel("Address name").fill("case-study-site");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      const portfolioId = (
        await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
      )[0].id;
      const site = "https://case-study-site.hasaweb.site";
      async function publicRead(url, method = "GET") {
        return authority(
          "/__fixture/public",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, method }),
          },
          "none",
        );
      }
      async function read(path) {
        const response = await publicRead(`${site}${path}`);
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
        await checklist
          .getByRole("button", { name: /^(Retry )?Publish$/ })
          .click();
        await checklist
          .getByText("Publication complete.", { exact: true })
          .waitFor({ timeout: 120000 });
      }
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
      const project = (index) => page.locator("[data-project-id]").nth(index);
      const casePath = (index) =>
        project(index)
          .locator("[data-case-study-path]")
          .getAttribute("data-case-study-path");
      async function addProject(title, summary) {
        const count = await page.locator("[data-project-id]").count();
        await page
          .getByRole("button", { name: "Add project", exact: true })
          .click();
        await project(count)
          .getByLabel("Project title", { exact: true })
          .fill(title);
        await project(count)
          .getByLabel("Summary", { exact: true })
          .fill(summary);
        return project(count);
      }
      async function addImage(entry, alt, index) {
        await entry
          .getByRole("region", { name: "New case study image", exact: true })
          .getByLabel("Upload image", { exact: true })
          .setInputFiles({
            name: "case.png",
            mimeType: "image/png",
            buffer: image,
          });
        const region = entry.getByRole("region", {
          name: `Case study ${index} image`,
          exact: true,
        });
        await region.locator("img").waitFor();
        // Typing right after an upload continues the text; it never replaces
        // the new image block.
        await entry
          .getByRole("textbox", { name: "Case study body", exact: true })
          .focus();
        await entry.page().keyboard.type(" typed");
        await entry
          .locator(".rich-text-input")
          .getByText(/ typed$/)
          .waitFor();
        assert.equal(
          await entry.locator(".rich-text-input img").count(),
          index,
        );
        await region.locator("img").waitFor();
        await region
          .getByLabel(`Case study ${index} description`, { exact: true })
          .fill(alt);
      }

      // Before first publication the slug follows the title.
      const first = await addProject("Original title", "First summary");
      await first
        .getByRole("button", { name: "Add case study", exact: true })
        .click();
      assert.equal(await casePath(0), "/projects/original-title");
      await first
        .getByLabel("Project title", { exact: true })
        .fill("Build pipeline");
      assert.equal(await casePath(0), "/projects/build-pipeline");
      const firstBody = first.getByRole("textbox", {
        name: "Case study body",
        exact: true,
      });
      await paste(firstBody, allowed + hostile);
      await addImage(first, "Pipeline diagram", 1);
      const second = await addProject("Second project", "Second summary");
      await second
        .getByRole("button", { name: "Add case study", exact: true })
        .click();
      assert.equal(await casePath(1), "/projects/second-project");
      await paste(
        second.getByRole("textbox", { name: "Case study body", exact: true }),
        "<p>Second case study body</p>",
      );
      await addImage(second, "Second diagram", 1);
      await flush();
      const saved = JSON.parse(
        (await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId]))[0]
          .draft,
      );
      const savedBody = saved.components[0].data.entries[0].caseStudy.body;
      const imageNodes = savedBody.content.filter(
        (node) => node.type === "image",
      );
      // Only the uploaded image exists; pasted <img> elements created nothing.
      assert.equal(imageNodes.length, 1);
      assert.deepEqual(Object.keys(imageNodes[0].attrs).sort(), [
        "alt",
        "assetId",
      ]);
      assert.equal(imageNodes[0].attrs.alt, "Pipeline diagram");
      assert.doesNotMatch(
        JSON.stringify(savedBody),
        /evil|onerror|onclick|javascript|script|src/,
      );
      const firstAsset = imageNodes[0].attrs.assetId;
      assert.equal(
        (await sql("SELECT kind,status FROM asset WHERE id=?", [firstAsset]))[0]
          .kind,
        "case_study",
      );
      assert.equal(
        await page.evaluate(() => window.caseStudyExecuted),
        undefined,
      );

      // First publication: cards and case-study pages go live together.
      await publish();
      let home = await read("/");
      assert.equal(home.status, 200);
      assert.deepEqual(
        home.cards.map((card) => [card.title, card.caseStudy]),
        [
          ["Build pipeline", "/projects/build-pipeline"],
          ["Second project", "/projects/second-project"],
        ],
      );
      assert.equal(home.cards[0].caseLabel, "Read case study: Build pipeline");
      let caseStudy = await read("/projects/build-pipeline");
      assert.equal(caseStudy.status, 200);
      assert.deepEqual(caseStudy.back, [
        { href: "/", text: "Back to portfolio" },
      ]);
      assert.equal(caseStudy.heading, "Build pipeline");
      assert.match(caseStudy.text, /The problem/);
      assert.match(caseStudy.text, /Measure first/);
      assert.deepEqual(caseStudy.links, ["https://example.com/case"]);
      assert.equal(caseStudy.unsafe, 0);
      assert.equal(caseStudy.images.length, 1);
      assert.equal(caseStudy.images[0].alt, "Pipeline diagram");
      let firstImage = caseStudy.images[0].src;
      assert.match(
        firstImage,
        new RegExp(
          `^https://assets\\.hasaweb\\.site/candidate/[^/]+/assets/${firstAsset}$`,
        ),
      );
      assert.equal((await publicRead(firstImage)).status, 200);
      const secondPage = await read("/projects/second-project");
      assert.equal(secondPage.status, 200);
      let secondImage = secondPage.images[0].src;
      assert.equal((await publicRead(secondImage)).status, 200);
      // The visitor's back link resolves to the published portfolio.
      assert.equal((await read(caseStudy.back[0].href)).status, 200);

      // A title edit after first publication keeps the URL.
      await first
        .getByLabel("Project title", { exact: true })
        .fill("Renamed pipeline");
      assert.equal(await casePath(0), "/projects/build-pipeline");
      await first
        .getByText(
          "Published. This address stays the same when you change the project title.",
        )
        .waitFor();
      await publish();
      caseStudy = await read("/projects/build-pipeline");
      assert.equal(caseStudy.status, 200);
      assert.equal(caseStudy.heading, "Renamed pipeline");
      assert.equal(caseStudy.images.length, 1);
      home = await read("/");
      assert.equal(home.cards[0].caseStudy, "/projects/build-pipeline");
      const renamed = await read("/projects/renamed-pipeline");
      assert.equal(renamed.status, 404);
      assert.equal(renamed.unavailable, "Page unavailable");
      assert.deepEqual(renamed.back, []);

      // A failed commit leaves both the old card and old case study live.
      await first.getByLabel("Summary", { exact: true }).fill("Atomic summary");
      await paste(firstBody, "<p>Atomic body</p>");
      await flush();
      let blocked = true;
      await page.route("**/api/owner/publication/commit", (route) =>
        blocked
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: '{"error":"publication_unavailable"}',
            })
          : route.continue(),
      );
      await checklist
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await checklist
        .getByRole("alert")
        .filter({ hasText: "Could not finish publication" })
        .waitFor({ timeout: 120000 });
      home = await read("/");
      caseStudy = await read("/projects/build-pipeline");
      assert.match(home.cards[0].text, /First summary/);
      assert.doesNotMatch(home.cards[0].text, /Atomic summary/);
      assert.doesNotMatch(caseStudy.text, /Atomic body/);
      blocked = false;
      await page.unroute("**/api/owner/publication/commit");
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .click();
      await checklist
        .getByText("Publication complete.", { exact: true })
        .waitFor({ timeout: 120000 });
      home = await read("/");
      caseStudy = await read("/projects/build-pipeline");
      assert.match(home.cards[0].text, /Atomic summary/);
      assert.match(caseStudy.text, /Atomic body/);
      assert.equal(caseStudy.images.length, 1);

      // Deleting a published project does not free its live slug yet.
      await second
        .getByRole("button", { name: "Remove project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm remove project", exact: true })
        .click();
      const replacement = await addProject("Second project", "Replacement");
      await replacement
        .getByRole("button", { name: "Add case study", exact: true })
        .click();
      assert.equal(await casePath(1), "/projects/second-project-2");
      await paste(
        replacement.getByRole("textbox", {
          name: "Case study body",
          exact: true,
        }),
        "<p>Replacement body</p>",
      );
      // A stale tab that takes the live slug is rejected by the server check.
      await flush();
      await page.evaluate(() => {
        const controller =
          window.editorFixture.recovery.store.getState().controller;
        const working = structuredClone(controller.store.getState().working);
        working.components[0].data.entries[1].caseStudy.slug = "second-project";
        controller.update(working);
      });
      await flush();
      await checklist
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await checklist
        .getByText(
          "Reload the editor to restore this case study's published address",
        )
        .first()
        .waitFor({ timeout: 60000 });
      assert.equal(
        (await read("/projects/second-project")).heading,
        "Second project",
      );
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await sections
        .getByRole("button", { name: "Projects", exact: true })
        .click();
      await page
        .locator("[data-project-id]")
        .nth(1)
        .locator('[data-case-study-path="/projects/second-project-2"]')
        .waitFor();

      // Removing a case study (and a project) withdraws pages and images.
      // Earlier candidate URLs can be retired by retention cleanup, so use
      // the images that the current live version serves.
      firstImage = (await read("/projects/build-pipeline")).images[0].src;
      secondImage = (await read("/projects/second-project")).images[0].src;
      assert.equal((await publicRead(firstImage)).status, 200);
      assert.equal((await publicRead(secondImage)).status, 200);
      await project(0)
        .getByRole("button", { name: "Remove case study", exact: true })
        .click();
      await project(0)
        .getByRole("button", { name: "Keep case study", exact: true })
        .click();
      assert.equal(await casePath(0), "/projects/build-pipeline");
      await project(0)
        .getByRole("button", { name: "Remove case study", exact: true })
        .click();
      await project(0)
        .getByRole("button", { name: "Confirm remove case study", exact: true })
        .click();
      await flush();
      // Draft removal changes nothing public until Publish.
      assert.equal((await read("/projects/build-pipeline")).status, 200);
      assert.equal((await publicRead(firstImage)).status, 200);
      await publish();
      home = await read("/");
      assert.deepEqual(
        home.cards.map((card) => [card.title, card.caseStudy]),
        [
          ["Renamed pipeline", undefined],
          ["Second project", "/projects/second-project-2"],
        ],
      );
      for (const path of [
        "/projects/build-pipeline",
        "/projects/second-project",
      ]) {
        const removed = await read(path);
        assert.equal(removed.status, 404);
        assert.equal(removed.unavailable, "Page unavailable");
        const html = await (await publicRead(`${site}${path}`)).text();
        assert.match(html, /<a href="\/">Back to portfolio<\/a>/);
      }
      assert.equal((await read("/projects/second-project-2")).status, 200);
      for (const url of [firstImage, secondImage, `${firstImage}?v=query`]) {
        assert.equal((await publicRead(url)).status, 404);
        assert.equal((await publicRead(url, "HEAD")).status, 404);
      }
      // Only after the removal is live may another project reuse the slug.
      const reuse = await addProject("Build pipeline", "Reuse");
      await reuse
        .getByRole("button", { name: "Add case study", exact: true })
        .click();
      assert.equal(await casePath(2), "/projects/build-pipeline");
      // Unknown hosts and unpublished portfolios stay generic.
      const unknown = await publicRead(
        "https://no-such-site.hasaweb.site/projects/x",
      );
      assert.equal(unknown.status, 404);
      assert.match(await unknown.text(), /Portfolio unavailable/);
      await page.screenshot({
        path: join(evidence, "case-study-editor.png"),
        fullPage: true,
      });
    },
  );
}
