import assert from "node:assert/strict";
import { publishExample } from "../../scripts/example-portfolio/publish.mjs";

// Phase 50: the entry page's example is a real portfolio. `pnpm
// example:publish` (this module, with the runtime's SQL and signing secret)
// uploads, saves, hands off setup and publishes through the product's owner
// and publication routes; the visitor path then serves it at
// example.hasaweb.site like any owner's site.
export async function checkExamplePortfolioJourney({
  run,
  sql,
  origin,
  secrets,
  cookie,
  authority,
  browserOrigin,
  context,
}) {
  const visit = async (target) => {
    const response = await context.request.get(
      `${browserOrigin}/_public?target=${encodeURIComponent(target)}`,
    );
    return {
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    };
  };
  const text = (bytes) =>
    bytes
      .toString("utf8")
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");
  const publish = () =>
    publishExample({
      origin,
      secret: secrets.BETTER_AUTH_SECRET,
      sql,
      cookieName: cookie("alice").split("=")[0],
      headers: { "X-Runtime-Key": secrets.RUNTIME_KEY },
      pollMs: 250,
    });
  const state = async () =>
    (
      await sql(
        `SELECT p.status,p.published_version version,p.subdomain,p.first_editor_entered_at entered,
           c.name,c.state,(SELECT count(*) FROM session WHERE user_id='internal-example') sessions
         FROM portfolio p JOIN subdomain_claim c ON c.portfolio_id=p.id WHERE p.id='internal-example'`,
      )
    )[0];

  await run(
    "the example is held for the internal account and no owner can take it",
    async () => {
      const before = await state();
      assert.equal(before.name, "example");
      assert.ok(["held", "claimed"].includes(before.state));
      assert.equal(
        (
          await sql(
            "SELECT count(*) n FROM account WHERE user_id='internal-example'",
          )
        )[0].n,
        0,
        "the internal account has no sign-in method",
      );
      assert.equal(
        (
          await sql(
            "SELECT count(*) n FROM reserved_subdomain WHERE name='example'",
          )
        )[0].n,
        0,
      );
      const response = await authority(
        "/api/owner/draft/address-availability",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Expected-Owner-Id": "draft-alice",
          },
          body: JSON.stringify({ name: "example" }),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        name: "example",
        status: "unavailable",
      });
    },
  );

  await run(
    "pnpm example:publish publishes the example through the real pipeline",
    async () => {
      const { site } = await publish();
      assert.equal(site.url, "https://example.hasaweb.site");
      const after = await state();
      assert.equal(after.status, "published");
      assert.equal(after.subdomain, "example");
      assert.equal(after.state, "claimed");
      assert.ok(
        after.entered,
        "setup was handed off through the product route",
      );
      assert.equal(after.sessions, 0, "the operator session is removed");
      const live = await sql(
        "SELECT count(*) n FROM publish_version WHERE portfolio_id='internal-example' AND status='live'",
      );
      assert.equal(live[0].n, 1);

      const home = await visit("https://example.hasaweb.site/");
      assert.equal(home.status, 200);
      assert.equal(home.headers["x-robots-tag"], undefined);
      const page = text(home.body);
      for (const expected of [
        "Umer Aamir",
        "I build thoughtful web experiences",
        "Pakistan",
        "@umeraamir09",
        "@umrooGRR",
        "UmrFlix",
        "Umroo's Music Mixer",
        "A music playlist builder with a personal touch.",
        "TypeScript",
        "PostgreSQL",
      ])
        assert.ok(page.includes(expected), `published page shows ${expected}`);
      // Its images are the version's public assets, served to visitors.
      const html = home.body.toString("utf8");
      const images = [
        ...html.matchAll(
          /https:\/\/assets\.hasaweb\.site\/candidate\/[^"'\s)]+/g,
        ),
      ].map((match) => match[0].replace(/&amp;/g, "&"));
      assert.ok(images.length >= 4, `public images: ${images.length}`);
      for (const image of new Set(images)) {
        const asset = await visit(image);
        assert.equal(asset.status, 200, image);
      }
    },
  );

  await run(
    "running it again republishes the same address without setup",
    async () => {
      const first = await state();
      await publish();
      const second = await state();
      assert.equal(second.status, "published");
      assert.equal(second.version, first.version + 1);
      assert.equal(second.entered, first.entered);
      assert.equal(second.sessions, 0);
      assert.equal((await visit("https://example.hasaweb.site/")).status, 200);
    },
  );
}
