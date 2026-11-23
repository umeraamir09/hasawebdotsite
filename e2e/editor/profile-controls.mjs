import assert from "node:assert/strict";
import { join } from "node:path";
import { openSection, resize } from "./shell.mjs";

export async function checkProfileControls({
  getPage,
  context,
  boot,
  displayed,
  frame,
  sql,
  run,
  evidence,
  browserOrigin,
  authority,
}) {
  const provider = "https://avatars.githubusercontent.com/fixture/valid";
  const profile = () =>
    getPage().getByRole("region", { name: "Profile controls", exact: true });
  const avatar = () =>
    getPage().getByRole("region", { name: "Avatar image", exact: true });
  const flush = async () => {
    await getPage().evaluate(() =>
      window.editorFixture.recovery.store.getState().controller.flushValid(),
    );
    await displayed();
  };
  const stored = async () =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'"))[0]
        .draft,
    );
  async function setup() {
    await boot();
    await sql("UPDATE user SET name=?,image=? WHERE id='draft-alice'", [
      "Provider owner",
      provider,
    ]);
  }
  async function suggest() {
    await getPage()
      .getByRole("button", {
        name: "Check my account suggestions",
        exact: true,
      })
      .click();
    await getPage()
      .getByRole("button", { name: "Use this name", exact: true })
      .waitFor();
  }
  async function importPhoto(mode = "valid") {
    await sql("UPDATE user SET image=? WHERE id='draft-alice'", [
      `https://avatars.githubusercontent.com/fixture/${mode}`,
    ]);
    await getPage()
      .getByRole("button", { name: "Use my account photo", exact: true })
      .click();
  }
  await run("profile suggestions are private and owner-scoped", async () => {
    await setup();
    const path = `${browserOrigin}/api/owner?include=profile-suggestions`;
    const normal = await (
      await context.request.get(`${browserOrigin}/api/owner`)
    ).json();
    assert.equal("profileSuggestions" in normal, false);
    for (const [expected, status] of [
      [null, 400],
      ["draft-bob", 409],
      ["draft-alice", 200],
    ]) {
      const response = await context.request.get(path, {
        headers: expected ? { "X-Expected-Owner-Id": expected } : {},
      });
      assert.equal(response.status(), status);
      assert.match(response.headers()["cache-control"], /private.*no-store/);
      if (status === 200) {
        const body = await response.json();
        assert.deepEqual(body.profileSuggestions, {
          name: "Provider owner",
          photoAvailable: true,
        });
        for (const secret of ["image", "email", "accessToken", "session"])
          assert.equal(secret in body, false);
        assert.equal(
          JSON.stringify(body).includes("avatars.githubusercontent.com"),
          false,
        );
      }
    }
    for (const session of ["none", "bob", "expired", "deleting", "revoked"]) {
      if (session === "revoked")
        await sql("DELETE FROM session WHERE id='draft-session-revoked'");
      await context.addCookies([
        { name: "fixture-session", value: session, url: browserOrigin },
      ]);
      const headers = { "X-Expected-Owner-Id": "draft-alice" };
      assert.ok(
        [401, 409].includes(
          (await context.request.get(path, { headers })).status(),
        ),
      );
      assert.equal(
        (
          await context.request.get(
            `${browserOrigin}/api/assets/provider-photo`,
            { headers },
          )
        ).status(),
        404,
      );
    }
    await context.addCookies([
      { name: "fixture-session", value: "alice", url: browserOrigin },
    ]);
    for (const headers of [{}, { "X-Expected-Owner-Id": "draft-bob" }])
      assert.equal(
        (
          await context.request.get(
            `${browserOrigin}/api/assets/provider-photo`,
            { headers },
          )
        ).status(),
        404,
      );
  });
  await run(
    "profile text and explicit provider name acceptance persist and render",
    async () => {
      await setup();
      const before = await stored();
      await suggest();
      assert.equal(
        await profile().getByLabel("Name", { exact: true }).inputValue(),
        before.profile.name,
      );
      assert.equal((await stored()).profile.name, before.profile.name);
      assert.equal(
        (await frame().locator("body").innerText()).includes("Provider owner"),
        false,
      );
      await getPage()
        .getByRole("button", {
          name: "Dismiss account suggestions",
          exact: true,
        })
        .click();
      assert.equal((await stored()).profile.name, before.profile.name);
      await suggest();
      const acceptName = getPage().getByRole("button", {
        name: "Use this name",
        exact: true,
      });
      await acceptName.focus();
      await acceptName.press("Enter");
      const fieldStyle = await profile()
        .getByLabel("Name", { exact: true })
        .evaluate((input) => ({
          height: input.getBoundingClientRect().height,
          fontSize: getComputedStyle(input).fontSize,
        }));
      assert.ok(fieldStyle.height >= 48);
      assert.equal(fieldStyle.fontSize, "16px");
      await profile()
        .getByLabel("Bio", { exact: true })
        .fill("I make useful things.\nFor people everywhere.");
      await profile()
        .getByLabel("Location", { exact: true })
        .fill("Lahore, Pakistan");
      await flush();
      const saved = await stored();
      assert.equal(saved.profile.name, "Provider owner");
      assert.equal(
        saved.profile.bio,
        "I make useful things.\nFor people everywhere.",
      );
      assert.equal(saved.profile.location, "Lahore, Pakistan");
      assert.equal(saved.samples["profile.name"], undefined);
      await frame()
        .getByRole("heading", { name: "Provider owner", exact: true })
        .waitFor();
      assert.ok(
        (await frame().locator("body").innerText()).includes(
          "Lahore, Pakistan",
        ),
      );
      await getPage().reload();
      await getPage().waitForFunction(() => window.editorFixture?.ready);
      assert.equal(
        await profile().getByLabel("Name", { exact: true }).inputValue(),
        "Provider owner",
      );
      await profile().getByLabel("Name", { exact: true }).fill("");
      await profile().getByLabel("Bio", { exact: true }).fill("");
      await profile().getByLabel("Location", { exact: true }).fill("");
      await flush();
      assert.equal((await stored()).profile.name, "");
      await profile()
        .getByText(/Still needed in your profile: name, bio/)
        .waitFor();
    },
  );
  await run(
    "provider photo requires crop acceptance and stores only a ready crop",
    async () => {
      await setup();
      const before = await stored();
      const rowsBefore = await sql("SELECT id FROM asset");
      let external = 0;
      getPage().on("request", (request) => {
        if (/googleusercontent|githubusercontent/.test(request.url()))
          external++;
      });
      await suggest();
      await importPhoto();
      await getPage().getByRole("dialog", { name: "Adjust avatar" }).waitFor();
      assert.deepEqual((await stored()).profile.avatar, before.profile.avatar);
      assert.deepEqual(await sql("SELECT id FROM asset"), rowsBefore);
      await getPage()
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.deepEqual((await stored()).profile.avatar, before.profile.avatar);
      await importPhoto();
      await getPage().getByRole("dialog", { name: "Adjust avatar" }).waitFor();
      await getPage()
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await avatar()
        .getByText("Upload complete. Your draft image is ready.")
        .waitFor();
      await avatar()
        .getByLabel("Avatar description", { exact: true })
        .fill("Green middle of my account photo");
      await flush();
      const saved = await stored();
      assert.equal(saved.profile.avatar.accepted, true);
      assert.equal(
        saved.profile.avatar.alt,
        "Green middle of my account photo",
      );
      assert.notEqual(
        saved.profile.avatar.assetId,
        before.profile.avatar?.assetId,
      );
      const rows = await sql("SELECT id,status,kind FROM asset");
      assert.equal(rows.length, rowsBefore.length + 1);
      assert.deepEqual(
        rows.find((row) => row.id === saved.profile.avatar.assetId),
        { id: saved.profile.avatar.assetId, status: "ready", kind: "avatar" },
      );
      assert.equal(JSON.stringify(saved).includes("githubusercontent"), false);
      const pixels = await getPage().evaluate(async (id) => {
        const image = await createImageBitmap(
          await (await fetch(`/api/assets/${id}?purpose=avatar`)).blob(),
        );
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return {
          width: image.width,
          height: image.height,
          rgb: Array.from(
            ctx.getImageData(image.width / 2, image.height / 2, 1, 1).data,
          ),
        };
      }, saved.profile.avatar.assetId);
      assert.equal(pixels.width, 848);
      assert.equal(pixels.height, 880);
      assert.ok(
        pixels.rgb[1] > 150 && pixels.rgb[0] < 70 && pixels.rgb[2] < 110,
      );
      await displayed();
      await frame()
        .getByAltText("Green middle of my account photo", { exact: true })
        .waitFor();
      await frame()
        .getByAltText("Green middle of my account photo", { exact: true })
        .evaluate((image) => image.decode());
      assert.equal(external, 0);
      await getPage().screenshot({
        path: join(evidence, "profile-provider-crop.png"),
        fullPage: true,
      });
      await getPage().reload();
      await getPage().waitForFunction(() => window.editorFixture?.ready);
      assert.equal(
        await avatar()
          .getByLabel("Avatar description", { exact: true })
          .inputValue(),
        saved.profile.avatar.alt,
      );
      await avatar()
        .getByRole("button", { name: "Remove avatar", exact: true })
        .click();
      await flush();
      assert.equal((await stored()).profile.avatar, undefined);
      assert.equal(
        (
          await context.request.get(
            `${browserOrigin}/api/assets/${saved.profile.avatar.assetId}?purpose=avatar`,
          )
        ).status(),
        200,
      );
    },
  );
  await run(
    "failed provider photos and cancelled imports preserve the previous avatar",
    async () => {
      await setup();
      await suggest();
      const before = (await stored()).profile.avatar;
      for (const mode of [
        "redirect",
        "missing",
        "mime",
        "magic",
        "oversize",
        "decode",
      ]) {
        await importPhoto(mode);
        await avatar().getByRole("alert").waitFor();
        assert.deepEqual((await stored()).profile.avatar, before, mode);
        assert.equal(await getPage().getByRole("dialog").count(), 0);
      }
      await importPhoto("slow");
      await avatar()
        .getByRole("button", { name: "Cancel image selection", exact: true })
        .click();
      await importPhoto("valid");
      await getPage().getByRole("dialog", { name: "Adjust avatar" }).waitFor();
      await getPage()
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.deepEqual((await stored()).profile.avatar, before);
      await sql("UPDATE user SET image=? WHERE id='draft-alice'", [
        "https://lh3.googleusercontent.com/fixture/valid",
      ]);
      await getPage()
        .getByRole("button", { name: "Use my account photo", exact: true })
        .click();
      await getPage().getByRole("dialog", { name: "Adjust avatar" }).waitFor();
      await getPage()
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.deepEqual((await stored()).profile.avatar, before);
      await sql("UPDATE user SET image=NULL WHERE id='draft-alice'");
      await getPage()
        .getByRole("button", {
          name: "Check my account suggestions",
          exact: true,
        })
        .click();
      await profile()
        .getByText(
          "Your account has no supported photo. Upload an avatar below.",
        )
        .waitFor();
      assert.equal(
        await getPage()
          .getByRole("button", { name: "Use my account photo", exact: true })
          .count(),
        0,
      );
      await resize(getPage(), { width: 390, height: 844 });
      await openSection(getPage(), "Profile");
      await getPage().screenshot({
        path: join(evidence, "profile-mobile.png"),
        fullPage: true,
      });
      assert.ok(
        await getPage().evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await resize(getPage(), { width: 1500, height: 1000 });
    },
  );
  await run(
    "provider photo aborts a provider that never responds",
    async () => {
      await setup();
      await sql("UPDATE user SET image=? WHERE id='draft-alice'", [
        "https://avatars.githubusercontent.com/fixture/timeout",
      ]);
      const response = await context.request.get(
        `${browserOrigin}/api/assets/provider-photo`,
        { headers: { "X-Expected-Owner-Id": "draft-alice" } },
      );
      assert.equal(response.status(), 404);
      assert.equal(await response.text(), "");
    },
  );
  await run(
    "provider photo rechecks revocation before returning source bytes",
    async () => {
      await setup();
      await sql("UPDATE user SET image=? WHERE id='draft-alice'", [
        "https://avatars.githubusercontent.com/fixture/revoke",
      ]);
      const session = (
        await sql("SELECT * FROM session WHERE id='draft-session-alice'")
      )[0];
      const requestsBefore = (
        await (await authority("/__fixture/provider-photo")).json()
      ).requests;
      const pending = context.request.get(
        `${browserOrigin}/api/assets/provider-photo`,
        { headers: { "X-Expected-Owner-Id": "draft-alice" } },
      );
      for (let attempt = 0; ; attempt++) {
        const state = await (
          await authority("/__fixture/provider-photo")
        ).json();
        if (state.requests > requestsBefore) break;
        assert.ok(attempt < 100, "provider fetch must start before revocation");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await sql("DELETE FROM session WHERE id='draft-session-alice'");
      await authority("/__fixture/provider-photo", { method: "POST" });
      try {
        assert.equal((await pending).status(), 404);
      } finally {
        const columns = Object.keys(session);
        await sql(
          `INSERT INTO session(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
          Object.values(session),
        );
      }
    },
  );
}
