import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkPublishJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  context,
  browserOrigin,
  evidence,
}) {
  await run(
    "profile-only publish, lost acknowledgements, reopen, republish and withdrawal",
    async () => {
      await boot();
      const draft = await getPage().evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      draft.profile.name = "Publication owner";
      draft.profile.bio = "A profile published through the saved editor.";
      draft.profile.faceReveal = { enabled: false };
      delete draft.profile.avatar;
      delete draft.profile.banner;
      delete draft.profile.decorationId;
      draft.components = [];
      draft.links = [
        {
          id: "website",
          kind: "website",
          label: "My website",
          value: "https://example.com",
          showInProfile: true,
          showInSocialComponent: false,
        },
      ];
      draft.samples = {};
      draft.seo = {};
      draft.appearance = {
        themeId: "leaf",
        fontId: "dm-sans",
        colorMode: "system",
      };
      await boot(draft);
      const page = getPage();
      const checklist = page.getByRole("region", {
        name: "Publication checklist",
      });
      const image = Buffer.from(
        await page.evaluate(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 600;
          canvas.height = 300;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#bdeb70";
          ctx.fillRect(0, 0, 600, 300);
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }),
      );
      async function upload(purpose, bytes = image) {
        await page
          .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`), {
            exact: true,
          })
          .setInputFiles({
            name: "owner.png",
            mimeType: "image/png",
            buffer: bytes,
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
      await upload("avatar");
      await upload("banner");
      const address = page.getByLabel("Address name");
      await address.fill("publication-first");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      const portfolio = (
        await sql(
          "SELECT id,first_editor_entered_at FROM portfolio WHERE user_id='draft-alice'",
        )
      )[0];
      await sql(
        "INSERT INTO reserved_subdomain(name) VALUES('publication-taken')",
      );
      await address.fill("publication-taken");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("That name is reserved. Choose another name.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        (
          await sql("SELECT name FROM subdomain_claim WHERE portfolio_id=?", [
            portfolio.id,
          ])
        )[0].name,
        "publication-first",
      );
      await address.fill("publication-final");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        (
          await sql(
            "SELECT first_editor_entered_at FROM portfolio WHERE id=?",
            [portfolio.id],
          )
        )[0].first_editor_entered_at,
        portfolio.first_editor_entered_at,
      );

      await address.fill("unfinished-");
      await checklist
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await checklist
        .getByRole("alert")
        .filter({ hasText: "unsaved input" })
        .waitFor();
      assert.equal(
        (
          await sql(
            "SELECT count(*) AS n FROM publication_operation WHERE portfolio_id=?",
            [portfolio.id],
          )
        )[0].n,
        0,
      );
      await address.fill("publication-final");
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();

      const meta = (
        await sql("SELECT draft_rev FROM portfolio WHERE id=?", [portfolio.id])
      )[0];
      for (const [session, expected, body, status] of [
        ["none", "draft-alice", { portfolioId: portfolio.id }, 401],
        ["alice", "draft-bob", { portfolioId: portfolio.id }, 409],
        [
          "bob",
          "draft-bob",
          {
            portfolioId: portfolio.id,
            revision: meta.draft_rev,
            operationId: crypto.randomUUID(),
          },
          409,
        ],
      ]) {
        const response = await authority(
          "/api/owner/publication/start",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Expected-Owner-Id": expected,
            },
            body: JSON.stringify(body),
          },
          session,
        );
        assert.equal(response.status, status);
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
      }
      const commandHeaders = {
        "Content-Type": "application/json",
        "X-Expected-Owner-Id": "draft-alice",
      };
      for (const [body, status] of [
        [
          {
            portfolioId: portfolio.id,
            operationId: crypto.randomUUID(),
            revision: meta.draft_rev,
            extra: true,
          },
          422,
        ],
        ["x".repeat(2048), 413],
      ]) {
        assert.equal(
          (
            await authority("/api/owner/publication/start", {
              method: "POST",
              headers: commandHeaders,
              body: typeof body === "string" ? body : JSON.stringify(body),
            })
          ).status,
          status,
        );
      }
      let lostStart = false;
      await page.route("**/api/owner/publication/start", async (route) => {
        if (lostStart) return route.continue();
        lostStart = true;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort("connectionreset");
      });
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .click();
      await checklist
        .getByRole("alert")
        .filter({ hasText: "Could not finish publication" })
        .waitFor();
      const firstId = (
        await sql("SELECT id FROM publication_operation WHERE portfolio_id=?", [
          portfolio.id,
        ])
      )[0].id;
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .waitFor();
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .click();
      await checklist
        .getByText("Publication complete.", { exact: true })
        .waitFor({ timeout: 120000 });
      assert.equal(
        (
          await sql(
            "SELECT count(*) AS n FROM publication_operation WHERE portfolio_id=?",
            [portfolio.id],
          )
        )[0].n,
        1,
      );
      assert.equal(
        (
          await sql(
            "SELECT id FROM publication_operation WHERE portfolio_id=?",
            [portfolio.id],
          )
        )[0].id,
        firstId,
      );
      const publicUrl = "https://publication-final.hasaweb.site";
      assert.equal(
        await checklist
          .getByRole("link", { name: "Open published portfolio" })
          .getAttribute("href"),
        publicUrl,
      );
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: browserOrigin,
      });
      await checklist
        .getByRole("button", { name: "Copy public URL", exact: true })
        .click();
      await checklist
        .getByRole("button", { name: "Copied", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        publicUrl,
      );
      await context.route("https://*.hasaweb.site/**", async (route) => {
        const response = await authority(
          "/__fixture/public",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: route.request().url() }),
          },
          "none",
        );
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
      const popup = page.waitForEvent("popup");
      await checklist
        .getByRole("link", { name: "Open published portfolio" })
        .click();
      const visitor = await popup;
      await visitor.waitForLoadState();
      assert.equal(visitor.url(), `${publicUrl}/`);
      await visitor.getByText("Publication owner", { exact: true }).waitFor();
      await visitor.close();
      async function publicRead(url = publicUrl, method = "GET") {
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
      const first = await publicRead();
      assert.equal(first.status, 200);
      assert.match(first.headers.get("cache-control"), /no-store/);
      const firstHtml = await first.text();
      assert.ok(firstHtml.includes("Publication owner"));
      const firstDraft = JSON.parse(
        (await sql("SELECT draft FROM portfolio WHERE id=?", [portfolio.id]))[0]
          .draft,
      );
      const oldAvatarUrl = `https://assets.hasaweb.site/candidate/${firstId}/assets/${firstDraft.profile.avatar.assetId}`;
      assert.ok(oldAvatarUrl);
      assert.equal((await publicRead(oldAvatarUrl)).status, 200);
      // This context has no Playwright routing, so browser caching stays enabled.
      const cacheContext = await context.browser().newContext();
      const cachePage = await cacheContext.newPage();
      const cachedUrls = [oldAvatarUrl, `${oldAvatarUrl}?warm=query`].map(
        (url) => `${browserOrigin}/_public?target=${encodeURIComponent(url)}`,
      );
      for (const url of cachedUrls) {
        const warm = await cachePage.goto(url);
        assert.equal(warm.status(), 200);
        assert.match(warm.headers()["cache-control"], /no-store/);
      }
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      assert.equal(
        await page.getByLabel("Name", { exact: true }).inputValue(),
        "Publication owner",
      );
      await page.getByLabel("Name", { exact: true }).fill("Republished owner");
      await upload("avatar");
      let blockedCommit = true;
      await page.route("**/api/owner/publication/commit", async (route) => {
        if (blockedCommit) {
          blockedCommit = false;
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"error":"publication_unavailable"}',
          });
        }
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort("connectionreset");
      });
      await checklist
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await checklist
        .getByRole("alert")
        .filter({ hasText: "Could not finish publication" })
        .waitFor({ timeout: 120000 });
      assert.ok(
        (await (await publicRead()).text()).includes("Publication owner"),
      );
      assert.equal((await publicRead(oldAvatarUrl)).status, 200);
      await sql(
        "INSERT OR REPLACE INTO runtime_probe(key,value) VALUES('publication-withdrawal-failure','true')",
      );
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .click();
      await checklist
        .getByRole("alert")
        .filter({ hasText: "Could not finish publication" })
        .waitFor({ timeout: 120000 });
      await page.unroute("**/api/owner/publication/commit");
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .click();
      await checklist
        .getByRole("alert")
        .filter({ hasText: "withdrawn-file cleanup is pending" })
        .waitFor({ timeout: 120000 });
      assert.equal(
        await checklist
          .getByText("Publication complete.", { exact: true })
          .count(),
        0,
      );
      assert.equal(
        (
          await sql(
            "SELECT completed_at FROM publication_operation WHERE portfolio_id=? ORDER BY created_at DESC LIMIT 1",
            [portfolio.id],
          )
        )[0].completed_at,
        null,
      );
      await sql(
        "DELETE FROM runtime_probe WHERE key='publication-withdrawal-failure'",
      );
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .waitFor();
      await checklist
        .getByRole("button", { name: "Retry Publish", exact: true })
        .click();
      await checklist
        .getByText("Publication complete.", { exact: true })
        .waitFor({ timeout: 120000 });
      const saved = (
        await sql(
          "SELECT draft,subdomain,published_version,first_editor_entered_at FROM portfolio WHERE id=?",
          [portfolio.id],
        )
      )[0];
      assert.equal(saved.published_version, 2);
      assert.equal(saved.subdomain, "publication-final");
      assert.equal(
        saved.first_editor_entered_at,
        portfolio.first_editor_entered_at,
      );
      assert.equal(JSON.parse(saved.draft).profile.name, "Republished owner");
      assert.equal(
        (
          await sql("SELECT state FROM subdomain_claim WHERE portfolio_id=?", [
            portfolio.id,
          ])
        )[0].state,
        "claimed",
      );
      assert.ok(
        (await (await publicRead()).text()).includes("Republished owner"),
      );
      for (const url of [oldAvatarUrl, `${oldAvatarUrl}?warm=query`]) {
        assert.equal((await publicRead(url)).status, 404);
        assert.equal((await publicRead(url, "HEAD")).status, 404);
      }
      for (const url of cachedUrls) {
        const response = await cachePage.goto(url);
        assert.equal(response.status(), 404);
      }
      await cacheContext.close();
      const lastId = (
        await sql(
          "SELECT id FROM publication_operation WHERE portfolio_id=? ORDER BY created_at DESC LIMIT 1",
          [portfolio.id],
        )
      )[0].id;
      await sql(
        "UPDATE publication_operation SET completed_at=NULL,next_attempt_at=0 WHERE id=?",
        [lastId],
      );
      const accepted = await authority(
        `/__fixture/withdraw-check?id=${lastId}`,
      );
      assert.equal(accepted.status, 503);
      assert.equal(
        (
          await sql(
            "SELECT completed_at FROM publication_operation WHERE id=?",
            [lastId],
          )
        )[0].completed_at,
        null,
      );
      await sql(
        "UPDATE publication_operation SET next_attempt_at=0 WHERE id=?",
        [lastId],
      );
      assert.equal(
        (
          await authority(`/__fixture/withdraw-check?id=${lastId}`, {
            headers: { "X-Fixture-Verified": "true" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await sql("SELECT published_version FROM portfolio WHERE id=?", [
            portfolio.id,
          ])
        )[0].published_version,
        2,
      );
      const object = await authority(
        `/__fixture/public-object?key=${encodeURIComponent(new URL(oldAvatarUrl).pathname.slice(1))}`,
      );
      assert.equal((await object.json()).exists, false);
      await page.screenshot({
        path: join(evidence, "published-profile.png"),
        fullPage: true,
      });
    },
  );
}
