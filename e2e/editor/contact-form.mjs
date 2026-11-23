import assert from "node:assert/strict";
import { join } from "node:path";
import { openChecklist, openPanel } from "./shell.mjs";

// Phase 44: an owner publishes a contact form, and a visitor's browser sends
// through the published page's platform script to `/_/contact`. Turnstile's
// script is a Playwright stand-in; its server check is the local fixture
// (tokens starting with `pass` succeed once).
const FAKE_TURNSTILE = `window.turnstile = {
  render(container, options) {
    container.textContent = "Spam check complete";
    window.__turnstileOptions = options;
    return "widget-1";
  },
  getResponse() { return window.__turnstileToken; },
  reset() { window.__turnstileResets = (window.__turnstileResets || 0) + 1; },
  remove() {},
};`;

export async function checkContactFormJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  evidence,
}) {
  const address = "contact-site";
  const site = `https://${address}.hasaweb.site`;
  const recipient = "alice-private-recipient@example.test";
  const visitorRequest = (url, init = {}) =>
    authority(
      "/__fixture/public",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method: "GET", ...init }),
      },
      "none",
    );
  const portfolioId = async () =>
    (await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'"))[0].id;
  const outbox = async () =>
    sql("SELECT payload,status FROM contact_outbox WHERE portfolio_id=?", [
      await portfolioId(),
    ]);
  const checklist = () => openChecklist(getPage());

  await run("an owner publishes a working contact form", async () => {
    await boot();
    const draft = await getPage().evaluate(() =>
      structuredClone(
        window.editorFixture.recovery.store
          .getState()
          .controller.store.getState().working,
      ),
    );
    Object.assign(draft, {
      components: [{ id: "contact-1", type: "contact", version: 1, data: {} }],
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
      name: "Contact owner",
      bio: "Send me a message.",
      faceReveal: { enabled: false },
    };
    await boot(draft);
    const page = getPage();
    const id = await portfolioId();
    await sql("DELETE FROM contact_outbox WHERE portfolio_id=?", [id]);
    await sql("DELETE FROM counter WHERE key LIKE 'contact:%'");
    await sql(
      "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES(?,?,?) ON CONFLICT(portfolio_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at,pending_token_hash=NULL,token_expires_at=NULL",
      [id, recipient, Date.now()],
    );
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
    await page.getByLabel("Address name").fill(address);
    await page
      .getByRole("button", { name: "Save address", exact: true })
      .click();
    await page
      .getByText("Reserved for your portfolio. Your site is still private.", {
        exact: true,
      })
      .waitFor();
    await openPanel(page, "Build");
    await page.evaluate(() =>
      window.editorFixture.recovery.store.getState().controller.flushValid(),
    );
    await (await checklist())
      .getByRole("button", { name: /^(Retry )?Publish$/ })
      .click();
    await (await checklist())
      .getByText("Publication complete.", { exact: true })
      .waitFor({ timeout: 120000 });

    const response = await visitorRequest(`${site}/`);
    assert.equal(response.status, 200);
    const csp = response.headers.get("Content-Security-Policy");
    assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /form-action 'none'/);
    const html = await response.text();
    assert.match(html, /data-contact-source="\/_\/contact"/);
    assert.ok(!html.includes(recipient));
    assert.deepEqual(await (await visitorRequest(`${site}/_/contact`)).json(), {
      siteKey: "turnstile-fixture-site-key",
    });
  });

  await run(
    "a visitor's message is accepted only after the server says so",
    async () => {
      const visitor = await getPage().context().browser().newContext();
      const posts = [];
      try {
        await visitor.route(
          /^https:\/\/challenges\.cloudflare\.com\//,
          (route) =>
            route.fulfill({
              status: 200,
              contentType: "text/javascript",
              body: FAKE_TURNSTILE,
            }),
        );
        await visitor.route(
          /^https:\/\/[^/]+\.hasaweb\.site\//,
          async (route) => {
            const request = route.request();
            if (request.method() === "POST") posts.push(request.postDataJSON());
            const response = await visitorRequest(request.url(), {
              method: request.method(),
              headers: {
                ...(request.headers().origin
                  ? { Origin: request.headers().origin }
                  : {}),
                ...(request.headers()["content-type"]
                  ? { "Content-Type": request.headers()["content-type"] }
                  : {}),
                "CF-Connecting-IP": "203.0.113.50",
              },
              ...(request.method() === "POST"
                ? { body: request.postData() ?? "" }
                : {}),
            });
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
        const form = tab.locator("form[data-contact-form]");
        const send = form.getByRole("button", { name: "Send message" });
        await form.getByText("Spam check complete").waitFor();
        assert.equal(await send.isEnabled(), true);
        assert.deepEqual(await tab.evaluate(() => window.__turnstileOptions), {
          sitekey: "turnstile-fixture-site-key",
          action: "contact",
        });

        // Empty and malformed fields are explained beside each field and send
        // nothing.
        await send.click();
        for (const text of [
          "Enter your name.",
          "Enter your email address.",
          "Enter a message.",
        ])
          await form.getByText(text).waitFor();
        assert.equal(
          await form.getByLabel("Name").getAttribute("aria-invalid"),
          "true",
        );
        await form.getByLabel("Name").fill("Ada Visitor");
        await form.getByLabel("Email").fill("not-an-email");
        await form.getByLabel("Message").fill("Hello from the published page.");
        await send.click();
        await form
          .getByText("Enter a valid email address, like name@example.com.")
          .waitFor();
        assert.equal(await form.getByText("Enter your name.").count(), 0);
        assert.deepEqual(posts, []);

        // Without a solved check the form asks for it instead of posting.
        await form.getByLabel("Email").fill("ada@example.com");
        await send.click();
        await form
          .getByText("Complete the spam check, then send your message again.")
          .waitFor();
        assert.deepEqual(posts, []);

        // A blocked spam check is not a success.
        await tab.evaluate(() => {
          window.__turnstileToken = "spam-token";
        });
        await send.click();
        await form.getByText(/was blocked by spam protection/).waitFor();
        assert.equal(await form.getAttribute("data-state"), "error");
        assert.equal(await form.getByText(/accepted for delivery/).count(), 0);
        assert.equal((await outbox()).length, 0);
        assert.equal(await form.getByLabel("Name").inputValue(), "Ada Visitor");

        // Accepted: one outbox row with the visitor's details, then success.
        await tab.evaluate(() => {
          window.__turnstileToken = "pass-browser-1";
        });
        await send.click();
        await form
          .getByText("Thanks. Your message was accepted for delivery.")
          .waitFor();
        const [row] = await outbox();
        assert.equal(row.status, "queued");
        assert.deepEqual(
          (({ name, email, message }) => ({ name, email, message }))(
            JSON.parse(row.payload),
          ),
          {
            name: "Ada Visitor",
            email: "ada@example.com",
            message: "Hello from the published page.",
          },
        );
        assert.equal(await form.getByLabel("Message").inputValue(), "");
        assert.equal(await tab.evaluate(() => window.__turnstileResets), 2);
        assert.equal(posts.at(-1).token, "pass-browser-1");
        await tab.screenshot({
          path: join(evidence, "contact-form-accepted.png"),
          fullPage: true,
        });

        // A recipient change takes effect at once: the next message is
        // rejected with retry guidance, never a success claim.
        await sql(
          "UPDATE contact_recipient SET verified_at=NULL WHERE portfolio_id=?",
          [await portfolioId()],
        );
        await tab.evaluate(() => {
          window.__turnstileToken = "pass-browser-2";
        });
        // A success resets the form, so this is a fresh message.
        await form.getByLabel("Name").fill("Ada Visitor");
        await form.getByLabel("Email").fill("ada@example.com");
        await form.getByLabel("Message").fill("Second message.");
        await send.click();
        await form
          .getByText(/can't be sent right now\. Your message was not sent/)
          .waitFor();
        assert.equal(await form.getAttribute("data-state"), "error");
        assert.equal((await outbox()).length, 1);
        assert.deepEqual(errors, []);
      } finally {
        await visitor.close();
        await sql(
          "UPDATE contact_recipient SET verified_at=? WHERE portfolio_id=?",
          [Date.now(), await portfolioId()],
        );
      }
    },
  );
}
