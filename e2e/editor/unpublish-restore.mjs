import assert from "node:assert/strict";

// Phase 48: Unpublish withdraws the public site but keeps the draft and the
// claimed address, which no other account can take; Publish restores it.
export async function checkUnpublishJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
}) {
  await run(
    "unpublish withdraws pages and assets, keeps the claim, and republish restores the address",
    async () => {
      await boot();
      const draft = await getPage().evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      draft.profile.name = "Withdrawn owner";
      draft.profile.bio = "A portfolio that goes offline and comes back.";
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
          ctx.fillStyle = "#e1c7f0";
          ctx.fillRect(0, 0, 600, 300);
          const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }),
      );
      for (const purpose of ["avatar", "banner"]) {
        await page
          .getByLabel(new RegExp(`^(Upload|Replace) ${purpose}$`), {
            exact: true,
          })
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
      // A retried run finds its earlier name permanently claimed.
      const name = `unpublish-${Date.now().toString(36)}`;
      const publicUrl = `https://${name}.hasaweb.site`;
      await page.getByLabel("Address name").fill(name);
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await page
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      const portfolio = (
        await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
      )[0];
      const headers = {
        "Content-Type": "application/json",
        "X-Expected-Owner-Id": "draft-alice",
      };
      const owner = (action, body, session = "alice", extra = {}) =>
        authority(
          `/api/owner/publication/${action}`,
          {
            method: "POST",
            headers: { ...headers, ...extra },
            body: JSON.stringify(body),
          },
          session,
        );
      // Before the first Publish there is nothing to withdraw.
      const early = await owner("unpublish", { portfolioId: portfolio.id });
      assert.equal(early.status, 409);
      assert.deepEqual(await early.json(), { error: "not_published" });
      assert.deepEqual(
        await (await owner("site", { portfolioId: portfolio.id })).json(),
        {
          portfolioId: portfolio.id,
          status: "draft",
          url: null,
          withdrawal: null,
        },
      );
      await checklist
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await checklist
        .getByText("Publication complete.", { exact: true })
        .waitFor({ timeout: 120000 });
      async function publicRead(url = `${publicUrl}/`) {
        return authority(
          "/__fixture/public",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          },
          "none",
        );
      }
      const firstId = (
        await sql("SELECT id FROM publication_operation WHERE portfolio_id=?", [
          portfolio.id,
        ])
      )[0].id;
      const assetId = JSON.parse(
        (await sql("SELECT draft FROM portfolio WHERE id=?", [portfolio.id]))[0]
          .draft,
      ).profile.avatar.assetId;
      const avatarUrl = `https://assets.hasaweb.site/candidate/${firstId}/assets/${assetId}`;
      const live = [
        `${publicUrl}/`,
        `${publicUrl}/sitemap.xml`,
        `${publicUrl}/robots.txt`,
        avatarUrl,
      ];
      for (const url of live)
        assert.equal((await publicRead(url)).status, 200, url);
      assert.ok(
        (await (await publicRead()).text()).includes("Withdrawn owner"),
      );

      // Owner boundaries: sign-in, the expected owner, the exact command.
      for (const [session, extra, body, status] of [
        ["none", {}, { portfolioId: portfolio.id }, 401],
        [
          "alice",
          { "X-Expected-Owner-Id": "draft-bob" },
          { portfolioId: portfolio.id },
          409,
        ],
        [
          "bob",
          { "X-Expected-Owner-Id": "draft-bob" },
          { portfolioId: portfolio.id },
          409,
        ],
        ["alice", {}, { portfolioId: portfolio.id, now: true }, 422],
      ]) {
        const response = await owner("unpublish", body, session, extra);
        assert.equal(response.status, status, `${session} ${status}`);
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
      }
      assert.equal(
        (
          await authority(
            "/api/owner/publication/unpublish",
            { headers },
            "alice",
          )
        ).status,
        405,
      );
      assert.equal((await publicRead()).status, 200);

      // Cancelling keeps the site live.
      const unpublish = checklist.getByRole("button", {
        name: "Unpublish website",
        exact: true,
      });
      await unpublish.click();
      const dialog = page.getByRole("dialog", {
        name: "Unpublish your website?",
      });
      await dialog
        .getByText(
          `Publish again to restore your site at ${name}.hasaweb.site.`,
        )
        .waitFor();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal((await publicRead()).status, 200);
      assert.equal(
        (
          await sql("SELECT status FROM portfolio WHERE id=?", [portfolio.id])
        )[0].status,
        "published",
      );

      await unpublish.click();
      await dialog
        .getByRole("button", { name: "Confirm unpublish", exact: true })
        .click();
      await dialog.waitFor({ state: "detached" });
      await checklist
        .getByText(/^Unpublished\. Your site is offline\./)
        .waitFor();
      assert.equal(
        await checklist
          .getByRole("link", { name: "Open published portfolio" })
          .count(),
        0,
      );
      assert.equal(await unpublish.count(), 0);
      for (const url of [
        ...live,
        `${avatarUrl}?variant=warm`,
        `${publicUrl}/_/github.json`,
        `${publicUrl}/_/contact`,
      ]) {
        const response = await publicRead(url);
        assert.equal(response.status, 404, url);
        assert.match(response.headers.get("cache-control"), /no-store/, url);
        assert.ok(!(await response.text()).includes("Withdrawn owner"), url);
      }
      const kept = (
        await sql(
          "SELECT p.status,p.subdomain,p.published_version,json_extract(p.draft,'$.profile.name') AS owner,c.name,c.state FROM portfolio p JOIN subdomain_claim c ON c.portfolio_id=p.id WHERE p.id=?",
          [portfolio.id],
        )
      )[0];
      assert.deepEqual(kept, {
        status: "unpublished",
        subdomain: name,
        published_version: 1,
        owner: "Withdrawn owner",
        name,
        state: "claimed",
      });
      // The queue consumer deletes the public objects and finishes cleanup.
      let withdrawal;
      for (let n = 0; n < 120; n++) {
        withdrawal = (
          await sql(
            "SELECT completed_at FROM publication_withdrawal WHERE portfolio_id=?",
            [portfolio.id],
          )
        )[0];
        if (withdrawal?.completed_at) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.ok(withdrawal?.completed_at, "unpublish cleanup did not finish");
      const object = await authority(
        `/__fixture/public-object?key=${encodeURIComponent(new URL(avatarUrl).pathname.slice(1))}`,
      );
      assert.equal((await object.json()).exists, false);

      // Another account cannot take the withdrawn address.
      const bobHeaders = {
        "Content-Type": "application/json",
        "X-Expected-Owner-Id": "draft-bob",
      };
      const availability = await authority(
        "/api/owner/draft/address-availability",
        { method: "POST", headers: bobHeaders, body: JSON.stringify({ name }) },
        "bob",
      );
      assert.equal(availability.status, 200);
      assert.equal((await availability.json()).status, "unavailable");
      await authority(
        "/api/owner/portfolio",
        { method: "POST", headers: bobHeaders, body: "{}" },
        "bob",
      );
      try {
        const bob = await (
          await authority(
            "/api/owner/progress",
            { headers: { "X-Expected-Owner-Id": "draft-bob" } },
            "bob",
          )
        ).json();
        const taken = await authority(
          "/api/owner/draft/address",
          {
            method: "POST",
            headers: bobHeaders,
            body: JSON.stringify({
              id: crypto.randomUUID(),
              portfolioId: bob.portfolioId,
              revision: bob.revision,
              context: "content",
              name,
            }),
          },
          "bob",
        );
        assert.equal(taken.status, 409);
        assert.equal((await taken.json()).error, "address_unavailable");
        assert.deepEqual(
          await sql(
            "SELECT portfolio_id,state FROM subdomain_claim WHERE name=?",
            [name],
          ),
          [{ portfolio_id: portfolio.id, state: "claimed" }],
        );
      } finally {
        await sql("DELETE FROM portfolio WHERE user_id='draft-bob'", [], {
          idempotent: true,
        });
      }

      // The state survives a reload, and Publish restores the same address.
      await page.reload();
      await page.waitForFunction(() => window.editorFixture?.ready);
      await checklist
        .getByText(/^Unpublished\. Your site is offline\./)
        .waitFor();
      await page.getByLabel("Name", { exact: true }).fill("Restored owner");
      await page.evaluate(() =>
        window.editorFixture.recovery.store.getState().controller.flushValid(),
      );
      await checklist
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await checklist
        .getByText("Publication complete.", { exact: true })
        .waitFor({ timeout: 120000 });
      assert.equal(
        await checklist
          .getByRole("link", { name: "Open published portfolio" })
          .getAttribute("href"),
        publicUrl,
      );
      await unpublish.waitFor();
      const restored = await publicRead();
      assert.equal(restored.status, 200);
      assert.ok((await restored.text()).includes("Restored owner"));
      assert.deepEqual(
        (
          await sql(
            "SELECT p.status,p.subdomain,p.published_version,c.state FROM portfolio p JOIN subdomain_claim c ON c.portfolio_id=p.id WHERE p.id=?",
            [portfolio.id],
          )
        )[0],
        {
          status: "published",
          subdomain: name,
          published_version: 2,
          state: "claimed",
        },
      );
      const restoredId = (
        await sql(
          "SELECT id FROM publication_operation WHERE portfolio_id=? ORDER BY created_at DESC LIMIT 1",
          [portfolio.id],
        )
      )[0].id;
      assert.equal(
        (
          await publicRead(
            `https://assets.hasaweb.site/candidate/${restoredId}/assets/${assetId}`,
          )
        ).status,
        200,
      );
      // The withdrawn version's asset URL stays gone.
      assert.equal((await publicRead(avatarUrl)).status, 404);
    },
  );
}
