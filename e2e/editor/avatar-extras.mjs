import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  chooseDecoration,
  decorationGallery,
  imageOptions,
  openChecklist,
  openPanel,
  setFaceReveal,
} from "./shell.mjs";

// Phase 37: the owner controls for the approved Ginger cat and Hands
// decorations and the optional Face Reveal second photo, from the editor
// through Publish. Public pause/play and the reveal interaction are Phase 38
// (face-reveal-browser.mjs).

// The avatar slot as a canonical tree, without the owner's image URL (private
// in preview, public once published), runtime loading state or attribute
// order. Evaluated in the preview frame or against published markup.
function avatarShape(target, markup) {
  return target.evaluate((html) => {
    const doc = html
      ? new DOMParser().parseFromString(html, "text/html")
      : document;
    const frame = doc.querySelector(".pf-avatar-frame");
    if (!frame) return null;
    const volatile = new Set(["data-asset-state"]);
    function canon(node) {
      if (node.nodeType === 3) return node.textContent.trim();
      if (node.nodeType !== 1) return "";
      if (node.classList.contains("pf-image-status")) return "";
      const owner = node.closest(".pf-avatar-portraitButton") !== null;
      // The platform script reveals the playback control (Phase 38).
      const scripted = node.hasAttribute("data-avatar-playback");
      const attributes = [...node.attributes]
        .filter(
          ({ name }) =>
            !volatile.has(name) &&
            !(owner && /^(src|srcset)$/.test(name)) &&
            !(scripted && name === "hidden"),
        )
        .map(({ name, value }) => `${name}=${value}`)
        .sort()
        .join(" ");
      return `<${node.localName} ${attributes}>${[...node.childNodes]
        .map(canon)
        .join("")}</${node.localName}>`;
    }
    return {
      decoration: frame.dataset.decoration,
      html: canon(frame),
      catSrc: frame.querySelector("picture img")?.getAttribute("src") ?? null,
      avatarSrc:
        frame
          .querySelector(".pf-avatar-portraitButton img")
          ?.getAttribute("src") ?? null,
    };
  }, markup ?? null);
}

