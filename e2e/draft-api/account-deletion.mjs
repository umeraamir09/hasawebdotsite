import assert from "node:assert/strict";

// Phase 49. Uses its own owner, `draft-leaver`, with a second device's
// session (`leaver-other`): deletion is permanent, so seeded owners stay out.
export async function checkAccountDeletion({
  origin,
  secrets,
  sql,
  cookie,
  request,
}) {
  const owner = { owner: "leaver" };
  const created = await request(
    "/api/owner/portfolio",
    {},
    {
      method: "POST",
      ...owner,
    },
  );
  const portfolioId = created.portfolio.id;
  // A never-published reservation, unique per run.
  const name = `leaver-${Date.now().toString(36)}`;
  await sql(
    "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES(?,?,'held',?)",
    [name, portfolioId, Date.now()],
  );
  assert.equal(
    (await request("address-availability", { name }, { owner: "bob" })).status,
    "unavailable",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = await fetch(`${origin}/api/assets`, {
    method: "PUT",
    headers: {
      Cookie: cookie("leaver"),
      Origin: origin,
      "X-Runtime-Key": secrets.RUNTIME_KEY,
      "X-Expected-Owner-Id": "draft-leaver",
      "Content-Type": "image/png",
      "X-Asset-Purpose": "avatar",
      "X-Asset-Bytes": String(png.length),
    },
    body: png,
  });
  assert.equal(upload.status, 201);
  const assetId = (await upload.json()).id;
  const readAsset = (session) =>
    fetch(`${origin}/api/assets/${assetId}`, {
      headers: {
        Cookie: cookie(session),
        "X-Runtime-Key": secrets.RUNTIME_KEY,
      },
    });
  for (const session of ["leaver", "leaver-other"])
    assert.equal((await readAsset(session)).status, 200);

  // Without the confirmation, or from a tab of another account, nothing
  // changes: this is what cancelling leaves.
  const remove = (body, options = {}) =>
    request("/api/owner/account/delete", body, {
      method: "POST",
      ...owner,
      ...options,
    });
  for (const body of [{}, { confirm: "yes" }])
    assert.deepEqual(await remove(body, { status: 422 }), {
      error: "invalid_input",
    });
  assert.deepEqual(
    await remove(
      { confirm: "delete-account" },
      { headers: { "X-Expected-Owner-Id": "draft-bob" }, status: 409 },
    ),
    { error: "owner_changed" },
  );
  await remove({ confirm: "delete-account" }, { method: "GET", status: 405 });
  assert.equal(
    (await request("/api/owner", {}, { owner: "leaver-other" })).user.id,
    "draft-leaver",
  );
  assert.deepEqual(
    (
      await sql(
        "SELECT u.deleting_at,p.status,(SELECT count(*) FROM session WHERE user_id=u.id) AS sessions FROM user u JOIN portfolio p ON p.user_id=u.id WHERE u.id='draft-leaver'",
      )
    )[0],
    { deleting_at: null, status: "draft", sessions: 2 },
  );

  const response = await fetch(`${origin}/api/owner/account/delete`, {
    method: "POST",
    headers: {
      Cookie: cookie("leaver"),
      Origin: origin,
      "X-Runtime-Key": secrets.RUNTIME_KEY,
      "Content-Type": "application/json",
      "X-Expected-Owner-Id": "draft-leaver",
    },
    body: JSON.stringify({ confirm: "delete-account" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const cleared = response.headers.getSetCookie();
  assert.ok(
    cleared.some((value) =>
      /^(__Host-hasaweb|hasaweb-local)\.session_token=; Path=\/; Max-Age=0; HttpOnly/.test(
        value,
      ),
    ),
    JSON.stringify(cleared),
  );

  // Every session, including another device's still-valid cookie, is denied
  // at once on owner routes, provisioning, uploads and asset reads.
  for (const session of ["leaver", "leaver-other"]) {
    const as = { owner: session, status: 401 };
    await request("/api/owner", {}, as);
    await request("/api/owner/draft", {}, as);
    await request("/api/owner/providers", {}, as);
    await request("/api/owner/portfolio", {}, { method: "POST", ...as });
    await request("/api/owner/entry", {}, { method: "POST", ...as });
    await remove({ confirm: "delete-account" }, as);
    assert.equal((await readAsset(session)).status, 404);
    const again = await fetch(`${origin}/api/assets`, {
      method: "PUT",
      headers: {
        Cookie: cookie(session),
        Origin: origin,
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        "X-Expected-Owner-Id": "draft-leaver",
        "Content-Type": "image/png",
        "X-Asset-Purpose": "avatar",
        "X-Asset-Bytes": String(png.length),
      },
      body: png,
    });
    assert.ok([401, 404].includes(again.status), String(again.status));
  }
  const [state] = await sql(
    "SELECT u.deleting_at,p.status,(SELECT count(*) FROM session WHERE user_id=u.id) AS sessions,(SELECT stage FROM account_deletion WHERE user_id=u.id) AS stage FROM user u JOIN portfolio p ON p.user_id=u.id WHERE u.id='draft-leaver'",
  );
  assert.ok(state.deleting_at > 0);
  assert.deepEqual(
    { status: state.status, sessions: state.sessions },
    { status: "deleting", sessions: 0 },
  );
  // The queued cleanup may have started; the recent upload keeps it from
  // reaching the private prefix and the account rows yet.
  assert.ok(
    ["public", "purge", "verify", "candidates", "draft"].includes(state.stage),
    state.stage,
  );
  // The never-published name is released at once and free for others.
  assert.deepEqual(
    await sql("SELECT * FROM subdomain_claim WHERE name=?", [name]),
    [],
  );
  assert.equal(
    (await request("address-availability", { name }, { owner: "bob" })).status,
    "available",
  );
  // Other accounts are untouched.
  assert.equal(
    (await request("/api/owner", {}, { owner: "bob" })).user.id,
    "draft-bob",
  );
}
