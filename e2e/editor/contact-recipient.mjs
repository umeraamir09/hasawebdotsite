import assert from "node:assert/strict";

// Phase 43: the contact form panel sets up the private recipient. The
// account's verified email needs no link; another address is confirmed
// through the emailed link, and publication stays blocked until then.
export async function checkContactRecipientJourney({
  getPage,
  boot,
  sql,
  run,
  authority,
  email,
}) {
  const panel = () =>
    getPage().getByRole("region", {
      name: "Contact form controls",
      exact: true,
    });
  const state = () =>
    panel()
      .locator("[data-recipient-state]")
      .getAttribute("data-recipient-state");
  await run(
    "contact form recipient from the account email or a confirmed address",
    async () => {
      await sql(
        "DELETE FROM contact_recipient WHERE portfolio_id IN (SELECT id FROM portfolio WHERE user_id='draft-alice')",
      );
      await sql("DELETE FROM email_dispatch");
      await sql("DELETE FROM email_reservation");
      await boot();
      const draft = await getPage().evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      draft.components = [];
      draft.samples = {};
      await boot(draft);
      const page = getPage();
      const sections = page.getByRole("region", {
        name: "Portfolio sections",
        exact: true,
      });
      await sections
        .getByRole("button", { name: "Add component", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add Contact form", exact: true })
        .click();
      await panel().getByText("No recipient yet").waitFor();
      assert.equal(await state(), "none");

      // The account email is provider-verified: one click, no email sent.
      const sent = email.state.sent.length;
      await panel()
        .getByRole("button", {
          name: "Use my account email (alice@draft.example.test)",
        })
        .click();
      await panel().getByText("Confirmed.").waitFor();
      assert.equal(await state(), "verified");
      assert.equal(email.state.sent.length, sent);

      // Another address sends a link and leaves the form unverified.
      const inbox = "alice-editor@example.test";
      await panel().getByLabel("Use a different address").fill(inbox);
      await panel()
        .getByRole("button", { name: "Send confirmation link" })
        .click();
      await panel().getByText("Confirmation link sent").waitFor();
      assert.equal(await state(), "pending");
      const [message] = email.to(inbox);
      assert.ok(message, "confirmation email sent");
      const token = message.text.match(/#token=([\w-]{43})/)[1];
      // The address is private: it never enters the saved draft.
      const saved = await sql(
        "SELECT draft FROM portfolio WHERE user_id='draft-alice'",
      );
      assert.ok(!saved[0].draft.includes(inbox));

      // The browser checks the format first; the server also needs a domain.
      await panel()
        .getByLabel("Use a different address")
        .fill("nope@localhost");
      await panel()
        .getByRole("button", { name: "Send confirmation link" })
        .click();
      await panel().getByRole("alert").getByText("valid email").waitFor();

      // Confirming through the owner route (the link's page posts this).
      const owner = await (await authority("/api/owner")).json();
      const confirmed = await authority("/api/owner/contact/recipient/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Expected-Owner-Id": owner.user.id,
        },
        body: JSON.stringify({ token }),
      });
      assert.equal(confirmed.status, 200);
      // Reopen the panel, which reads the recipient again.
      await sections
        .getByRole("button", { name: "Profile", exact: true })
        .click();
      await sections
        .getByRole("button", { name: "Contact form", exact: true })
        .click();
      await panel().getByText(`Messages go to ${inbox}`).waitFor();
      assert.equal(await state(), "verified");
    },
  );

  // Phase 45: Send test message reports its outcome under the daily limit,
  // and undelivered visitor messages stay visible, including ones whose
  // owner notice was deferred by the shared notice allowance.
  await run("contact form test message and undelivered messages", async () => {
    // boot() recreates the portfolio, so its ID is read after it.
    let portfolio = null;
    await sql("DELETE FROM email_dispatch");
    await sql("DELETE FROM email_reservation");
    email.state.failure = null;
    try {
      await boot();
      const draft = await getPage().evaluate(() =>
        structuredClone(
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working,
        ),
      );
      draft.components = [];
      draft.samples = {};
      await boot(draft);
      portfolio = (
        await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
      )[0].id;
      await sql(
        "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES(?,'alice@draft.example.test',?) ON CONFLICT(portfolio_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at,pending_token_hash=NULL,token_expires_at=NULL",
        [portfolio, Date.now()],
      );
      const page = getPage();
      const sections = page.getByRole("region", {
        name: "Portfolio sections",
        exact: true,
      });
      await sections
        .getByRole("button", { name: "Add component", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add Contact form", exact: true })
        .click();
      const delivery = panel().getByRole("region", {
        name: "Message delivery",
        exact: true,
      });
      const send = delivery.getByRole("button", {
        name: "Send test message",
        exact: true,
      });
      await panel().getByText("Confirmed.").waitFor();
      const before = email.to("alice@draft.example.test").length;
      await send.click();
      await delivery.getByText("Test message sent.").waitFor();
      const tests = email.to("alice@draft.example.test").slice(before);
      assert.equal(tests.length, 1);
      assert.equal(
        tests[0].subject,
        "Test message from your hasaweb.site portfolio",
      );
      // A temporary provider failure is reported as retrying, not sent.
      email.state.failure = { status: 503, name: "service_unavailable" };
      await send.click();
      await delivery.getByText("We'll keep retrying").waitFor();
      await send.click();
      await delivery
        .getByRole("alert")
        .getByText("two test messages a day")
        .waitFor();
      email.state.failure = null;

      // A visitor message that finally failed while today's notice
      // allowance was used up still shows as a failure.
      const failedAt = Date.now() - 60_000;
      await sql(
        "INSERT INTO contact_outbox(id,portfolio_id,payload,status,attempts,next_attempt_at,is_test,accepted_at,deadline_at,budget_window_start,finished_at,notice,notice_next_at) VALUES(?,?,NULL,'failed',5,?,0,?,?,0,?,'deferred',?)",
        [
          crypto.randomUUID(),
          portfolio,
          failedAt,
          failedAt - 86_400_000,
          failedAt,
          failedAt,
          failedAt + 86_400_000,
        ],
      );
      await sections
        .getByRole("button", { name: "Profile", exact: true })
        .click();
      await sections
        .getByRole("button", { name: "Contact form", exact: true })
        .click();
      const failure = panel()
        .getByRole("list", { name: "Undelivered messages" })
        .getByRole("listitem");
      await failure.first().waitFor();
      assert.equal(await failure.count(), 1);
      assert.equal(await failure.getAttribute("data-notice"), "deferred");
      assert.match(
        await failure.innerText(),
        /couldn't be delivered.*email you about it tomorrow/s,
      );
    } finally {
      email.state.failure = null;
      if (portfolio)
        await sql("DELETE FROM contact_outbox WHERE portfolio_id=?", [
          portfolio,
        ]);
      await sql("DELETE FROM email_dispatch");
      await sql("DELETE FROM email_reservation");
    }
  });
}
