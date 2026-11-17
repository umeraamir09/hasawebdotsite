import assert from "node:assert/strict";

const PATH = "/api/owner/contact/recipient";
const today = () => new Date().toISOString().slice(0, 10);

// Phase 43: recipient setup through the real owner router and the real Resend
// adapter (posting to a local stand-in), plus the shared email budgets that
// migration 0018 enforces in D1.
export async function checkContactRecipient({ request, sql, email }) {
  const call = (owner, path = "", body, extra = {}) =>
    request(`${PATH}${path}`, body ?? {}, {
      owner,
      method: body === undefined ? "GET" : "POST",
      ...extra,
    });
  const portfolio = async (owner) =>
    (
      await sql("SELECT id FROM portfolio WHERE user_id=?", [`draft-${owner}`])
    )[0].id;
  const bob = await portfolio("bob");
  const alice = await portfolio("alice");
  const reset = async () => {
    await sql("DELETE FROM email_dispatch");
    await sql("DELETE FROM email_reservation");
    await sql("DELETE FROM contact_recipient WHERE portfolio_id IN (?,?)", [
      bob,
      alice,
    ]);
    email.state.failure = null;
  };
  await reset();

  // Owner guards: the routes return the owner's private address.
  for (const owner of [null, "expired", "deleting"])
    await call(owner, "", undefined, { status: 401 });
  await call("bob", "", undefined, {
    headers: { "X-Expected-Owner-Id": "" },
    status: 400,
  });
  await call("bob", "", undefined, {
    headers: { "X-Expected-Owner-Id": "draft-alice" },
    status: 409,
  });
  await call(
    "bob",
    "",
    { email: "x@example.test" },
    {
      headers: { Origin: "https://evil.test" },
      status: 403,
    },
  );
  await call("bob", "", { email: "x@example.test", extra: 1 }, { status: 422 });
  await call("bob", "", undefined, { method: "DELETE", status: 405 });

  assert.deepEqual(await call("bob"), {
    recipient: null,
    accountEmail: "bob@draft.example.test",
  });
  assert.equal(
    (await call("bob", "", { email: "not an email" }, { status: 422 })).error,
    "invalid_email",
  );
  assert.equal(
    (
      await call(
        "bob",
        "",
        { email: `${"a".repeat(250)}@example.test` },
        {
          status: 422,
        },
      )
    ).error,
    "invalid_email",
  );

  // The provider-verified account email needs no link and sends nothing.
  const sentBefore = email.state.sent.length;
  assert.deepEqual((await call("bob", "/account", {})).recipient, {
    email: "bob@draft.example.test",
    state: "verified",
  });
  assert.equal(email.state.sent.length, sentBefore);
  await sql("UPDATE user SET email_verified=0 WHERE id='draft-bob'");
  const unverifiedAccount = await call("bob", "/account", {}, { status: 409 });
  assert.equal(unverifiedAccount.error, "account_email_unverified");
  assert.equal(unverifiedAccount.accountEmail, null);
  await sql("UPDATE user SET email_verified=1 WHERE id='draft-bob'");

  // Another address: a link is sent, the token is stored only as a hash.
  const inbox = "bob-inbox@example.test";
  const pending = await call("bob", "", { email: ` ${inbox} ` });
  assert.deepEqual(pending.recipient, { email: inbox, state: "pending" });
  const [sent] = email.to(inbox);
  assert.equal(sent.from, "hello@mail.hasaweb.site");
  assert.deepEqual(sent.to, [inbox]);
  assert.equal(sent.html, undefined);
  assert.match(sent.key, /^verification\//);
  const token = sent.text.match(
    /https:\/\/hasaweb\.site\/settings\/contact\/verify#token=([\w-]{43})/,
  )[1];
  const [row] = await sql(
    "SELECT verified_at,pending_token_hash FROM contact_recipient WHERE portfolio_id=?",
    [bob],
  );
  assert.equal(row.verified_at, null);
  assert.ok(row.pending_token_hash && !row.pending_token_hash.includes(token));

  // Another owner, a wrong token and a malformed token never confirm it.
  await call("alice", "/account", {});
  assert.equal(
    (await call("alice", "/verify", { token }, { status: 409 })).error,
    "invalid_token",
  );
  assert.equal(
    (await call("bob", "/verify", { token: "b".repeat(43) }, { status: 409 }))
      .error,
    "invalid_token",
  );
  await call("bob", "/verify", { token: "short" }, { status: 409 });
  assert.equal((await call("bob")).recipient.state, "pending");
  assert.equal(
    (await call("bob", "/verify", { token })).recipient.state,
    "verified",
  );
  // A spent link cannot be replayed; the recipient stays verified.
  const replay = await call("bob", "/verify", { token }, { status: 409 });
  assert.equal(replay.recipient.state, "verified");

  // Re-requesting the verified address changes nothing and sends nothing.
  const count = email.state.sent.length;
  assert.equal(
    (await call("bob", "", { email: inbox.toUpperCase() })).recipient.state,
    "verified",
  );
  assert.equal(email.state.sent.length, count);

  // An expired link fails closed and keeps the address unverified.
  await call("bob", "", { email: "bob-second@example.test" });
  const expired = email
    .to("bob-second@example.test")
    .at(-1)
    .text.match(/#token=([\w-]{43})/)[1];
  await sql(
    "UPDATE contact_recipient SET token_expires_at=? WHERE portfolio_id=?",
    [Date.now() - 1, bob],
  );
  const late = await call(
    "bob",
    "/verify",
    { token: expired },
    { status: 410 },
  );
  assert.equal(late.error, "expired_token");
  assert.equal(late.recipient.state, "unverified");

  // Three verification emails per portfolio per day, even under a race.
  const before = email.state.sent.length;
  const raced = await Promise.all(
    [1, 2, 3].map((i) =>
      call(
        "bob",
        "",
        { email: `bob-race-${i}@example.test` },
        {
          status: [200, 429],
        },
      ),
    ),
  );
  assert.equal(raced.filter((result) => !result.error).length, 1);
  assert.equal(email.state.sent.length, before + 1);
  assert.ok(
    raced.every((result) => !result.error || result.error === "limited"),
  );

  // A provider failure is reported, never claimed as sent.
  email.state.failure = { status: 422, name: "validation_error" };
  const failed = await call(
    "alice",
    "",
    { email: "alice-inbox@example.test" },
    {
      status: 502,
    },
  );
  assert.equal(failed.error, "delivery_failed");
  assert.deepEqual(failed.recipient, {
    email: "alice-inbox@example.test",
    state: "unverified",
  });
  email.state.failure = null;

  const insert = (id, portfolioId, kind, isTest = 0, day = today()) =>
    sql(
      "INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day) VALUES(?,?,?,?,?)",
      [id, portfolioId, kind, isTest, day],
    );
  const rejects = async (work, code) => {
    let message = "";
    try {
      await work();
    } catch (error) {
      message = String(error);
    }
    assert.match(message, new RegExp(code));
  };
  // A test flag is only valid on contact messages (checked before the
  // notice allowance below is filled, since triggers run first).
  await rejects(() => insert("bad-test", "x", "verification", 1), "CHECK");
  // Ten owner notices a day in total. Fill the allowance, then request.
  await sql("DELETE FROM email_dispatch");
  await sql("DELETE FROM email_reservation WHERE portfolio_id!=?", [alice]);
  const used = (
    await sql(
      "SELECT COUNT(*) AS n FROM email_reservation WHERE kind!='contact'",
    )
  )[0].n;
  for (let i = used; i < 10; i++)
    await sql(
      "INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day) VALUES(?,?,'failure-notice',0,?)",
      [`notice-${i}`, `other-${i}`, today()],
    );
  const sentAtLimit = email.state.sent.length;
  assert.equal(
    (
      await call(
        "alice",
        "",
        { email: "alice-limit@example.test" },
        {
          status: 429,
        },
      )
    ).error,
    "limited",
  );
  assert.equal(email.state.sent.length, sentAtLimit);

  // Database allowances hold regardless of caller.
  await rejects(
    () => insert("extra-notice", "x", "verification"),
    "notice_allowance",
  );
  // Replaying an existing reservation is not a second charge.
  await sql(
    "INSERT OR IGNORE INTO email_reservation(id,portfolio_id,kind,is_test,day) VALUES('notice-9','other-9','failure-notice',0,?)",
    [today()],
  );
  for (let i = 0; i < 2; i++) await insert(`test-${i}`, "site-a", "contact", 1);
  await rejects(
    () => insert("test-2", "site-a", "contact", 1),
    "contact_allowance",
  );
  for (let i = 2; i < 10; i++)
    await insert(`contact-a-${i}`, "site-a", "contact");
  await rejects(
    () => insert("contact-a-10", "site-a", "contact"),
    "contact_allowance",
  );
  for (let site = 0; site < 8; site++)
    for (let i = 0; i < 10; i++)
      await insert(`contact-${site}-${i}`, `site-${site}`, "contact");
  await rejects(
    () => insert("contact-91", "site-z", "contact"),
    "contact_allowance",
  );
  // Yesterday's allowance does not carry over.
  await insert("yesterday", "site-a", "contact", 0, "2000-01-01");

  // Dispatch: ten notice attempts a day, and the flag must match the kind.
  await sql("DELETE FROM email_dispatch");
  const dispatch = (attempt, reservation, notice, day = today()) =>
    sql(
      "INSERT INTO email_dispatch(attempt,reservation,notice,day,month) VALUES(?,?,?,?,?)",
      [attempt, reservation, notice, day, day.slice(0, 7)],
    );
  await rejects(() => dispatch("wrong-kind", "notice-9", 0), "dispatch_kind");
  for (let i = 0; i < 10; i++) await dispatch(`n-${i}`, "notice-9", 1);
  await rejects(
    () => dispatch("n-10", "notice-9", 1),
    "dispatch_daily_allowance",
  );
  await dispatch("contact-dispatch", "contact-0-0", 0);
  await reset();
}
