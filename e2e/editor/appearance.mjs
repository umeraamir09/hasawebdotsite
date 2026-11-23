import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  FIRST_PAINT_SAMPLER,
  paintedFrames,
  resolvedMode,
  rgb,
} from "../support/first-paint.mjs";
import { addSection, openChecklist, openPanel } from "./shell.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n% appearance\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const PAGES = ["/", "/projects/theme-demo", "/resume"];

// Saved preset appearance from the editor controls through Publish to every
// real public page type served by the site Worker.
export async function checkAppearanceJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  evidence,
  root,
}) {
  await run(
    "saved preset, font and initial mode apply in preview and on every published page type without a wrong first paint",
    async () => {
      const catalog = JSON.parse(
        await readFile(join(root, "packages/theme/catalog.json"), "utf8"),
      );
      const theme = (id) => catalog.themes.find((entry) => entry.id === id);
      const font = (id) => catalog.fonts.find((entry) => entry.id === id);
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
        name: "Appearance owner",
        bio: "I pick a theme for every page.",
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
      await page.getByLabel("Address name").fill("appearance-site");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      await openPanel(page, "Build");
      const portfolioId = (
        await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
      )[0].id;
      const saved = async () =>
        JSON.parse(
          (
            await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId])
          )[0].draft,
        );
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

      // One project with a case study and the resume component give all
      // three public page types.
      const sections = page.getByRole("region", {
        name: "Page",
        exact: true,
      });
      await addSection(page, "Projects");
      await page
        .getByRole("button", { name: "Add project", exact: true })
        .click();
      const project = page.locator("[data-project-id]").first();
      await project
        .getByLabel("Project title", { exact: true })
        .fill("Theme demo");
      await project
        .getByLabel("Summary", { exact: true })
        .fill("A project shown in every theme.");
      await project
        .getByRole("button", { name: "Add case study", exact: true })
        .click();
      await project
        .getByRole("textbox", { name: "Case study body", exact: true })
        .focus();
      await page.keyboard.type("The same words in every theme.");
      await addSection(page, "Resume download");
      await sections
        .getByRole("button", { name: "Resume download", exact: true })
        .click();
      const resume = page.getByRole("region", {
        name: "Resume download controls",
        exact: true,
      });
      await resume.getByLabel("Upload resume PDF").setInputFiles({
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: PDF,
      });
      await resume
        .getByText("Upload complete. Your draft resume is ready.")
        .waitFor({ timeout: 60000 });

      // Owner controls: exactly six presets, three fonts and three modes.
      await page.getByRole("button", { name: "Style", exact: true }).click();
      const panel = page.getByRole("region", {
        name: "Customization",
        exact: true,
      });
      const group = (name) => panel.getByRole("group", { name, exact: true });
      assert.deepEqual(
        await group("Theme")
          .getByRole("radio")
          .evaluateAll((inputs) => inputs.map((input) => input.value)),
        ["leaf", "violet", "clay", "matcha", "strawberry", "coffee"],
      );
      assert.deepEqual(
        await group("Font")
          .getByRole("radio")
          .evaluateAll((inputs) => inputs.map((input) => input.value)),
        ["dm-sans", "manrope", "lora"],
      );
      assert.equal(await group("Starting mode").getByRole("radio").count(), 3);
      assert.equal(
        await group("Theme").getByRole("radio", { name: "Leaf" }).isChecked(),
        true,
      );
      const preview = () =>
        page
          .frames()
          .find((frame) => frame.url().includes("/private/editor-preview"));
      const previewStyle = () =>
        preview().evaluate(() => {
          const root = document.documentElement;
          const style = getComputedStyle(root);
          return {
            theme: root.dataset.theme,
            font: root.dataset.font,
            initial: root.dataset.initialMode,
            mode: root.dataset.colorMode,
            background: style.backgroundColor,
            fontFamily: style.fontFamily,
          };
        });
      async function choose(themeId, fontId, mode) {
        await group("Theme")
          .getByRole("radio", { name: theme(themeId).name })
          .check();
        await group("Font")
          .getByRole("radio", { name: font(fontId).name })
          .check();
        await group("Starting mode")
          .getByRole("radio", { name: new RegExp(`^${mode}`, "i") })
          .check();
        await preview().waitForFunction(
          ({ themeId, fontId, mode }) =>
            document.documentElement.dataset.theme === themeId &&
            document.documentElement.dataset.font === fontId &&
            document.documentElement.dataset.initialMode === mode,
          { themeId, fontId, mode },
        );
      }
      // The controls are native radio groups: keyboard selection works and
      // axe finds no WCAG 2.2 AA violations in the panel.
      await group("Font").getByRole("radio", { name: "DM Sans" }).focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await group("Font").getByRole("radio", { name: "Manrope" }).isChecked(),
        true,
      );
      await preview().waitForFunction(
        () => document.documentElement.dataset.font === "manrope",
      );
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
              { include: [['[aria-label="Customization"]']] },
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
      await choose("strawberry", "lora", "dark");
      const previewed = await previewStyle();
      assert.equal(previewed.mode, "dark");
      assert.equal(previewed.background, rgb(theme("strawberry").dark.page));
      assert.match(previewed.fontFamily, /^"?Lora"?, /);
      await preview().evaluate(() => document.fonts.ready);
      assert.ok(
        await preview().evaluate(() =>
          [...document.fonts].some(
            (face) =>
              face.family.replaceAll('"', "") === "Lora" &&
              face.status === "loaded",
          ),
        ),
        "preview loads the self-hosted Lora face",
      );
      await flush();
      assert.deepEqual((await saved()).appearance, {
        themeId: "strawberry",
        fontId: "lora",
        colorMode: "dark",
      });
      await page.getByRole("button", { name: "Build", exact: true }).click();
      await publish();

      const site = "https://appearance-site.hasaweb.site";
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
      const strict = (csp) => {
        assert.match(csp, /default-src 'none'; script-src 'self' [^;]+;/);
        assert.doesNotMatch(csp, /unsafe-|sha256-|nonce-/);
      };
      const documents = {};
      for (const path of PAGES) {
        const response = await publicRead(`${site}${path}`);
        assert.equal(response.status, 200, path);
        strict(response.headers.get("Content-Security-Policy"));
        const html = await response.text();
        documents[path] = html;
        assert.match(
          html,
          /^<!doctype html><html lang="en" data-theme="strawberry" data-font="lora" data-initial-mode="dark"><head>/,
          path,
        );
        const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
        assert.equal(scripts.length, 1, path);
        assert.match(
          scripts[0],
          /^<script src="\/platform\/[a-f0-9]{64}\.js">$/,
        );
        assert.ok(
          html.indexOf("<script") < html.indexOf("</head>"),
          "blocking script in head",
        );
      }

      // A visitor with a light system setting, a held platform script and the
      // first-paint sampler on every navigation.
      const visitor = await page.context().browser().newContext({
        colorScheme: "light",
      });
      const fonts = [];
      try {
        await visitor.addInitScript(FIRST_PAINT_SAMPLER);
        await visitor.route(
          /^https:\/\/[^/]+\.hasaweb\.site\//,
          async (route) => {
            const url = route.request().url();
            const response = await publicRead(url, route.request().method());
            if (url.endsWith(".js"))
              await new Promise((resolve) => setTimeout(resolve, 300));
            const headers = Object.fromEntries(response.headers);
            delete headers["content-encoding"];
            delete headers["content-length"];
            const body = Buffer.from(await response.arrayBuffer());
            if (url.endsWith(".ttf"))
              fonts.push({ url, status: response.status, sha256: sha(body) });
            await route.fulfill({ status: response.status, headers, body });
          },
        );
        const tab = await visitor.newPage();
        const errors = [];
        tab.on("pageerror", (error) => errors.push(error.message));
        async function expectPainted(path, themeId, mode, family) {
          await tab.waitForURL(`${site}${path}`);
          const frames = await paintedFrames(tab);
          const expected = rgb(theme(themeId)[mode].page);
          assert.deepEqual(
            frames.filter(
              (frame) =>
                frame.background !== expected ||
                !new RegExp(`^"?${family}"?, `).test(frame.fontFamily),
            ),
            [],
            `${path} paints ${themeId} ${mode} ${family} from the first frame`,
          );
          assert.equal(
            await tab.evaluate(
              () => document.documentElement.dataset.colorMode,
            ),
            mode,
          );
          assert.equal(
            await tab.locator("[data-theme-toggle]").textContent(),
            mode === "dark" ? "Light mode" : "Dark mode",
          );
          return frames.length;
        }
        const toggle = () => tab.locator("[data-theme-toggle]").click();
        const navigation = [];
        await tab.goto(`${site}/`);
        navigation.push(await expectPainted("/", "strawberry", "dark", "Lora"));
        // Switch on the portfolio, then follow real links between page types.
        await toggle();
        await tab
          .getByRole("link", { name: "Read case study: Theme demo" })
          .click();
        navigation.push(
          await expectPainted(PAGES[1], "strawberry", "light", "Lora"),
        );
        await toggle();
        await tab.getByRole("link", { name: "Back to portfolio" }).click();
        navigation.push(await expectPainted("/", "strawberry", "dark", "Lora"));
        await tab
          .getByRole("link", { name: "View resume", exact: true })
          .click();
        navigation.push(
          await expectPainted("/resume", "strawberry", "dark", "Lora"),
        );
        await toggle();
        await tab.getByRole("link", { name: "Back to portfolio" }).click();
        navigation.push(
          await expectPainted("/", "strawberry", "light", "Lora"),
        );
        await tab.reload();
        navigation.push(
          await expectPainted("/", "strawberry", "light", "Lora"),
        );
        await tab.screenshot({
          path: join(evidence, "appearance-strawberry-light.png"),
        });
        assert.deepEqual(errors, []);
        const lora = font("lora");
        assert.ok(fonts.length > 0);
        for (const entry of fonts) {
          assert.equal(entry.status, 200);
          assert.equal(entry.sha256, lora.sha256, "published Lora bytes");
          assert.match(entry.url, /lora-variable\.ttf$/);
        }

        // Change to System with another preset and font; the next Publish
        // applies it to every page and leaves content and order unchanged.
        await page.getByRole("button", { name: "Style", exact: true }).click();
        await choose("coffee", "manrope", "system");
        await page.getByRole("button", { name: "Build", exact: true }).click();
        await publish();
        // Owner asset URLs name their publication candidate; everything else
        // in the body must be byte-identical across the two appearances.
        const body = (html) =>
          html
            .slice(html.indexOf("<body>"), html.lastIndexOf("</body>"))
            .replace(/\/candidate\/[^/]+\//g, "/candidate/*/");
        for (const path of PAGES) {
          const html = await (await publicRead(`${site}${path}`)).text();
          assert.match(
            html,
            /<html lang="en" data-theme="coffee" data-font="manrope" data-initial-mode="system">/,
          );
          assert.equal(body(html), body(documents[path]), `${path} content`);
        }
        const systemCases = [];
        for (const system of ["dark", "light"]) {
          await tab.emulateMedia({ colorScheme: system });
          await tab.evaluate(() => localStorage.clear());
          for (const path of PAGES) {
            await tab.goto(`${site}${path}`);
            const mode = resolvedMode({ initial: "system", system });
            systemCases.push({
              path,
              system,
              frames: await expectPainted(path, "coffee", mode, "Manrope"),
            });
            await toggle();
            assert.equal(
              await tab.evaluate(
                () => document.documentElement.dataset.colorMode,
              ),
              mode === "dark" ? "light" : "dark",
              `${path} switch`,
            );
            await tab.evaluate(() => localStorage.clear());
          }
        }
        assert.deepEqual(errors, []);
        const manrope = fonts.filter((entry) =>
          entry.url.endsWith("manrope-variable.ttf"),
        );
        assert.ok(manrope.length > 0);
        for (const entry of manrope)
          assert.equal(entry.sha256, font("manrope").sha256);
        await writeFile(
          join(evidence, "appearance-results.json"),
          `${JSON.stringify({ navigation, systemCases, fonts }, null, 2)}\n`,
        );
      } finally {
        await visitor.close();
      }
    },
  );
}
