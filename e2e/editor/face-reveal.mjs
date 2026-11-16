import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  checkTrace,
  comparable,
  exercise,
  snapshot,
} from "./face-reveal-renderer-browser.mjs";

// Phase 38: Face Reveal and visitor playback from the editor preview to a
// real published page, then withdrawal of the second photo. Disabling Face
// Reveal and republishing removes the photo from public storage and the
// cache path while the private draft asset stays ready for reuse.

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

async function axeViolations(target, selector) {
  await target.evaluate(
    await readFile(
      createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
      "utf8",
    ),
  );
  return target.evaluate(
    async (selector) =>
      (
        await window.axe.run(
          { include: [[selector]] },
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
    selector,
  );
}

export async function checkFaceRevealJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  browserOrigin,
  evidence,
}) {
  await run(
    "Face Reveal and playback match between preview and the published page, and disabling withdraws the public photo",
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
        name: "Reveal owner",
        bio: "My avatar has a second side.",
        faceReveal: { enabled: false },
      };
      await boot(draft);
      const page = getPage();
      const checklist = page.getByRole("region", {
        name: "Publication checklist",
      });
      for (const [purpose, color] of [
        ["avatar", "#6b8f2a"],
        ["banner", "#222222"],
      ]) {
        await page
          .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`))
          .setInputFiles({
            name: `${purpose}.png`,
            mimeType: "image/png",
            buffer: await canvasPng(page, color),
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
      await page.getByLabel("Address name").fill("reveal-site");
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
      const site = "https://reveal-site.hasaweb.site";
      const flush = () =>
        page.evaluate(() =>
          window.editorFixture.recovery.store
            .getState()
            .controller.flushValid(),
        );
      const saved = async () => {
        await flush();
        return JSON.parse(
          (
            await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId])
          )[0].draft,
        );
      };
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
      async function publish() {
        await flush();
        await checklist
          .getByRole("button", { name: /^(Retry )?Publish$/ })
          .click();
        await checklist
          .getByText("Publication complete.", { exact: true })
          .waitFor({ timeout: 120000 });
      }
      const preview = () =>
        page
          .frames()
          .find((frame) => frame.url().includes("/private/editor-preview"));

      // Hands with Face Reveal on and a described, cropped second photo.
      const extras = page.getByRole("region", {
        name: "Avatar decoration and Face Reveal",
        exact: true,
      });
      await extras
        .getByRole("group", { name: "Avatar decoration", exact: true })
        .getByRole("radio", { name: "Hands" })
        .check();
      const face = extras.getByRole("group", {
        name: "Face Reveal",
        exact: true,
      });
      await face.getByRole("checkbox").check();
      await page.getByLabel("Upload Face Reveal photo").setInputFiles({
        name: "face.png",
        mimeType: "image/png",
        buffer: await canvasPng(page, "#c0306a"),
      });
      await page
        .getByRole("dialog", { name: "Adjust Face Reveal photo" })
        .waitFor();
      await page
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      const upload = page.getByRole("region", {
        name: "Face Reveal photo image",
        exact: true,
      });
      await upload
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor({ timeout: 60000 });
      await upload
        .getByLabel("Face Reveal photo description")
        .fill("My real face");
      const faceAsset = (await saved()).profile.faceReveal.image.assetId;
      await preview().waitForFunction(() => {
        const photo = document.querySelector(".pf-image-face");
        return photo?.dataset.assetState === "ready";
      });

      // The owner tests the reveal and playback in preview.
      const previewTrace = await exercise(page, preview());
      checkTrace("reveal-hands", previewTrace);
      const previewImage = await preview().evaluate(
        () => document.querySelector(".pf-image-face img").alt,
      );
      assert.equal(previewImage, "My real face");
      // Preview testing changes nothing in the saved draft.
      assert.equal((await saved()).profile.faceReveal.enabled, true);

      await publish();
      const home = await publicRead(`${site}/`);
      assert.equal(home.status, 200);
      const html = await home.text();
      assert.ok(html.includes("data-face-reveal"));
      assert.ok(html.includes('alt="My real face"'));
      const faceUrl = new URL(
        /<div class="pf-image pf-image-face[^>]*><img src="([^"]+)"/.exec(
          html,
        )[1],
      ).href;
      assert.ok(faceUrl.endsWith(`/assets/${faceAsset}`));
      // Published means publicly fetchable before any reveal.
      const fetched = await publicRead(faceUrl);
      assert.equal(fetched.status, 200);
      assert.match(fetched.headers.get("Cache-Control"), /no-store/);

      // A real visitor on the published page.
      const visitor = await page
        .context()
        .browser()
        .newContext({
          viewport: { width: 1280, height: 900 },
        });
      const requested = [];
      try {
        await visitor.route(
          /^https:\/\/[^/]+\.hasaweb\.site\//,
          async (route) => {
            const url = route.request().url();
            requested.push(url);
            const response = await publicRead(url, route.request().method());
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
        const errors = [];
        tab.on("pageerror", (error) => errors.push(error.message));
        await tab.goto(`${site}/`);
        await tab.waitForFunction(() =>
          [
            ...document.querySelectorAll(".pf-avatar-portraitButton .pf-image"),
          ].every((slot) => slot.dataset.assetState === "ready"),
        );
        const publicTrace = await exercise(tab, tab);
        checkTrace("reveal-hands", publicTrace);
        assert.deepEqual(
          comparable(publicTrace),
          comparable(previewTrace),
          "the published page behaves like the editor preview",
        );
        assert.deepEqual(await axeViolations(tab, ".pf-avatar-envelope"), []);
        await tab.locator(".pf-profile").screenshot({
          path: `${evidence}/face-reveal-published.png`,
        });
        // Every load starts on the original avatar.
        await tab.locator("button[data-face-reveal]").click();
        await tab.reload();
        const reloaded = await snapshot(tab);
        assert.equal(reloaded.reveal.photo, "false");
        assert.equal(reloaded.reveal.label, "Reveal face");
        assert.equal(reloaded.playback, "playing");
        assert.deepEqual(errors, []);

        // Warm the second photo in a real browser cache through the plain
        // (unrouted) public proxy, as a visitor would have it.
        const cacheContext = await page.context().browser().newContext();
        const cachePage = await cacheContext.newPage();
        const cached = [faceUrl, `${faceUrl}?variant=warm`].map(
          (url) => `${browserOrigin}/_public?target=${encodeURIComponent(url)}`,
        );
        for (const url of cached) {
          const warm = await cachePage.goto(url);
          assert.equal(warm.status(), 200);
          assert.match(warm.headers()["cache-control"], /no-store/);
        }

        // Disable Face Reveal and republish: the hands keep playing.
        await face.getByRole("checkbox").uncheck();
        await face.getByText(/saved privately in this draft/).waitFor();
        await preview().waitForFunction(
          () => !document.querySelector("button[data-face-reveal]"),
        );
        await publish();
        const after = await (await publicRead(`${site}/`)).text();
        assert.ok(!after.includes("data-face-reveal"));
        assert.ok(!after.includes(faceAsset));
        assert.ok(!after.includes("My real face"));
        assert.ok(after.includes("data-avatar-playback"));
        for (const url of [faceUrl, `${faceUrl}?variant=warm`]) {
          for (const method of ["GET", "HEAD"]) {
            const gone = await publicRead(url, method);
            assert.equal(gone.status, 404, `${method} ${url}`);
            assert.match(gone.headers.get("Cache-Control"), /no-store/);
          }
        }
        for (const url of cached)
          assert.equal((await cachePage.goto(url)).status(), 404);
        await cacheContext.close();
        const object = await authority(
          `/__fixture/public-object?key=${encodeURIComponent(new URL(faceUrl).pathname.slice(1))}`,
        );
        assert.equal((await object.json()).exists, false);

        // The production cleanup path purges and refuses to finish while a
        // cached copy is still observable, then completes once it is gone.
        const operation = (
          await sql(
            "SELECT id FROM publication_operation WHERE portfolio_id=? ORDER BY created_at DESC LIMIT 1",
            [portfolioId],
          )
        )[0].id;
        await sql(
          "UPDATE publication_operation SET completed_at=NULL,cleanup_cursor='verify:',cleanup_attempts=0,next_attempt_at=0 WHERE id=?",
          [operation],
        );
        const stale = await authority(
          `/__fixture/withdraw-check?id=${operation}`,
        );
        assert.equal(stale.status, 503);
        // A cached copy of the photo itself blocks completion.
        assert.deepEqual(
          (await stale.json()).observed.filter(
            (url) => !url.startsWith("https://api.cloudflare.com/"),
          ),
          [faceUrl],
        );
        assert.equal(
          (
            await sql(
              "SELECT completed_at FROM publication_operation WHERE id=?",
              [operation],
            )
          )[0].completed_at,
          null,
        );
        const observedUrls = [];
        for (let attempt = 0; attempt < 8; attempt++) {
          await sql(
            "UPDATE publication_operation SET next_attempt_at=0 WHERE id=?",
            [operation],
          );
          const verified = await authority(
            `/__fixture/withdraw-check?id=${operation}`,
            { headers: { "X-Fixture-Verified": "true" } },
          );
          assert.equal(verified.status, 200);
          observedUrls.push(...(await verified.json()).observed);
          if (
            (
              await sql(
                "SELECT completed_at FROM publication_operation WHERE id=?",
                [operation],
              )
            )[0].completed_at !== null
          )
            break;
        }
        assert.notEqual(
          (
            await sql(
              "SELECT completed_at FROM publication_operation WHERE id=?",
              [operation],
            )
          )[0].completed_at,
          null,
          "withdrawal cleanup completes after observed absence",
        );
        // Completion followed observed absence of the photo and its warmed
        // query variant.
        for (const url of [faceUrl, `${faceUrl}?variant=warm`])
          assert.ok(observedUrls.includes(url), url);

        // The visitor's next load has no reveal and never requests the photo.
        requested.length = 0;
        await tab.reload();
        const withdrawn = await snapshot(tab);
        assert.equal(withdrawn.reveal, null);
        assert.equal(withdrawn.secondImage, false);
        assert.equal(withdrawn.cue, false);
        assert.deepEqual(withdrawn.control, {
          hidden: false,
          name: "Pause animation",
        });
        assert.ok(!requested.some((url) => url.includes(faceAsset)));
      } finally {
        await visitor.close();
      }

      // The private draft keeps the ready photo for reuse, readable only by
      // its owner.
      const kept = await saved();
      assert.equal(kept.profile.faceReveal.enabled, false);
      assert.equal(kept.profile.faceReveal.image.assetId, faceAsset);
      assert.deepEqual(
        (await sql("SELECT kind,status FROM asset WHERE id=?", [faceAsset]))[0],
        { kind: "face", status: "ready" },
      );
      assert.equal(
        await page.evaluate(
          async (id) =>
            (
              await fetch(`/api/assets/${id}?purpose=face`, {
                cache: "no-store",
              })
            ).status,
          faceAsset,
        ),
        200,
      );
      // The same route answers its owner, so the refusals below are real.
      assert.equal(
        (await authority(`/api/assets/${faceAsset}?purpose=face`)).status,
        200,
      );
      for (const session of ["none", "bob"])
        assert.notEqual(
          (
            await authority(
              `/api/assets/${faceAsset}?purpose=face`,
              {},
              session,
            )
          ).status,
          200,
          `${session} cannot read the retained draft photo`,
        );
      await face.getByRole("checkbox").check();
      await upload
        .getByRole("button", { name: "Remove Face Reveal photo" })
        .waitFor();
      assert.equal((await saved()).profile.faceReveal.image.assetId, faceAsset);
    },
  );
}
