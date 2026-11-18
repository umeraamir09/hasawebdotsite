import assert from "node:assert/strict";

const today = () => new Date().toISOString().slice(0, 10);

// Phase 44: visitor posts to a published portfolio's `/_/contact`, through
// the real site handler, workerd's D1 (with the migration 0018 allowance
// triggers) and a local Turnstile stand-in.
export async function checkContactSubmission({
  origin,
  secrets,
  sql,
  turnstile,
}) {
  const name = "contact-visitor";
  const host = `https://${name}.hasaweb.site`;
  // A dedicated owner: claimed addresses are permanent, so the check never
  // borrows another fixture's portfolio.
  const portfolio = "contact-visitor-portfolio";
  const other = (
    await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
  )[0].id;
  await sql(
    "INSERT OR IGNORE INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('contact-visitor-owner','Contact owner','contact-owner@example.test',1,1,1)",
  );
  await sql(
    "INSERT OR IGNORE INTO portfolio(id,user_id,status,draft,created_at,updated_at) VALUES(?,'contact-visitor-owner','draft','{}',1,1)",
    [portfolio],
  );
  const recipient = "private-recipient@example.test";
  let tokens = 0;
  const pass = () => `pass-${++tokens}-${Date.now()}`;
  const fields = (extra = {}) => ({
    name: "Visitor",
    email: "visitor@example.com",
    message: "Hello from a visitor.",
    token: pass(),
    ...extra,
  });
  async function visit(
    body,
    { ip = "203.0.113.1", headers = {}, method } = {},
  ) {
    const response = await fetch(`${origin}/__fixture/public`, {
      method: "POST",
      headers: {
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: `${host}/_/contact`,
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          Origin: host,
          "Content-Type": "application/json",
          "CF-Connecting-IP": ip,
          ...headers,
        },
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    assert.ok(!text.includes(recipient), "response exposes the recipient");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { status: response.status, body: JSON.parse(text), response };
  }
  const outbox = () =>
    sql(
      "SELECT portfolio_id,status,attempts,is_test,payload,accepted_at,deadline_at FROM contact_outbox WHERE portfolio_id=? ORDER BY accepted_at",
      [portfolio],
    );
  const reservations = () =>
    sql(
      "SELECT count(*) n FROM email_reservation WHERE portfolio_id=? AND kind='contact' AND day=?",
      [portfolio, today()],
    );
  const candidate = crypto.randomUUID();
  async function publish({ contact = true } = {}) {
    await sql("DELETE FROM publish_version WHERE portfolio_id=?", [portfolio]);
    await sql("DELETE FROM publication_candidate WHERE portfolio_id=?", [
      portfolio,
    ]);
    await sql(
      "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) SELECT ?,id,user_id,0,'ready','[]',0,0,1,1 FROM portfolio WHERE id=?",
      [candidate, portfolio],
    );
    await sql(
      "INSERT INTO publication_candidate_index(candidate_id,value) VALUES(?,?)",
      [candidate, JSON.stringify(contact ? { contact: 1 } : {})],
    );
    await sql(
      "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES(?,?,1,'live','publication-v7',?,1,1)",
      [candidate, portfolio, candidate],
    );
    await sql(
      "UPDATE portfolio SET status='published',subdomain=?,published_version=1 WHERE id=?",
      [name, portfolio],
    );
  }
  async function reset() {
    await sql("DELETE FROM contact_outbox WHERE portfolio_id IN (?,?)", [
      portfolio,
      other,
    ]);
    await sql("DELETE FROM email_dispatch");
    await sql("DELETE FROM email_reservation");
    await sql("DELETE FROM counter WHERE key LIKE 'contact:%'");
  }
  await sql(
    "INSERT OR IGNORE INTO subdomain_claim(name,portfolio_id,state) VALUES(?,?,'claimed')",
    [name, portfolio],
  );
  await sql(
    "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES(?,?,?) ON CONFLICT(portfolio_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at,pending_token_hash=NULL,token_expires_at=NULL",
    [portfolio, recipient, Date.now()],
  );
  await publish();
  await reset();
  try {
    // The form's configuration names the site key and nothing private.
    assert.deepEqual((await visit()).body, {
      siteKey: "turnstile-fixture-site-key",
    });

    // An accepted message has its reservation and outbox row, and only then
    // does the visitor see 202.
    const before = turnstile.state.verified.length;
    const accepted = await visit(
      fields({ name: "  Ada  ", message: "Line one\nLine two" }),
    );
    assert.deepEqual(accepted, {
      status: 202,
      body: { status: "accepted" },
      response: accepted.response,
    });
    assert.equal(turnstile.state.verified.length, before + 1);
    assert.equal(turnstile.state.verified.at(-1).remoteip, "203.0.113.1");
    const [row] = await outbox();
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0);
    assert.equal(row.is_test, 0);
    assert.equal(row.deadline_at - row.accepted_at, 24 * 60 * 60 * 1000);
    const payload = JSON.parse(row.payload);
    assert.equal(payload.name, "Ada");
    assert.equal(payload.email, "visitor@example.com");
    assert.equal(payload.message, "Line one\nLine two");
    assert.equal(typeof payload.recipientVerifiedAt, "number");
    assert.ok(!row.payload.includes(recipient));
    assert.equal((await reservations())[0].n, 1);

    // Field errors, a blocked spam check and malformed posts accept nothing.
    assert.deepEqual(
      (await visit(fields({ name: "", email: "bad", message: " " }))).body,
      {
        error: "invalid_fields",
        fields: { name: "required", email: "invalid", message: "required" },
      },
    );
    assert.deepEqual(
      (await visit(fields({ token: "spam" }), { ip: "203.0.113.2" })).body,
      { error: "blocked" },
    );
    const reused = pass();
    await visit(fields({ token: reused }), { ip: "203.0.113.3" });
    assert.equal(
      (await visit(fields({ token: reused }), { ip: "203.0.113.3" })).status,
      403,
    );
    for (const [extra, status] of [
      [{ headers: { Origin: "https://other-site.hasaweb.site" } }, 403],
      [{ headers: { "Content-Type": "text/plain" } }, 415],
    ])
      assert.equal((await visit(fields(), extra)).status, status);
    assert.equal((await visit("{", { ip: "203.0.113.4" })).status, 400);
    assert.equal((await outbox()).length, 2);

    // Five complete attempts per visitor per hour, blocked ones included.
    await reset();
    for (let i = 0; i < 4; i++)
      assert.equal((await visit(fields(), { ip: "198.51.100.7" })).status, 202);
    assert.equal(
      (await visit(fields({ token: "spam" }), { ip: "198.51.100.7" })).status,
      403,
    );
    const limited = await visit(fields(), { ip: "198.51.100.7" });
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, { error: "limited" });
    assert.ok(Number(limited.response.headers.get("Retry-After")) > 0);
    // Another visitor is not affected; stored keys are hashes, not addresses.
    assert.equal((await visit(fields(), { ip: "198.51.100.8" })).status, 202);
    const keys = await sql(
      "SELECT key FROM counter WHERE key LIKE 'contact:%'",
    );
    assert.ok(keys.length >= 2);
    assert.ok(keys.every(({ key }) => !key.includes("198.51.100")));

    // Competing visitors cannot exceed the ten-a-day portfolio allowance.
    await reset();
    const raced = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        visit(fields(), { ip: `192.0.2.${i + 1}` }),
      ),
    );
    const statuses = raced.map((result) => result.status).sort();
    assert.equal(statuses.filter((status) => status === 202).length, 10);
    assert.ok(statuses.every((status) => status === 202 || status === 429));
    assert.equal((await outbox()).length, 10);
    assert.equal((await reservations())[0].n, 10);

    // The platform-wide share is shared too: 90 contact messages a day.
    await reset();
    await sql(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<89) INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day) SELECT 'fill-'||i,'filler-'||(i/10),'contact',0,? FROM n",
      [today()],
    );
    assert.equal((await visit(fields(), { ip: "192.0.2.100" })).status, 202);
    assert.equal((await visit(fields(), { ip: "192.0.2.101" })).status, 429);
    assert.equal((await outbox()).length, 1);

    // A recipient change takes effect at once: unverified means unavailable.
    await reset();
    await sql(
      "UPDATE contact_recipient SET verified_at=NULL WHERE portfolio_id=?",
      [portfolio],
    );
    assert.deepEqual((await visit(fields())).body, { error: "unavailable" });
    assert.equal((await visit(fields())).status, 503);
    await sql(
      "UPDATE contact_recipient SET verified_at=? WHERE portfolio_id=?",
      [Date.now(), portfolio],
    );
    assert.equal((await reservations())[0].n, 0);

    // Unavailable portfolios reject submissions: a version without a form,
    // unpublished, suspended, and unknown hosts.
    await publish({ contact: false });
    assert.equal((await visit()).status, 404);
    assert.equal((await visit(fields())).status, 404);
    await publish();
    for (const status of ["unpublished", "suspended", "deleting"]) {
      await sql("UPDATE portfolio SET status=? WHERE id=?", [
        status,
        portfolio,
      ]);
      assert.deepEqual((await visit(fields())).body, { error: "unavailable" });
    }
    await sql("UPDATE portfolio SET status='published' WHERE id=?", [
      portfolio,
    ]);
    assert.equal((await outbox()).length, 0);
    const unknown = await fetch(`${origin}/__fixture/public`, {
      method: "POST",
      headers: {
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://nobody-here.hasaweb.site/_/contact",
        method: "POST",
        headers: {
          Origin: "https://nobody-here.hasaweb.site",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fields()),
      }),
    });
    assert.equal(unknown.status, 404);
    // Other paths still refuse POST.
    const page = await fetch(`${origin}/__fixture/public`, {
      method: "POST",
      headers: {
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: `${host}/`, method: "POST" }),
    });
    assert.equal(page.status, 404);
  } finally {
    await reset();
    await sql("UPDATE portfolio SET status='published' WHERE id=?", [
      portfolio,
    ]);
  }
}
