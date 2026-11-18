import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkTrace,
  comparable,
  exercise,
} from "../support/face-reveal-renderer.mjs";

// Phase 39: the full-page draft preview. A real owner publishes a portfolio
// with a case study and a resume, then opens /preview, /preview/projects/{slug}
// and /preview/resume. The group checks the private response contract, owner
// and session boundaries, saved-draft behavior, visitor interactions and
// parity with the published pages.

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pdfBytes = (label) =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
async function canvasPng(page, color) {
  return Buffer.from(
    await page.evaluate(async (color) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(0, 0, 640, 640);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, color),
  );
}

// Markup with the differences that the two hosts are meant to have removed:
// asset locations, page-link prefixes and platform file hashes.
function normalizedMarkup(target) {
  return target.evaluate(() => {
    const url = (value) => {
      const asset = /\/assets\/([^/?#]+)(\/view)?/.exec(value);
      if (asset) return `asset:${asset[1]}${asset[2] ?? ""}`;
      if (value.startsWith("/preview"))
        return value.slice("/preview".length) || "/";
      const platform =
        /\/(?:portfolio-)?platform\/(?:[a-f0-9]{16,64}-)?(.+)$/.exec(value);
      return platform ? `platform:${platform[1]}` : value;
    };
    const root = document.querySelector(".pf-portfolio").cloneNode(true);
    for (const element of root.querySelectorAll("*"))
      for (const name of ["src", "href", "data"]) {
        const value = element.getAttribute(name);
        if (value !== null) element.setAttribute(name, url(value));
      }
    // React sets attributes in prop order and a static page in source order.
    for (const element of [root, ...root.querySelectorAll("*")]) {
      const attributes = [...element.attributes]
        .map(({ name, value }) => [name, value])
        .sort(([left], [right]) => left.localeCompare(right));
      for (const [name] of attributes) element.removeAttribute(name);
      for (const [name, value] of attributes) element.setAttribute(name, value);
    }
    for (const element of root.querySelectorAll("[srcset]")) {
      element.setAttribute(
        "srcset",
        element
          .getAttribute("srcset")
          .split(",")
          .map((part) => url(part.trim().split(" ")[0]))
          .join(","),
      );
    }
    return root.outerHTML;
  });
}

export async function checkDraftPreviewJourney({
  getPage,
  boot,
  cookie,
  sql,
  run,
  authority,
  browserOrigin,
  evidence,
}) {
  await run(
    "full-page draft preview is private, owner-only and matches the published pages",
    async () => {
      await boot();
      const page = getPage();
      const checklist = page.getByRole("region", {
        name: "Publication checklist",
      });
      const browser = page.context().browser();
      const draft = await page.evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      const portfolioId = (
        await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
      )[0].id;

      // Assets are uploaded through the real private upload endpoint.
      async function upload(purpose, type, body) {
        const response = await authority("/api/assets", {
          method: "PUT",
          headers: {
            "Content-Type": type,
            "X-Asset-Purpose": purpose,
            "X-Asset-Bytes": String(body.length),
            "X-Expected-Owner-Id": "draft-alice",
          },
          body,
        });
        assert.equal(response.status, 201, await response.clone().text());
        return (await response.json()).id;
      }
      const ids = {
        avatar: await upload(
          "avatar",
          "image/png",
          await canvasPng(page, "#6b8f2a"),
        ),
        banner: await upload(
          "banner",
          "image/png",
          await canvasPng(page, "#222222"),
        ),
        face: await upload(
          "face",
          "image/png",
          await canvasPng(page, "#c0306a"),
        ),
        project: await upload(
          "project",
          "image/png",
          await canvasPng(page, "#3366cc"),
        ),
        caseStudy: await upload(
          "case_study",
          "image/png",
          await canvasPng(page, "#cc6633"),
        ),
        resume: await upload(
          "resume",
          "application/pdf",
          pdfBytes("preview resume"),
        ),
      };
      const resumeBytes = pdfBytes("preview resume");
      const paragraph = (text, href) => ({
        type: "paragraph",
        content: [
          href
            ? {
                type: "text",
                text,
                marks: [{ type: "link", attrs: { href } }],
              }
            : { type: "text", text },
        ],
      });
      Object.assign(draft, {
        samples: {},
        seo: {},
        links: [
          {
            id: "website",
            kind: "website",
            label: "My website",
            value: "https://outbound.example.com/home",
            showInProfile: true,
            showInSocialComponent: true,
          },
        ],
        appearance: { themeId: "violet", fontId: "lora", colorMode: "light" },
        components: [
          {
            id: "projects-1",
            type: "projects",
            version: 1,
            data: {
              entries: [
                {
                  id: "project-1",
                  title: "Build pipeline",
                  summary: "Faster releases",
                  technologies: ["TypeScript"],
                  contribution: "Everything",
                  codeUrl: "https://outbound.example.com/code",
                  image: { assetId: ids.project, alt: "Pipeline screenshot" },
                  caseStudy: {
                    slug: "build-pipeline",
                    body: {
                      type: "doc",
                      content: [
                        paragraph("How it works"),
                        paragraph(
                          "Read the source",
                          "https://outbound.example.com/source",
                        ),
                        {
                          type: "image",
                          attrs: {
                            assetId: ids.caseStudy,
                            alt: "Pipeline diagram",
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  id: "project-2",
                  title: "No case study",
                  summary: "Only a card",
                  technologies: [],
                  contribution: "Some",
                },
              ],
            },
          },
          {
            id: "resume-1",
            type: "resume",
            version: 1,
            data: { file: { assetId: ids.resume } },
          },
        ],
      });
      draft.profile = {
        name: "Preview owner",
        bio: "I check my own pages first.",
        avatar: { assetId: ids.avatar, alt: "Owner portrait", accepted: true },
        banner: { assetId: ids.banner, alt: "Banner" },
        decorationId: "hands",
        faceReveal: {
          enabled: true,
          image: { assetId: ids.face, alt: "My real face" },
        },
      };
      const saveDraft = async (next) => {
        await sql(
          "UPDATE portfolio SET draft=?,draft_validation_version=2,draft_rev=draft_rev+1 WHERE id=?",
          [JSON.stringify(next), portfolioId],
        );
      };
      await saveDraft(draft);
      await page.goto(`${browserOrigin}/empty`);
      await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase("hasaweb-draft-recovery-v1");
          request.onsuccess = resolve;
          request.onerror = reject;
          request.onblocked = reject;
        });
      });
      await page.goto(browserOrigin);
      await page.waitForFunction(() => window.editorFixture?.ready);
      await page.getByLabel("Address name").fill("check-site");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      // The editor links to the full-page preview of the saved draft.
      const link = page.getByRole("link", {
        name: "Open full-page preview (saved draft)",
      });
      assert.equal(await link.getAttribute("href"), "/preview");
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.match(await link.getAttribute("rel"), /noopener/);

      const site = "https://check-site.hasaweb.site";
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
      await page.evaluate(() =>
        window.editorFixture.recovery.store.getState().controller.flushValid(),
      );
      await checklist
        .getByRole("button", { name: /^(Retry )?Publish$/ })
        .click();
      await checklist
        .getByText("Publication complete.", { exact: true })
        .waitFor({ timeout: 120000 });
      for (const path of ["/", "/projects/build-pipeline", "/resume"])
        assert.equal((await publicRead(`${site}${path}`)).status, 200, path);

      // Published pages never mention the private preview routes, and the
      // published sitemap and robots files, when present, do not list them.
      for (const path of ["/", "/projects/build-pipeline", "/resume"])
        assert.doesNotMatch(
          await (await publicRead(`${site}${path}`)).text(),
          /\/preview/,
        );
      for (const path of ["/sitemap.xml", "/robots.txt"]) {
        const metadata = await publicRead(`${site}${path}`);
        if (metadata.status === 200)
          assert.doesNotMatch(await metadata.text(), /\/preview/i, path);
      }

      // --- Response contract on every preview route -------------------
      const routes = [
        "/preview",
        "/preview/projects/build-pipeline",
        "/preview/resume",
      ];
      const requestsBefore = [];
      for (const route of routes) {
        const response = await authority(route, {}, "alice");
        assert.equal(response.status, 200, route);
        assert.equal(
          response.headers.get("Cache-Control"),
          "private, no-store",
        );
        assert.equal(
          response.headers.get("X-Robots-Tag"),
          "noindex, nofollow, noarchive",
        );
        assert.equal(response.headers.get("Vary"), "Cookie");
        assert.equal(response.headers.get("X-Frame-Options"), "DENY");
        const csp = response.headers.get("Content-Security-Policy");
        assert.match(csp, /form-action 'none'/);
        assert.match(csp, /script-src 'self'(;|$)/);
        assert.doesNotMatch(csp, /unsafe-|nonce-|sha256-/);
        assert.match(
          csp,
          route === "/preview/resume"
            ? /object-src 'self'/
            : /object-src 'none'/,
        );
        const markup = await response.text();
        assert.match(
          markup,
          /<meta name="robots" content="noindex,nofollow,noarchive">/,
        );
        assert.doesNotMatch(
          markup,
          /rel="(?:canonical|alternate|sitemap)"|property="og:|check-site/,
        );
        assert.doesNotMatch(markup, /Preview owner|Build pipeline/);
        requestsBefore.push(markup);
      }
      assert.equal(
        new Set(requestsBefore).size,
        1,
        "the shell never holds draft data",
      );

      // --- Unsigned, expired and foreign requests fail alike ----------
      const failures = [];
      for (const route of [
        ...routes,
        "/preview/projects/missing",
        "/preview/nope/x",
      ]) {
        const response = await authority(route, {}, "none");
        failures.push(response);
        assert.equal(response.status, 404, route);
        assert.equal(
          response.headers.get("Cache-Control"),
          "private, no-store",
        );
        assert.equal(
          response.headers.get("X-Robots-Tag"),
          "noindex, nofollow, noarchive",
        );
        assert.equal(await response.text(), "");
      }
      // Another account's own preview shell holds none of this draft, and it
      // cannot read this draft's private assets or resume.
      await authority(
        "/api/owner/portfolio",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
        "bob",
      );
      const bob = await authority("/preview/resume", {}, "bob");
      assert.equal(bob.status, 200);
      assert.equal(await bob.text(), requestsBefore[0]);
      const assetUrls = {
        download: `/api/assets/${ids.resume}?purpose=resume`,
        view: `/api/assets/${ids.resume}/view?purpose=resume`,
        caseStudy: `/api/assets/${ids.caseStudy}?purpose=case_study`,
        avatar: `/api/assets/${ids.avatar}?purpose=avatar`,
        face: `/api/assets/${ids.face}?purpose=face`,
      };
      for (const [name, path] of Object.entries(assetUrls)) {
        for (const who of ["none", "bob"]) {
          const response = await authority(path, {}, who);
          assert.equal(response.status, 404, `${who} ${name}`);
          assert.equal(await response.text(), "");
        }
        assert.equal((await authority(path, {}, "alice")).status, 200, name);
      }
      const draftRead = await authority("/api/owner/draft", {}, "bob");
      assert.doesNotMatch(
        await draftRead.text(),
        /Preview owner|Build pipeline/,
      );

      // The inline resume variant is only for PDFs with the resume purpose.
      const view = await authority(assetUrls.view, {}, "alice");
      assert.equal(view.headers.get("Content-Type"), "application/pdf");
      assert.equal(
        view.headers.get("Content-Disposition"),
        'inline; filename="resume.pdf"',
      );
      assert.equal(
        view.headers.get("Content-Security-Policy"),
        "frame-ancestors 'self'",
      );
      assert.equal(view.headers.get("X-Frame-Options"), "SAMEORIGIN");
      assert.equal(view.headers.get("Cache-Control"), "private, no-store");
      assert.equal(
        sha(Buffer.from(await view.arrayBuffer())),
        sha(resumeBytes),
      );
      const attachment = await authority(assetUrls.download, {}, "alice");
      assert.equal(
        attachment.headers.get("Content-Disposition"),
        'attachment; filename="resume.pdf"',
      );
      assert.equal(
        sha(Buffer.from(await attachment.arrayBuffer())),
        sha(resumeBytes),
      );
      for (const path of [
        `/api/assets/${ids.avatar}/view?purpose=avatar`,
        `/api/assets/${ids.avatar}/view?purpose=resume`,
        `/api/assets/${ids.resume}/view`,
        `/api/assets/${ids.resume}/view?purpose=avatar`,
      ])
        assert.equal((await authority(path, {}, "alice")).status, 404, path);

      // --- Contact: no delivery path from the app origin ---------------
      const outbox = async () =>
        (await sql("SELECT count(*) n FROM contact_outbox"))[0].n;
      const outboxBefore = await outbox();
      for (const path of [
        "/_/contact",
        "/preview/_/contact",
        "/preview/resume",
        "/api/contact",
        "/contact",
        // The local runtime probe also enqueues work; it is local-only.
        "/api/dev-runtime/web/run",
      ])
        for (const who of ["none", "alice"]) {
          const response = await authority(
            path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: "x",
                email: "x@example.com",
                message: "hello",
                token: "t",
              }),
            },
            who,
          );
          assert.ok(
            response.status >= 400,
            `${who} POST ${path} -> ${response.status}`,
          );
          assert.notEqual(response.status, 202);
        }
      assert.equal(await outbox(), outboxBefore);

      // --- The owner's browser -----------------------------------------
      const published = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      await published.route(
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
      const owner = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true,
      });
      await owner.addCookies([
        { name: "fixture-session", value: "alice", url: browserOrigin },
      ]);
      const errors = [];
      const sent = [];
      const tab = await owner.newPage();
      tab.on("pageerror", (error) => errors.push(error.message));
      tab.on("request", (request) =>
        sent.push(`${request.method()} ${request.url()}`),
      );
      // Outbound destinations are stubbed so the test never leaves the machine.
      await owner.route(/^https:\/\/outbound\.example\.com\//, (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Outbound</title><p>outbound</p>",
        }),
      );
      const ready = (target) =>
        target.waitForFunction(
          () =>
            !!document.querySelector(".pf-portfolio") &&
            [...document.querySelectorAll(".pf-image")].every(
              (slot) => slot.dataset.assetState !== "loading",
            ),
          undefined,
          { timeout: 30000 },
        );
      const visitor = await published.newPage();
      visitor.on("pageerror", (error) => errors.push(error.message));

      // Portfolio page: saved appearance, document headers and metadata.
      const home = await tab.goto(`${browserOrigin}/preview`);
      assert.equal(home.status(), 200);
      assert.equal(home.headers()["cache-control"], "private, no-store");
      await ready(tab);
      assert.deepEqual(
        await tab.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          font: document.documentElement.dataset.font,
          mode: document.documentElement.dataset.initialMode,
          robots: document.querySelector('meta[name="robots"]')?.content,
          forms: document.querySelectorAll("form").length,
          scripts: [...document.scripts].map((script) =>
            script.src.replace(location.origin, ""),
          ),
          inline: [...document.scripts].filter((script) => !script.src).length,
        })),
        {
          theme: "violet",
          font: "lora",
          mode: "light",
          robots: "noindex,nofollow,noarchive",
          forms: 0,
          scripts: ["/preview-assets/app.js"],
          inline: 0,
        },
      );
      assert.ok(
        await tab.evaluate(() => document.fonts.check('16px "Lora"')),
        "the saved font loads",
      );
      await visitor.goto(`${site}/`);
      await ready(visitor);
      assert.equal(
        await normalizedMarkup(tab),
        await normalizedMarkup(visitor),
      );

      // Face Reveal and decoration playback behave as they do when published.
      const previewTrace = await exercise(tab, tab);
      checkTrace("reveal-hands", previewTrace);
      const publishedTrace = await exercise(visitor, visitor);
      assert.deepEqual(
        comparable(previewTrace),
        comparable(publishedTrace),
        "preview matches the published page",
      );
      // Every load starts on the original avatar.
      await tab.locator("button[data-face-reveal]").click();
      await tab.reload();
      await ready(tab);
      assert.equal(
        await tab
          .locator("button[data-face-reveal]")
          .getAttribute("aria-label"),
        "Reveal face",
      );

      // Theme switching: light starts, the toggle works and follows the owner
      // to other preview pages like origin storage follows a visitor.
      const toggle = tab.locator("button[data-theme-toggle]");
      assert.equal(await toggle.innerText(), "Dark mode");
      await toggle.click();
      assert.equal(
        await tab.evaluate(() => document.documentElement.dataset.colorMode),
        "dark",
      );
      assert.equal(await toggle.innerText(), "Light mode");
      const dark = await tab.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      await tab.reload();
      await ready(tab);
      assert.equal(
        await tab.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        ),
        dark,
      );
      // Outbound links open their destination from a safe link.
      const outbound = tab
        .getByRole("link", { name: "My website", exact: true })
        .first();
      assert.equal(
        await outbound.getAttribute("href"),
        "https://outbound.example.com/home",
      );
      assert.equal(await outbound.getAttribute("rel"), "noopener noreferrer");
      await outbound.click();
      await tab.waitForURL("https://outbound.example.com/home");
      await tab.goBack();
      await ready(tab);

      // Case study: link, back link, body image and mode all work in preview.
      await tab
        .getByRole("link", { name: "Read case study: Build pipeline" })
        .click();
      await tab.waitForURL(`${browserOrigin}/preview/projects/build-pipeline`);
      await ready(tab);
      assert.equal(
        await tab.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        ),
        dark,
        "the toggle follows the owner across preview pages",
      );
      const caseStudy = await tab.evaluate(() => ({
        heading: document.querySelector('[data-component-id="case-0"] h2')
          ?.textContent,
        image: (() => {
          const image = document.querySelector(
            '[data-component-id="case-0"] img',
          );
          return (
            image && {
              src: image.getAttribute("src"),
              alt: image.alt,
              loaded: image.complete && image.naturalWidth > 0,
            }
          );
        })(),
        links: [...document.querySelectorAll(".pf-rich-text a")].map(
          (link) => link.href,
        ),
      }));
      assert.equal(caseStudy.heading, "Build pipeline");
      assert.deepEqual(caseStudy.image, {
        src: `${browserOrigin}/api/assets/${ids.caseStudy}?purpose=case_study`,
        alt: "Pipeline diagram",
        loaded: true,
      });
      assert.deepEqual(caseStudy.links, [
        "https://outbound.example.com/source",
      ]);
      await toggle.click();
      await visitor.goto(`${site}/projects/build-pipeline`);
      await ready(visitor);
      assert.equal(
        await normalizedMarkup(tab),
        await normalizedMarkup(visitor),
      );
      await tab.getByRole("link", { name: "Back to portfolio" }).click();
      await tab.waitForURL(`${browserOrigin}/preview`);
      await ready(tab);

      // Resume: embedded viewer, download fallback and the same bytes.
      await tab.getByRole("link", { name: "View resume", exact: true }).click();
      await tab.waitForURL(`${browserOrigin}/preview/resume`);
      await ready(tab);
      const viewer = tab.locator("object.pf-resume-viewer");
      assert.equal(
        await viewer.getAttribute("data"),
        `${browserOrigin}/api/assets/${ids.resume}/view?purpose=resume`,
      );
      assert.equal(await viewer.getAttribute("type"), "application/pdf");
      await visitor.goto(`${site}/resume`);
      await ready(visitor);
      assert.equal(
        await normalizedMarkup(tab),
        await normalizedMarkup(visitor),
      );
      const downloading = tab.waitForEvent("download");
      await tab
        .getByRole("link", { name: "Download resume (PDF)", exact: true })
        .click();
      const file = await downloading;
      assert.equal(file.suggestedFilename(), "resume.pdf");
      const saved = join(evidence, "preview-resume.pdf");
      await file.saveAs(saved);
      assert.equal(sha(await readFile(saved)), sha(resumeBytes));
      // Without an inline viewer, the fallback and download remain.
      const blocked = await owner.newPage();
      await blocked.route(/\/view\?/, (route) => route.abort());
      await blocked.goto(`${browserOrigin}/preview/resume`);
      await blocked
        .locator("[data-resume-fallback]")
        .waitFor({ state: "visible" });
      await blocked.close();
      await tab.screenshot({
        path: join(evidence, "preview-resume.png"),
        fullPage: true,
      });
      await tab.getByRole("link", { name: "Back to portfolio" }).click();
      await tab.waitForURL(`${browserOrigin}/preview`);

      // A page the published site would not have is unavailable here too.
      for (const path of [
        "/preview/projects/missing",
        "/preview/projects/project-2",
      ]) {
        await tab.goto(`${browserOrigin}${path}`);
        await tab.getByRole("heading", { name: "Page unavailable" }).waitFor();
        await tab.getByRole("link", { name: "Back to portfolio" }).click();
        await tab.waitForURL(`${browserOrigin}/preview`);
      }

      // Nothing in preview reached a contact path or any outside web origin.
      // The browser's own PDF viewer loads from chrome-extension:// URLs.
      assert.ok(
        sent.some((entry) => entry.includes("pdf_viewer")),
        "the embedded resume opened in the browser's PDF viewer",
      );
      assert.deepEqual(
        sent.filter(
          (entry) =>
            /contact|\/_\//.test(entry) ||
            (/^[A-Z]+ https?:/.test(entry) &&
              !entry.includes(browserOrigin) &&
              !entry.includes("outbound.example.com")),
        ),
        [],
      );

      // --- Saved draft, not editor state --------------------------------
      const latest = JSON.parse(
        (await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId]))[0]
          .draft,
      );
      latest.profile.bio = "Saved elsewhere";
      latest.components.push({
        id: "contact-1",
        type: "contact",
        version: 1,
        data: {},
      });
      await saveDraft(latest);
      // The editor tab still holds the old working copy; the preview shows
      // what the server saved after it regains focus, with no reload.
      assert.equal(
        await page.evaluate(
          () =>
            window.editorFixture.recovery.store
              .getState()
              .controller.store.getState().working.profile.bio,
        ),
        "I check my own pages first.",
      );
      await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
      await tab.getByText("Saved elsewhere", { exact: true }).waitFor();
      // The preview form has no source. Submitting it shows the preview-only
      // notice and sends nothing (the request log is checked again below).
      const form = tab.locator("form[data-contact-form]");
      assert.equal(await form.count(), 1);
      assert.equal(await form.getAttribute("data-contact-source"), null);
      const outboxBeforeSubmit = await outbox();
      const sentBeforeSubmit = sent.length;
      await form.getByRole("button", { name: "Send message" }).click();
      await form.getByText("Enter your name.").waitFor();
      await form.getByLabel("Name").fill("Preview visitor");
      await form.getByLabel("Email").fill("visitor@example.com");
      await form.getByLabel("Message").fill("Does this send?");
      await form.getByRole("button", { name: "Send message" }).click();
      await form
        .getByText(/^Preview only\. Messages are not sent from the preview\./)
        .waitFor();
      assert.equal(await form.getAttribute("data-state"), "preview");
      assert.equal(await outbox(), outboxBeforeSubmit);
      assert.deepEqual(sent.slice(sentBeforeSubmit), []);
      assert.equal(
        await tab.getByText("I check my own pages first.").count(),
        0,
      );

      // --- Sign-out and expiry remove the display and the private files -----
      const tokenOf = (name) =>
        decodeURIComponent(cookie(name).split("=")[1]).split(".")[0];
      const restoreSecond = (expires) =>
        sql(
          "INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('draft-session-alice-other',?,'draft-alice',?,?,?)",
          [tokenOf("alice-other"), expires, Date.now(), Date.now()],
        );
      await restoreSecond(Date.now() + 3600000);
      const second = await browser.newContext();
      await second.addCookies([
        { name: "fixture-session", value: "alice-other", url: browserOrigin },
      ]);
      const away = await second.newPage();
      await away.goto(`${browserOrigin}/preview/resume`);
      await ready(away);
      const privateUrls = [
        `${browserOrigin}${assetUrls.view}`,
        `${browserOrigin}${assetUrls.download}`,
        `${browserOrigin}${assetUrls.caseStudy}`,
        `${browserOrigin}${assetUrls.avatar}`,
        `${browserOrigin}/preview`,
        `${browserOrigin}/preview/resume`,
      ];
      for (const url of privateUrls)
        assert.equal((await second.request.get(url)).status(), 200, url);
      // Signing out elsewhere revokes the session: the display disappears the
      // next time the page is in view, and every private URL stops working.
      await sql("DELETE FROM session WHERE id='draft-session-alice-other'");
      await away.evaluate(() => window.dispatchEvent(new Event("focus")));
      await away
        .getByRole("heading", { name: "Sign in to open your private preview." })
        .waitFor();
      assert.equal(await away.locator(".pf-portfolio").count(), 0);
      assert.doesNotMatch(
        await away.locator("body").innerText(),
        /Preview owner/,
      );
      assert.equal(
        await away.getByRole("link", { name: "Sign in" }).getAttribute("href"),
        "/sign-in",
      );
      for (const url of privateUrls)
        assert.equal(
          (await second.request.get(url)).status(),
          404,
          `signed out ${url}`,
        );
      // Expiry behaves the same as sign-out.
      await restoreSecond(1);
      for (const url of privateUrls)
        assert.equal(
          (await second.request.get(url)).status(),
          404,
          `expired ${url}`,
        );
      await second.close();
      // The owner's other session is unaffected.
      for (const url of privateUrls)
        assert.equal(
          (await owner.request.get(url)).status(),
          200,
          `owner ${url}`,
        );

      await tab.close();
      await visitor.close();
      await owner.close();
      await published.close();
      assert.deepEqual(errors, []);
    },
  );
}
