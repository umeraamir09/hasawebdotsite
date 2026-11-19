import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const day = (time) => new Date(time).toISOString().slice(0, 10);

// Phase 45: delivery of accepted messages through the real jobs queue
// consumer and cron sweep, the real Resend adapter posting to a local
// stand-in with controlled failures, and workerd's D1 with the migration
// 0018 budget triggers. The sweep runs at chosen times through a fixture
// route, so the 24-hour schedule is walked without waiting.
export async function checkContactDelivery({
  origin,
  secrets,
  sql,
  email,
  request,
}) {
  const name = "contact-delivery";
  const host = `https://${name}.hasaweb.site`;
  // A dedicated owner: claimed addresses are permanent.
  const owner = "contact-delivery-owner";
  const portfolio = "contact-delivery-portfolio";
  const account = "delivery-owner@example.test";
  const recipient = "delivery-recipient@example.test";
  await sql(
    "INSERT OR IGNORE INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,'Delivery owner',?,1,1,1)",
    [owner, account],
  );
  await sql(
    "INSERT OR IGNORE INTO portfolio(id,user_id,status,subdomain,draft,created_at,updated_at) VALUES(?,?,'draft',?,'{}',1,1)",
    [portfolio, owner, name],
  );
  await sql(
    "INSERT OR IGNORE INTO subdomain_claim(name,portfolio_id,state) VALUES(?,?,'claimed')",
    [name, portfolio],
  );
  const candidate = crypto.randomUUID();
  await sql(
    "INSERT INTO publication_candidate(id,portfolio_id,owner_id,source_revision,status,cursor,next_attempt_at,deadline_at,created_at,updated_at) VALUES(?,?,?,0,'ready','[]',0,0,1,1)",
    [candidate, portfolio, owner],
  );
  await sql(
    "INSERT INTO publication_candidate_index(candidate_id,value) VALUES(?,?)",
    [candidate, JSON.stringify({ contact: 1 })],
  );
  await sql(
    "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,candidate_id,created_at,updated_at) VALUES(?,?,1,'live','publication-v7',?,1,1)",
    [candidate, portfolio, candidate],
  );
  await sql(
    "UPDATE portfolio SET status='published',subdomain=?,published_version=1 WHERE id=?",
    [name, portfolio],
  );
  const verifiedAt = Date.now();
  await sql(
    "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES(?,?,?) ON CONFLICT(portfolio_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at",
    [portfolio, recipient, verifiedAt],
  );

  let tokens = 0;
  const fields = (extra = {}) => ({
    name: "Visitor",
    email: "visitor@example.com",
    message: "Hello from a visitor.",
    token: `pass-${++tokens}-${Date.now()}`,
    ...extra,
  });
  let visitors = 0;
  async function visit(body, { queue = false } = {}) {
    const response = await fetch(`${origin}/__fixture/public`, {
      method: "POST",
      headers: {
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: `${host}/_/contact`,
        method: "POST",
        queue,
        headers: {
          Origin: host,
          "Content-Type": "application/json",
          "CF-Connecting-IP": `198.18.0.${++visitors}`,
        },
        body: JSON.stringify(body),
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 202, await response.clone().text());
  }
  async function sweep(now) {
    const response = await fetch(`${origin}/__fixture/contact-sweep`, {
      method: "POST",
      headers: {
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ now }),
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(response.status, 200, await response.text());
  }
  const rows = () =>
    sql(
      "SELECT id,status,attempts,payload,last_error,next_attempt_at,accepted_at,deadline_at,finished_at,notice,notice_next_at FROM contact_outbox WHERE portfolio_id=? ORDER BY accepted_at",
      [portfolio],
    );
  const only = async () => {
    const all = await rows();
    assert.equal(all.length, 1);
    return all[0];
  };
  const dispatches = async (prefix) =>
    (
      await sql(
        "SELECT attempt FROM email_dispatch WHERE attempt LIKE ? ORDER BY attempt",
        [`${prefix}%`],
      )
    ).map((row) => row.attempt);
  async function reset() {
    // Delivery sweeps every due row, so start each case from an empty outbox.
    await sql("DELETE FROM contact_outbox");
    await sql("DELETE FROM email_dispatch");
    await sql("DELETE FROM email_reservation");
    await sql("DELETE FROM counter WHERE key LIKE 'contact:%'");
    email.state.failure = null;
    email.state.sent.length = 0;
    email.state.failed = 0;
  }

  try {
    // The queue hand-off makes the first attempt at once, to the verified
    // recipient, with the visitor as Reply-To, then drops the payload.
    await reset();
    await visit(fields({ message: "Queued hello" }), { queue: true });
    for (let i = 0; (await only()).status !== "sent"; i++) {
      assert.ok(i < 100, "queued message was not delivered");
      await setTimeout(100);
    }
    const sent = await only();
    assert.equal(sent.attempts, 1);
    assert.equal(sent.payload, null);
    assert.equal(sent.notice, null);
    assert.ok(sent.finished_at >= sent.accepted_at);
    const [delivered] = email.to(recipient);
    assert.equal(email.state.sent.length, 1);
    assert.equal(delivered.reply_to, "visitor@example.com");
    assert.equal(delivered.key, `contact/${sent.id}`);
    assert.match(delivered.text, /Queued hello/);
    assert.deepEqual(await dispatches(sent.id), [`${sent.id}/1`]);
    // A later sweep or a repeated wake-up sends nothing more.
    await sweep(Date.now() + DAY);
    assert.equal(email.state.sent.length, 1);

    // Temporary failures retry at 5 min, 30 min, 4 h and 24 h, then the
    // message finally fails, loses its payload and the owner is notified.
    await reset();
    email.state.failure = {
      status: 503,
      name: "service_unavailable",
      to: recipient,
    };
    await visit(fields({ message: "Retried hello" }));
    const { id, accepted_at: at } = await only();
    for (const [offset, attempts] of [
      [0, 1],
      [4 * MIN, 1],
      [5 * MIN, 2],
      [29 * MIN, 2],
      [30 * MIN, 3],
      [4 * HOUR, 4],
      [DAY - 1, 4],
    ]) {
      await sweep(at + offset);
      const row = await only();
      assert.equal(row.attempts, attempts, `attempts at +${offset}`);
      assert.equal(row.status, "queued");
      assert.equal(row.last_error, "service_unavailable");
      assert.ok(JSON.parse(row.payload).message === "Retried hello");
    }
    assert.equal((await only()).next_attempt_at, at + DAY);
    await sweep(at + DAY);
    const exhausted = await only();
    assert.equal(exhausted.attempts, 5);
    assert.equal(exhausted.status, "failed");
    assert.equal(exhausted.payload, null);
    assert.equal(exhausted.last_error, "service_unavailable");
    assert.equal(exhausted.finished_at, at + DAY);
    assert.equal(exhausted.notice, "sent");
    assert.equal(email.state.failed, 5);
    const [notice] = email.to(account);
    assert.equal(notice.subject, "A portfolio message could not be delivered");
    assert.equal(notice.key, `failure-notice/${id}`);
    assert.ok(!notice.text.includes("Retried hello"));
    assert.ok(!notice.text.includes(recipient));
    // Each attempt was charged once, on its own dispatch day.
    assert.deepEqual(
      await dispatches(id),
      [1, 2, 3, 4, 5].map((n) => `${id}/${n}`),
    );
    assert.deepEqual(await dispatches(`notice-${id}`), [`notice-${id}/1`]);
    const days = await sql("SELECT day FROM email_dispatch WHERE attempt=?", [
      `${id}/5`,
    ]);
    assert.equal(days[0].day, day(at + DAY));
    // Nothing is attempted after exhaustion.
    await sweep(at + 2 * DAY);
    assert.equal(email.state.failed, 5);
    assert.equal(email.to(account).length, 1);

    // A permanent provider error fails at once after one attempt.
    await reset();
    email.state.failure = {
      status: 422,
      name: "validation_error",
      to: recipient,
    };
    await visit(fields());
    const rejected = await only();
    await sweep(rejected.accepted_at);
    assert.deepEqual(
      (({ status, attempts, last_error, notice }) => ({
        status,
        attempts,
        last_error,
        notice,
      }))(await only()),
      {
        status: "failed",
        attempts: 1,
        last_error: "validation_error",
        notice: "sent",
      },
    );

    // A longer provider delay is honoured while it stays within the
    // deadline; one that passes it ends delivery.
    await reset();
    email.state.failure = {
      status: 429,
      name: "rate_limit_exceeded",
      to: recipient,
      retryAfter: 7200,
    };
    await visit(fields());
    const delayed = await only();
    await sweep(delayed.accepted_at);
    const waiting = await only();
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.next_attempt_at, delayed.accepted_at + 2 * HOUR);
    await sql(
      "UPDATE contact_outbox SET attempts=3,next_attempt_at=? WHERE id=?",
      [delayed.accepted_at + 23 * HOUR, delayed.id],
    );
    await sweep(delayed.accepted_at + 23 * HOUR);
    const late = await only();
    assert.equal(late.status, "failed");
    assert.equal(late.attempts, 4);
    assert.equal(late.last_error, "rate_limit_exceeded");

    // Stuck rows recover: an interrupted attempt is retried once its lease
    // ends (the provider key prevents a duplicate), and an interrupted last
    // attempt fails and notifies.
    await reset();
    await visit(fields({ message: "Interrupted hello" }));
    const stuck = await only();
    await sql(
      "UPDATE contact_outbox SET status='sending',attempts=2,next_attempt_at=? WHERE id=?",
      [stuck.accepted_at + 2 * MIN, stuck.id],
    );
    await sweep(stuck.accepted_at + MIN);
    assert.equal((await only()).attempts, 2);
    assert.equal(email.state.sent.length, 0);
    await sweep(stuck.accepted_at + 2 * MIN);
    const recovered = await only();
    assert.equal(recovered.status, "sent");
    assert.equal(recovered.attempts, 3);
    assert.equal(email.to(recipient).length, 1);
    await reset();
    await visit(fields());
    const last = await only();
    await sql(
      "UPDATE contact_outbox SET status='sending',attempts=5,next_attempt_at=? WHERE id=?",
      [last.accepted_at, last.id],
    );
    await sweep(last.accepted_at + 1);
    const interrupted = await only();
    assert.equal(interrupted.status, "failed");
    assert.equal(interrupted.last_error, "interrupted");
    assert.equal(interrupted.payload, null);
    assert.equal(interrupted.notice, "sent");

    // A changed recipient ends delivery without a provider attempt: the
    // message belongs to the address verified when it was accepted.
    await reset();
    await visit(fields());
    const changed = await only();
    await sql(
      "UPDATE contact_recipient SET verified_at=? WHERE portfolio_id=?",
      [verifiedAt + 1, portfolio],
    );
    await sweep(changed.accepted_at);
    assert.equal((await only()).last_error, "recipient_changed");
    assert.equal(email.to(recipient).length, 0);
    assert.deepEqual(await dispatches(changed.id), []);
    await sql(
      "UPDATE contact_recipient SET verified_at=? WHERE portfolio_id=?",
      [verifiedAt, portfolio],
    );

    // Over the shared notice allowance the notice is deferred to the next
    // UTC day, not sent, and goes out once the allowance reopens.
    await reset();
    email.state.failure = {
      status: 422,
      name: "validation_error",
      to: recipient,
    };
    await visit(fields());
    const deferred = await only();
    await sql(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10) INSERT INTO email_reservation(id,portfolio_id,kind,is_test,day) SELECT 'notice-fill-'||i,'filler-'||i,'verification',0,? FROM n",
      [day(deferred.accepted_at)],
    );
    await sweep(deferred.accepted_at);
    const waitingNotice = await only();
    assert.equal(waitingNotice.status, "failed");
    assert.equal(waitingNotice.notice, "deferred");
    const midnight = Math.floor(deferred.accepted_at / DAY) * DAY + DAY;
    assert.equal(waitingNotice.notice_next_at, midnight);
    assert.equal(email.to(account).length, 0);
    await sweep(midnight - 1);
    assert.equal((await only()).notice, "deferred");
    await sweep(midnight);
    assert.equal((await only()).notice, "sent");
    assert.equal(email.to(account).length, 1);

    // Send test message: through the owner route, to the verified recipient,
    // two a day, and the outcome is reported.
    await reset();
    const alice = (
      await sql("SELECT id FROM portfolio WHERE user_id='draft-alice'")
    )[0].id;
    const inbox = "alice-delivery@example.test";
    const test = (status = 200) =>
      request(
        "/api/owner/contact/delivery/test",
        {},
        { method: "POST", owner: "alice", status },
      );
    const status = () =>
      request("/api/owner/contact/delivery", undefined, { owner: "alice" });
    await sql("DELETE FROM contact_recipient WHERE portfolio_id=?", [alice]);
    assert.equal((await test(409)).error, "no_recipient");
    await sql(
      "INSERT INTO contact_recipient(portfolio_id,email,verified_at) VALUES(?,?,?)",
      [alice, inbox, Date.now()],
    );
    const first = await test();
    assert.equal(first.outcome, "sent");
    assert.equal(first.test.state, "sent");
    const [testMail] = email.to(inbox);
    assert.equal(
      testMail.subject,
      "Test message from your hasaweb.site portfolio",
    );
    assert.equal(testMail.reply_to, undefined);
    email.state.failure = { status: 503, name: "service_unavailable" };
    const second = await test();
    assert.equal(second.outcome, "retrying");
    assert.equal(second.test.state, "delivering");
    // Test messages report their outcome and never owe a notice.
    const limited = await test(429);
    assert.equal(limited.error, "limited");
    assert.equal(limited.test.state, "delivering");
    const tests = await sql(
      "SELECT is_test,notice FROM contact_outbox WHERE portfolio_id=?",
      [alice],
    );
    assert.deepEqual(
      tests.map((row) => [row.is_test, row.notice]),
      [
        [1, null],
        [1, null],
      ],
    );
    // The status carries no address or content, and requires the owner.
    const current = await status();
    assert.deepEqual(Object.keys(current).sort(), [
      "delivering",
      "failures",
      "test",
    ]);
    assert.ok(!JSON.stringify(current).includes(inbox));
    await request("/api/owner/contact/delivery", undefined, {
      owner: null,
      status: 401,
    });
    await request("/api/owner/contact/delivery", undefined, {
      owner: "alice",
      headers: { "X-Expected-Owner-Id": "draft-bob" },
      status: 409,
    });
    await sql("DELETE FROM contact_recipient WHERE portfolio_id=?", [alice]);
  } finally {
    await reset();
  }
}
