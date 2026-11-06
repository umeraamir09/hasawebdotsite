import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const RESUME_BYTES = 10_485_760;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function pdf(label, size = 0) {
  const body = Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
  if (!size) return body;
  const padded = Buffer.alloc(size, 0x20);
  body.copy(padded);
  return padded;
}

function parse(page, html) {
  return page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const resume = doc.querySelector('[data-component="resume"]');
    return {
      sections: [...doc.querySelectorAll("[data-component-id]")].map((node) =>
        node.getAttribute("data-component"),
      ),
      downloads: [...doc.querySelectorAll("a[data-resume-download]")].map(
        (link) => ({
          href: link.getAttribute("href"),
          text: link.textContent,
        }),
      ),
      view: resume?.querySelector("a.pf-page-link")?.getAttribute("href"),
      embed: doc.querySelector("object.pf-resume-viewer")?.getAttribute("data"),
      fallback: !!doc.querySelector("[data-resume-fallback]"),
      back: [...doc.querySelectorAll("nav.pf-page-nav a")].map((link) => ({
        href: link.getAttribute("href"),
        text: link.textContent,
      })),
      heading: doc.querySelector("h1")?.textContent,
      resumeText: resume?.textContent ?? "",
    };
  }, html);
}

export async function checkResumeJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  evidence,
}) {
  await run(
    "resume controls and /resume publish, replace and withdraw one PDF",
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
            showInSocialComponent: true,
          },
        ],
        appearance: { themeId: "leaf", fontId: "dm-sans", colorMode: "system" },
      });
      draft.profile = {
        name: "Resume owner",
        bio: "I publish my resume.",
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
      await page.getByLabel("Address name").fill("resume-site");
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
      const site = "https://resume-site.hasaweb.site";
      const publicRead = (url, method = "GET") =>
        authority(
          "/__fixture/public",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, method }),
          },
          "none",
        );
      async function read(path) {
        const response = await publicRead(`${site}${path}`);
        return {
          status: response.status,
          ...(await parse(page, await response.text())),
        };
      }
      async function bytes(url) {
        const response = await publicRead(url);
        return {
          status: response.status,
          disposition: response.headers.get("Content-Disposition"),
          type: response.headers.get("Content-Type"),
          csp: response.headers.get("Content-Security-Policy"),
          sha: sha(Buffer.from(await response.arrayBuffer())),
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
      const missingIssue = checklist.getByRole("button", {
        name: "Complete your resume download resume PDF",
        exact: true,
      });
      async function expectBlocked() {
        await flush();
        await checklist
          .getByRole("button", { name: "Publish", exact: true })
          .click();
        await missingIssue.waitFor({ timeout: 60000 });
        assert.equal(
          await checklist.getByText("Publication complete.").count(),
          0,
        );
      }
      const savedFile = async () =>
        JSON.parse(
          (
            await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId])
          )[0].draft,
        ).components.find((item) => item.type === "resume")?.data.file;

      // The control is optional and ordered among the components.
      const sections = page.getByRole("region", {
        name: "Portfolio sections",
        exact: true,
      });
      for (const title of ["Resume download", "Social links"]) {
        await sections
          .getByRole("button", { name: "Add component", exact: true })
          .click();
        await page
          .getByRole("button", { name: `Add ${title}`, exact: true })
          .click();
      }
      await sections
        .getByRole("button", { name: "Resume download", exact: true })
        .click();
      const controls = page.getByRole("region", {
        name: "Resume download controls",
        exact: true,
      });
      await controls.waitFor();

      // Including the control without a valid PDF blocks publication.
      await expectBlocked();
      assert.equal((await read("/")).status, 404);
      await missingIssue.click();
      const correction = page.getByRole("region", {
        name: "Publication correction",
      });
      const upload = correction.getByRole("region", {
        name: "Resume PDF",
        exact: true,
      });
      await upload.waitFor();

      // Non-PDF and oversized files are rejected before upload.
      await upload.getByLabel("Upload resume PDF").setInputFiles({
        name: "resume.png",
        mimeType: "image/png",
        buffer: image,
      });
      await upload.getByRole("alert").getByText("Choose a PDF file.").waitFor();
      await upload.getByLabel("Upload resume PDF").setInputFiles({
        name: "large.pdf",
        mimeType: "application/pdf",
        buffer: pdf("too large", RESUME_BYTES + 1),
      });
      await upload
        .getByRole("alert")
        .getByText("Choose a PDF of 10 MiB or less.")
        .waitFor();
      assert.equal(await savedFile(), undefined);

      // A file at exactly the limit uploads and attaches to the draft.
      const first = pdf("first resume", RESUME_BYTES);
      await upload.getByLabel("Upload resume PDF").setInputFiles({
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: first,
      });
      await upload
        .getByText("Upload complete. Your draft resume is ready.")
        .waitFor({ timeout: 60000 });
      await flush();
      const firstAsset = (await savedFile())?.assetId;
      assert.match(firstAsset, /^[a-f0-9-]{36}$/);
      assert.deepEqual(
        (
          await sql(
            "SELECT kind,content_type,bytes,status FROM asset WHERE id=?",
            [firstAsset],
          )
        )[0],
        {
          kind: "resume",
          content_type: "application/pdf",
          bytes: RESUME_BYTES,
          status: "ready",
        },
      );
      await correction
        .getByRole("button", { name: "Close correction", exact: true })
        .click();

      // First Publish: the control and /resume serve the same PDF bytes.
      await publish();
      let home = await read("/");
      assert.equal(home.status, 200);
      assert.deepEqual(home.sections, ["resume", "social-links"]);
      assert.equal(home.downloads.length, 1);
      assert.equal(home.downloads[0].text, "Download resume (PDF)");
      assert.equal(home.view, "/resume");
      const download = home.downloads[0].href;
      assert.match(
        download,
        new RegExp(
          `^https://assets\\.hasaweb\\.site/candidate/[^/]+/assets/${firstAsset}$`,
        ),
      );
      let resume = await read("/resume");
      assert.equal(resume.status, 200);
      assert.deepEqual(resume.back, [{ href: "/", text: "Back to portfolio" }]);
      assert.deepEqual(
        resume.downloads.map((link) => link.href),
        [download],
      );
      assert.equal(resume.embed, `${download}/view`);
      assert.equal(resume.fallback, true);
      const pageHeaders = (await publicRead(`${site}/resume`)).headers.get(
        "Content-Security-Policy",
      );
      assert.match(pageHeaders, /object-src https:\/\/assets\.hasaweb\.site;/);
      assert.match(
        (await publicRead(`${site}/`)).headers.get("Content-Security-Policy"),
        /object-src 'none'/,
      );
      const served = await bytes(download);
      assert.deepEqual(served, {
        status: 200,
        disposition: 'attachment; filename="resume.pdf"',
        type: "application/pdf",
        csp: served.csp,
        sha: sha(first),
      });
      const embedded = await bytes(`${download}/view`);
      assert.equal(embedded.status, 200);
      assert.equal(embedded.sha, sha(first));
      assert.equal(embedded.disposition, 'inline; filename="resume.pdf"');
      assert.equal(
        embedded.csp,
        "frame-ancestors https://resume-site.hasaweb.site",
      );
      // Image assets have no embeddable variant.
      const banner = JSON.parse(
        (await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId]))[0]
          .draft,
      ).profile.banner.assetId;
      assert.equal(
        (
          await publicRead(
            download.replace(/assets\/[^/]+$/, `assets/${banner}/view`),
          )
        ).status,
        404,
      );

      // A visitor without an inline PDF viewer gets the download fallback,
      // downloads the published file, and returns to the portfolio.
      const visitor = await page.context().browser().newContext({
        acceptDownloads: true,
      });
      try {
        await visitor.route(
          /^https:\/\/[^/]+\.hasaweb\.site\//,
          async (route) => {
            const response = await publicRead(
              route.request().url(),
              route.request().method(),
            );
            const headers = Object.fromEntries(response.headers);
            delete headers["content-encoding"];
            delete headers["content-length"];
            await route.fulfill({
              status: response.status,
              headers,
              body: Buffer.from(await response.arrayBuffer()),
            });
          },
        );
        const tab = await visitor.newPage();
        await tab.goto(`${site}/resume`);
        await tab
          .getByRole("heading", { name: "Resume", exact: true })
          .waitFor();
        const viewer = tab.locator("object.pf-resume-viewer");
        assert.equal(await viewer.getAttribute("data"), `${download}/view`);
        const downloading = tab.waitForEvent("download");
        await tab
          .getByRole("link", { name: "Download resume (PDF)", exact: true })
          .last()
          .click();
        const file = await downloading;
        assert.equal(file.suggestedFilename(), "resume.pdf");
        const saved = join(evidence, "visitor-resume.pdf");
        await file.saveAs(saved);
        assert.equal(sha(await readFile(saved)), sha(first));
        await tab.screenshot({
          path: join(evidence, "resume-page.png"),
          fullPage: true,
        });
        await tab
          .getByRole("link", { name: "Back to portfolio", exact: true })
          .click();
        await tab.waitForURL(`${site}/`);
        await tab
          .getByRole("link", { name: "View resume", exact: true })
          .click();
        await tab.waitForURL(`${site}/resume`);
        // When embedded viewing is unavailable, the fallback text shows and
        // the download control still serves the published file.
        const blocked = await visitor.newPage();
        await blocked.route(/\/view$/, (route) => route.abort());
        await blocked.goto(`${site}/resume`);
        await blocked
          .locator("[data-resume-fallback]")
          .waitFor({ state: "visible" });
        const fallbackDownload = blocked.waitForEvent("download");
        await blocked
          .getByRole("link", { name: "Download resume (PDF)", exact: true })
          .click();
        const fallbackFile = join(evidence, "visitor-fallback-resume.pdf");
        await (await fallbackDownload).saveAs(fallbackFile);
        assert.equal(sha(await readFile(fallbackFile)), sha(first));
        await blocked.screenshot({
          path: join(evidence, "resume-page-fallback.png"),
          fullPage: true,
        });
        await blocked.close();
        await tab.setViewportSize({ width: 375, height: 800 });
        assert.ok(
          await tab.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
        );
      } finally {
        await visitor.close();
      }

      // Replacing the PDF changes only the draft until Publish.
      await sections
        .getByRole("button", { name: "Resume download", exact: true })
        .click();
      const second = pdf("second resume");
      await controls.getByLabel("Replace resume PDF").setInputFiles({
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: second,
      });
      await controls
        .getByText("Upload complete. Your draft resume is ready.")
        .waitFor({ timeout: 60000 });
      await flush();
      const secondAsset = (await savedFile())?.assetId;
      assert.notEqual(secondAsset, firstAsset);
      assert.equal((await bytes(download)).sha, sha(first));
      assert.equal((await read("/resume")).downloads[0].href, download);
      await publish();
      home = await read("/");
      resume = await read("/resume");
      const replaced = home.downloads[0].href;
      assert.match(replaced, new RegExp(`/assets/${secondAsset}$`));
      assert.deepEqual(
        resume.downloads.map((link) => link.href),
        [replaced],
      );
      assert.equal(resume.embed, `${replaced}/view`);
      assert.equal((await bytes(replaced)).sha, sha(second));
      assert.equal((await bytes(`${replaced}/view`)).sha, sha(second));
      for (const url of [download, `${download}/view`])
        assert.equal((await publicRead(url)).status, 404);

      // Removing the PDF while keeping the control blocks publication and
      // leaves the published file live.
      await controls
        .getByRole("button", { name: "Remove resume PDF", exact: true })
        .click();
      await controls.getByText("No PDF attached.", { exact: false }).waitFor();
      await expectBlocked();
      assert.equal((await bytes(replaced)).status, 200);

      // Removing the control withdraws the page and its file after Publish.
      await sections
        .getByRole("button", { name: "Remove Resume download", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await flush();
      assert.equal((await read("/resume")).status, 200);
      await publish();
      home = await read("/");
      assert.deepEqual(home.sections, ["social-links"]);
      assert.deepEqual(home.downloads, []);
      resume = await read("/resume");
      assert.equal(resume.status, 404);
      assert.equal(resume.heading, "Page unavailable");
      assert.deepEqual(resume.back, []);
      assert.match(
        await (await publicRead(`${site}/resume`)).text(),
        /<a href="\/">Back to portfolio<\/a>/,
      );
      for (const url of [
        replaced,
        `${replaced}/view`,
        `${replaced}?download=1`,
      ]) {
        assert.equal((await publicRead(url)).status, 404);
        assert.equal((await publicRead(url, "HEAD")).status, 404);
      }
      // Unknown and unpublished hosts keep the generic unavailable state.
      const unknown = await publicRead("https://no-resume.hasaweb.site/resume");
      assert.equal(unknown.status, 404);
      assert.match(await unknown.text(), /Portfolio unavailable/);
      await page.screenshot({
        path: join(evidence, "resume-editor.png"),
        fullPage: true,
      });
    },
  );
}