export async function checkAvatarExtrasJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  evidence,
}) {
  await run(
    "decoration and Face Reveal setup save, preview, validate and publish consistently",
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
        name: "Avatar owner",
        bio: "I decorate my avatar.",
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
      await page.getByLabel("Address name").fill("avatar-site");
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
      const site = "https://avatar-site.hasaweb.site";
      const flush = () =>
        page.evaluate(() =>
          window.editorFixture.recovery.store
            .getState()
            .controller.flushValid(),
        );
      const savedRow = async () => {
        await flush();
        return (
          await sql("SELECT draft FROM portfolio WHERE id=?", [portfolioId])
        )[0].draft;
      };
      const saved = async () => JSON.parse(await savedRow());
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
      async function publish() {
        await flush();
        await (await checklist())
          .getByRole("button", {
            name: /^(Publish|Publish changes|Try again)$/,
          })
          .click();
        await (await checklist())
          .getByText("You're live", { exact: true })
          .waitFor({ timeout: 120000 });
      }
      const preview = () =>
        page
          .frames()
          .find((frame) => frame.url().includes("/private/editor-preview"));
      const previewShape = () => avatarShape(preview(), null);
      async function waitForPreview(decoration) {
        await preview().waitForFunction(
          (expected) =>
            document.querySelector(".pf-avatar-frame")?.dataset.decoration ===
            expected,
          decoration,
        );
      }
      const published = async () => {
        const response = await publicRead(`${site}/`);
        assert.equal(response.status, 200);
        return avatarShape(page, await response.text());
      };

      // Controls live in the editor's profile editor, not in onboarding.
      const profile = page.getByRole("region", {
        name: "Profile controls",
        exact: true,
      });
      await profile.waitFor();
      const faceToggle = profile.getByRole("switch", {
        name: "Face Reveal",
        exact: true,
      });
      const faceIncomplete = () =>
        profile
          .getByRole("alert")
          .getByText(/Add the second photo or turn Face Reveal off/);

      // A new draft has no decoration and Face Reveal off.
      let current = await saved();
      assert.equal("decorationId" in current.profile, false);
      assert.deepEqual(current.profile.faceReveal, { enabled: false });
      assert.equal(
        await profile
          .getByRole("button", { name: /^Decoration\b/ })
          .innerText(),
        "Decoration\nNone",
      );
      let gallery = await decorationGallery(page);
      const decorations = gallery.getByRole("group", {
        name: "Avatar decoration",
        exact: true,
      });
      assert.deepEqual(
        await decorations
          .getByRole("radio")
          .evaluateAll((inputs) => inputs.map((input) => input.value)),
        ["", "cat", "hands"],
      );
      assert.equal(
        await decorations.getByRole("radio", { name: "None" }).isChecked(),
        true,
      );
      // Each tile is the renderer's avatar markup, drawn as a still.
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".decoration-tile-thumb iframe")].every(
          (frame) => frame.contentDocument?.querySelector(".pf-avatar-frame"),
        ),
      );
      assert.deepEqual(
        await gallery.locator("iframe").evaluateAll((frames) =>
          frames.map((frame) => {
            const avatar =
              frame.contentDocument?.querySelector(".pf-avatar-frame");
            return [
              avatar?.dataset.decoration,
              avatar?.dataset.playback ?? null,
              Boolean(frame.contentDocument?.querySelector("button")),
            ];
          }),
        ),
        [
          ["none", null, false],
          ["cat", "paused", false],
          ["hands", "paused", false],
        ],
      );
      assert.equal(await faceToggle.getAttribute("aria-checked"), "false");
      assert.equal(
        await page.getByLabel("Upload Face Reveal photo").count(),
        0,
      );
      await waitForPreview("none");

      // Select, change and remove with the gallery open: the preview behind
      // it follows each choice. The saved value, preview and published page
      // agree, and removal omits the key.
      await decorations.getByRole("radio", { name: "Ginger cat" }).click();
      await waitForPreview("cat");
      current = await saved();
      assert.equal(current.profile.decorationId, "cat");
      const catPreview = await previewShape();
      await decorations.getByRole("radio", { name: "Hands" }).click();
      await waitForPreview("hands");
      current = await saved();
      assert.equal(current.profile.decorationId, "hands");
      const handsPreview = await previewShape();
      assert.notEqual(catPreview.html, handsPreview.html);
      await decorations.getByRole("radio", { name: "None" }).click();
      await waitForPreview("none");
      const rawRemoved = await savedRow();
      assert.equal("decorationId" in JSON.parse(rawRemoved).profile, false);
      assert.equal(rawRemoved.includes("decorationId"), false);
      assert.equal(rawRemoved.includes('"decorationId":null'), false);

      // Keyboard: arrows move between tiles and choose; Escape closes the
      // gallery and returns focus to the Decoration row.
      await decorations.getByRole("radio", { name: "None" }).focus();
      await page.keyboard.press("ArrowRight");
      await waitForPreview("cat");
      assert.equal((await saved()).profile.decorationId, "cat");
      await page.keyboard.press("Escape");
      await gallery.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        "DecorationGinger cat",
      );
      gallery = null;

      // Face Reveal on without a second photo: an error beside the input, and
      // publication blocked.
      await setFaceReveal(page, true);
      await faceIncomplete().waitFor();
      assert.match(
        await profile.innerText(),
        /publicly accessible, even before anyone reveals it/,
      );
      await flush();
      await (await checklist())
        .getByRole("button", { name: /^(Publish|Publish changes|Try again)$/ })
        .click();
      const faceIssue = (await checklist()).getByRole("button", {
        name: /Complete your Face Reveal image/,
      });
      await faceIssue.waitFor({ timeout: 60000 });
      assert.equal(
        await (await checklist()).getByText("You're live").count(),
        0,
      );
      assert.equal(
        (await publicRead(`${site}/`)).status,
        404,
        "nothing is published while Face Reveal is incomplete",
      );

      // Upload, crop and describe the second photo.
      const upload = page.getByRole("region", {
        name: "Face Reveal photo image",
        exact: true,
      });
      await page.getByLabel("Upload Face Reveal photo").setInputFiles({
        name: "face.png",
        mimeType: "image/png",
        buffer: image,
      });
      await page
        .getByRole("dialog", { name: "Adjust Face Reveal photo" })
        .waitFor();
      await page
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await upload
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor({ timeout: 60000 });
      await faceIncomplete().waitFor({ state: "detached" });
      await imageOptions(page, "Face Reveal photo");
      await upload.getByLabel("Face Reveal photo description").fill("Me");
      current = await saved();
      const faceAsset = current.profile.faceReveal.image.assetId;
      assert.match(faceAsset, /^[a-f0-9-]{36}$/);
      assert.equal(current.profile.faceReveal.enabled, true);
      assert.equal(current.profile.faceReveal.image.alt, "Me");
      assert.deepEqual(
        (await sql("SELECT kind,status FROM asset WHERE id=?", [faceAsset]))[0],
        { kind: "face", status: "ready" },
      );
      // The crop is the avatar shape, so both images swap in place.
      const dimensions = await page.evaluate(async (id) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`/api/assets/${id}?purpose=face`)).blob(),
        );
        return [bitmap.width, bitmap.height];
      }, faceAsset);
      assert.deepEqual(dimensions, [848, 880]);
      assert.ok(
        await upload
          .getByRole("button", { name: "Crop Face Reveal photo" })
          .isVisible(),
      );

      // Replace keeps the earlier photo until the new one is ready, and
      // remove returns the enabled add-on to incomplete.
      await imageOptions(page, "Face Reveal photo");
      await upload
        .getByRole("button", { name: "Remove Face Reveal photo" })
        .click();
      await faceIncomplete().waitFor();
      current = await saved();
      assert.equal(current.profile.faceReveal.enabled, true);
      assert.equal("image" in current.profile.faceReveal, false);
      await page.getByLabel("Upload Face Reveal photo").setInputFiles({
        name: "face.png",
        mimeType: "image/png",
        buffer: image,
      });
      await page
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await upload
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor({ timeout: 60000 });
      const secondAsset = (await saved()).profile.faceReveal.image.assetId;
      assert.notEqual(secondAsset, faceAsset);

      // axe finds no WCAG 2.2 AA violations in the new controls.
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
              {
                include: [[".profile-editor-card"], [".profile-editor-rows"]],
              },
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
      await page.screenshot({
        path: `${evidence}/avatar-extras-editor.png`,
        fullPage: true,
      });
      gallery = await decorationGallery(page);
      assert.deepEqual(
        await page.evaluate(async () =>
          (
            await window.axe.run(
              { include: [[".wb-dialog"]] },
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
      await page.screenshot({
        path: `${evidence}/avatar-extras-gallery.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await gallery.waitFor({ state: "detached" });

      // Publish with the cat and Face Reveal on. The published avatar equals
      // the preview, the cat art ships with the version, and the second photo
      // is fetchable only now that it is published.
      await waitForPreview("cat");
      const catShape = await previewShape();
      await publish();
      let live = await published();
      assert.equal(live.decoration, "cat");
      assert.equal(live.html, catShape.html);
      const catArt = live.catSrc;
      assert.equal((await publicRead(`${site}${catArt}`)).status, 200);
      const prefix = live.avatarSrc.replace(/assets\/[^/]+$/, "assets/");
      assert.equal((await publicRead(`${prefix}${secondAsset}`)).status, 200);
      assert.equal((await publicRead(`${prefix}${faceAsset}`)).status, 404);

      // Change to Hands and republish: the cat art leaves the version.
      await chooseDecoration(page, "Hands");
      await waitForPreview("hands");
      const handsShape = await previewShape();
      await publish();
      live = await published();
      assert.equal(live.decoration, "hands");
      assert.equal(live.html, handsShape.html);
      assert.equal(live.catSrc, null);
      assert.equal((await publicRead(`${site}${catArt}`)).status, 404);

      // Remove the decoration and turn Face Reveal off: republishing removes
      // public access to the second photo, and the private draft keeps it.
      await chooseDecoration(page, "None");
      await setFaceReveal(page, false);
      assert.equal(
        await page.getByLabel(/^(Upload|Replace) Face Reveal photo$/).count(),
        0,
      );
      current = await saved();
      assert.equal("decorationId" in current.profile, false);
      assert.deepEqual(current.profile.faceReveal.enabled, false);
      assert.equal(current.profile.faceReveal.image.assetId, secondAsset);
      await waitForPreview("none");
      await publish();
      live = await published();
      assert.equal(live.decoration, "none");
      assert.equal((await publicRead(`${prefix}${secondAsset}`)).status, 404);
      assert.deepEqual(
        (
          await sql("SELECT kind,status FROM asset WHERE id=?", [secondAsset])
        )[0],
        { kind: "face", status: "ready" },
      );

      // Re-enabling restores the retained photo without a new upload.
      await setFaceReveal(page, true);
      await (await imageOptions(page, "Face Reveal photo"))
        .getByRole("button", { name: "Remove Face Reveal photo" })
        .waitFor();
      assert.equal(
        (await saved()).profile.faceReveal.image.assetId,
        secondAsset,
      );
    },
  );
}
