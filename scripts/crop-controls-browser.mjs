import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkCropControls({
  getPage,
  context,
  boot,
  displayed,
  frame,
  sql,
  run,
  evidence,
}) {
  async function original() {
    return Buffer.from(
      await getPage().evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 600;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#eb3226";
        ctx.fillRect(0, 0, 400, 600);
        ctx.fillStyle = "#1eb54b";
        ctx.fillRect(400, 0, 400, 600);
        ctx.fillStyle = "#2448e8";
        ctx.fillRect(800, 0, 400, 600);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }),
    );
  }
  async function select(purpose, buffer) {
    await getPage()
      .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`), { exact: true })
      .setInputFiles({ name: "original.png", mimeType: "image/png", buffer });
    await getPage()
      .getByRole("dialog", { name: `Adjust ${purpose}` })
      .waitFor();
  }
  async function current(purpose) {
    return getPage().evaluate(
      (purpose) =>
        window.editorFixture.recovery.store
          .getState()
          .controller.store.getState().working.profile[purpose],
      purpose,
    );
  }
  async function flush() {
    await getPage().evaluate(() =>
      window.editorFixture.recovery.store.getState().controller.flushValid(),
    );
    await displayed();
  }
  async function apply(purpose) {
    await getPage()
      .getByRole("button", { name: "Apply crop", exact: true })
      .click();
    await getPage()
      .getByRole("region", {
        name: `${purpose === "avatar" ? "Avatar" : "Banner"} image`,
        exact: true,
      })
      .getByText("Upload complete. Your draft image is ready.")
      .waitFor();
    await flush();
    return current(purpose);
  }
  async function pixels(url) {
    return getPage().evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`private image ${response.status}`);
      const image = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const rgb = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      return {
        width: image.width,
        height: image.height,
        left: rgb(5, image.height / 2),
        center: rgb(image.width / 2, image.height / 2),
        right: rgb(image.width - 5, image.height / 2),
      };
    }, url);
  }
  await run(
    "crop avatar keyboard geometry, Reset, ready save and private preview",
    async () => {
      await boot();
      const source = await original();
      const before = await current("avatar");
      await select("avatar", source);
      assert.deepEqual(
        await current("avatar"),
        before,
        "opening a crop does not replace a ready reference",
      );
      const page = getPage();
      const zoom = page.getByRole("slider", { name: "Zoom", exact: true });
      await zoom.focus();
      await zoom.press("End");
      assert.equal(await zoom.inputValue(), "4");
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      assert.equal(await zoom.inputValue(), "1");
      const stage = page.getByRole("button", {
        name: "Reposition image",
        exact: true,
      });
      await stage.focus();
      await stage.press("Shift+ArrowLeft");
      await stage.press("Shift+ArrowLeft");
      await stage.press("Shift+ArrowLeft");
      await stage.press("Shift+ArrowLeft");
      await stage.press("Shift+ArrowLeft");
      const geometry = await stage.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        border: getComputedStyle(el).borderWidth,
        padding: getComputedStyle(el).padding,
      }));
      assert.ok(
        Math.abs(geometry.width / geometry.height - 212 / 220) < 0.001,
        "avatar selection matches renderer ratio",
      );
      assert.equal(geometry.padding, "0px");
      const action = await page
        .getByRole("button", { name: "Apply crop", exact: true })
        .evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          radius: Number.parseFloat(getComputedStyle(element).borderRadius),
        }));
      assert.ok(action.height >= 48 && action.radius >= action.height / 2);
      await page.getByRole("dialog").screenshot({
        path: join(evidence, "crop-avatar-desktop.png"),
      });
      const reference = await apply("avatar");
      assert.equal(reference.accepted, true);
      assert.notEqual(reference.assetId, before?.assetId);
      const url = `/api/assets/${reference.assetId}?purpose=avatar`;
      const saved = await pixels(url);
      assert.deepEqual([saved.width, saved.height], [848, 880]);
      assert.ok(
        saved.center[2] > 200 && saved.center[0] < 70,
        "the saved crop centers on the chosen blue region",
      );
      assert.ok(
        saved.left[1] > 140 && saved.left[0] < 70,
        "left crop edge contains the original green region",
      );
      await page
        .getByLabel("Avatar description", { exact: true })
        .fill("Blue and green portrait test");
      await flush();
      const privateFrame = frame();
      await privateFrame
        .locator(`img[src$="${reference.assetId}?purpose=avatar"]`)
        .waitFor();
      assert.equal(
        await privateFrame
          .locator(`img[src$="${reference.assetId}?purpose=avatar"]`)
          .getAttribute("alt"),
        "Blue and green portrait test",
      );
      assert.equal(
        await page.evaluate(
          async (url) =>
            (await fetch(url.replace("purpose=avatar", "purpose=banner")))
              .status,
          url,
        ),
        404,
        "an owned wrong-purpose image is unavailable",
      );
      assert.equal(
        await page.evaluate(
          async (url) =>
            (await fetch(url.replace("purpose=avatar", "purpose=unknown")))
              .status,
          url,
        ),
        404,
      );
      assert.equal(
        await page.evaluate(
          async (url) => (await fetch(url.split("?")[0])).status,
          url,
        ),
        200,
        "existing private read remains compatible",
      );
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await displayed();
      assert.equal((await current("avatar")).assetId, reference.assetId);
      await page
        .getByRole("button", { name: "Crop avatar", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      assert.match(
        await page.getByRole("dialog").innerText(),
        /reselect the original file/,
      );
      const local = await page
        .locator(".image-crop-source")
        .evaluate((el) => [el.naturalWidth, el.naturalHeight]);
      assert.deepEqual(
        local,
        [848, 880],
        "reopening contains only the saved crop",
      );
      await page.keyboard.press("Escape");
      assert.equal((await current("avatar")).assetId, reference.assetId);
      assert.equal(
        await page
          .getByRole("button", { name: "Crop avatar", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
        "cancel returns focus to the invoking control",
      );
    },
  );
  await run("crop banner pointer and mobile dialog focus", async () => {
    await boot();
    await getPage().setViewportSize({ width: 390, height: 844 });
    await select("banner", await original());
    const page = getPage();
    const stage = page.getByRole("button", {
      name: "Reposition image",
      exact: true,
    });
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 20,
      box.y + box.height / 2 + 30,
    );
    await page.mouse.up();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.getByRole("button", { name: "Apply crop", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByRole("button", { name: "Close crop dialog", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
      "crop dialog wraps keyboard focus",
    );
    const overflow = await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false, "mobile modal has no horizontal overflow");
    await page.getByRole("dialog").screenshot({
      path: join(evidence, "crop-banner-mobile.png"),
    });
    const reference = await apply("banner");
    const saved = await pixels(
      `/api/assets/${reference.assetId}?purpose=banner`,
    );
    assert.deepEqual([saved.width, saved.height], [1600, 480]);
    assert.ok(
      saved.left[0] > 200 && saved.center[1] > 140 && saved.right[2] > 200,
      "saved banner preserves the selected full-width crop",
    );
    await page.setViewportSize({ width: 1500, height: 1000 });
  });
  await run(
    "crop failed replacement retries and cancellation preserves ready bytes",
    async () => {
      await boot();
      const source = await original();
      await select("avatar", source);
      const previous = await apply("avatar");
      const before = await pixels(
        `/api/assets/${previous.assetId}?purpose=avatar`,
      );
      const page = getPage();
      await page.route("**/api/assets", (route) =>
        route.fulfill({ status: 503, body: "" }),
      );
      await page.getByLabel("Replace avatar", { exact: true }).setInputFiles({
        name: "replacement.png",
        mimeType: "image/png",
        buffer: source,
      });
      await page.getByRole("dialog").waitFor();
      await page
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Retry upload", exact: true })
        .waitFor();
      assert.deepEqual(await current("avatar"), previous);
      assert.deepEqual(
        await pixels(`/api/assets/${previous.assetId}?purpose=avatar`),
        before,
      );
      await page.unroute("**/api/assets");
      await page
        .getByRole("button", { name: "Retry upload", exact: true })
        .click();
      await page
        .getByText("Upload complete. Your draft image is ready.", {
          exact: true,
        })
        .waitFor();
      await flush();
      const retried = await current("avatar");
      assert.notEqual(retried.assetId, previous.assetId);
      const cropRead = (url) =>
        url.pathname === `/api/assets/${retried.assetId}` &&
        url.searchParams.get("purpose") === "avatar";
      let releaseRead;
      let startedRead;
      let finishedRead;
      const heldRead = new Promise((resolve) => {
        releaseRead = resolve;
      });
      const reading = new Promise((resolve) => {
        startedRead = resolve;
      });
      const readDone = new Promise((resolve) => {
        finishedRead = resolve;
      });
      await page.route(cropRead, async (route) => {
        startedRead();
        await heldRead;
        await route.abort().catch(() => {});
        finishedRead();
      });
      await page
        .getByRole("button", { name: "Crop avatar", exact: true })
        .click();
      await reading;
      await page
        .getByRole("button", { name: "Cancel image selection", exact: true })
        .click();
      assert.equal((await current("avatar")).assetId, retried.assetId);
      releaseRead();
      await readDone;
      await page.unroute(cropRead);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page.getByRole("dialog").count(),
        0,
        "a cancelled read cannot open a late crop dialog",
      );
      assert.equal(
        (await current("avatar")).assetId,
        retried.assetId,
        "cancelling image preparation preserves the ready reference",
      );
      let finish;
      const held = new Promise((resolve) => {
        finish = resolve;
      });
      await page.route("**/api/assets", async (route) => {
        await held;
        await route.abort().catch(() => {});
      });
      await page.getByLabel("Replace avatar", { exact: true }).setInputFiles({
        name: "another.png",
        mimeType: "image/png",
        buffer: source,
      });
      await page.getByRole("dialog").waitFor();
      await page
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Cancel upload", exact: true })
        .waitFor();
      assert.equal(
        (await current("avatar")).assetId,
        retried.assetId,
        "pending bytes do not become references",
      );
      await page
        .getByRole("button", { name: "Cancel upload", exact: true })
        .click();
      finish();
      await page.unroute("**/api/assets");
      assert.equal((await current("avatar")).assetId, retried.assetId);
      assert.deepEqual(
        await pixels(`/api/assets/${previous.assetId}?purpose=avatar`),
        before,
        "draft replacements never mutate prior immutable bytes",
      );
      await page
        .getByRole("button", { name: "Remove avatar", exact: true })
        .click();
      await flush();
      assert.equal(await current("avatar"), undefined);
      assert.deepEqual(
        await pixels(`/api/assets/${previous.assetId}?purpose=avatar`),
        before,
        "draft removal leaves previous asset bytes intact",
      );
      const rows = await sql("SELECT kind,status FROM asset WHERE id=?", [
        retried.assetId,
      ]);
      assert.equal(rows[0].status, "ready");
      await context.addCookies([
        { name: "fixture-session", value: "bob", url: page.url() },
      ]);
      assert.equal(
        await page.evaluate(
          async (id) =>
            (await fetch(`/api/assets/${id}?purpose=avatar`)).status,
          retried.assetId,
        ),
        404,
      );
      await context.addCookies([
        { name: "fixture-session", value: "none", url: page.url() },
      ]);
      assert.equal(
        await page.evaluate(
          async (id) =>
            (await fetch(`/api/assets/${id}?purpose=avatar`)).status,
          retried.assetId,
        ),
        404,
      );
      await context.addCookies([
        { name: "fixture-session", value: "alice", url: page.url() },
      ]);
    },
  );
  await run(
    "crop rejects unsupported, oversized and undecodable selections",
    async () => {
      await boot();
      const page = getPage();
      const before = await current("avatar");
      const input = page.getByLabel(/^(Upload|Replace) avatar$/, {
        exact: true,
      });
      for (const test of [
        {
          name: "not.gif",
          mimeType: "image/gif",
          buffer: Buffer.from("gif"),
          message: "Choose a JPEG, PNG or WebP image.",
        },
        {
          name: "huge.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(5_242_881),
          message: "Choose an image of 5 MiB or less.",
        },
        {
          name: "renamed-gif.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            "base64",
          ),
          message:
            "This image could not be opened. Choose another JPEG, PNG or WebP file.",
        },
        {
          name: "broken.png",
          mimeType: "image/png",
          buffer: Buffer.from("not actually pixels"),
          message:
            "This image could not be opened. Choose another JPEG, PNG or WebP file.",
        },
      ]) {
        await input.setInputFiles({
          name: test.name,
          mimeType: test.mimeType,
          buffer: test.buffer,
        });
        await page
          .getByRole("alert")
          .getByText(test.message, { exact: true })
          .waitFor();
        assert.deepEqual(await current("avatar"), before);
        assert.equal(await page.getByRole("dialog").count(), 0);
      }
    },
  );
}
