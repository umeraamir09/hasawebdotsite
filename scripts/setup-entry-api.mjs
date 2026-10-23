import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkSetupEntry({
  request,
  sql,
  fixture,
  origin,
  cookie,
  secrets,
}) {
  const options = { owner: "fresh", method: "POST" };
  const entry = () => request("/api/owner/entry", {}, options);
  const entries = await Promise.all([entry(), entry(), entry()]);
  assert.ok(entries.every((v) => v.portfolio.id === entries[0].portfolio.id));
  assert.equal(entries[0].entry.kind, "setup");
  assert.equal(entries[0].entry.progress.step, "address");
  const portfolioId = entries[0].portfolio.id;
  await request(
    "/api/owner/entry",
    { firstEditorEnteredAt: 1 },
    { ...options, status: 400 },
  );
  const meta = () => request("/api/owner/progress", {}, { owner: "fresh" });
  const check = (command, extra = {}) =>
    request("/api/owner/setup/check", command, { ...options, ...extra });
  const handoff = (command, extra = {}) =>
    request("/api/owner/setup/handoff", command, { ...options, ...extra });
  const command = async () => ({
    portfolioId,
    revision: (await meta()).revision,
  });
  let expected = await command();
  assert.deepEqual((await check(expected)).issues, [
    "address",
    "name",
    "bio",
    "avatar",
    "banner",
    "links",
  ]);
  for (const owner of [null, "expired", "deleting"])
    await handoff(expected, { owner, status: 401 });
  await handoff(expected, {
    headers: { "X-Expected-Owner-Id": "" },
    status: 400,
  });
  await handoff(expected, {
    headers: { "X-Expected-Owner-Id": "draft-bob" },
    status: 409,
  });
  await handoff(expected, {
    headers: { Origin: "https://evil.test" },
    status: 403,
  });
  await handoff(expected, {
    headers: { "Content-Type": "text/plain" },
    status: 415,
  });
  await handoff({ ...expected, firstEditorEnteredAt: 1 }, { status: 422 });
  await handoff(" ".repeat(1025), {
    headers: { "Content-Length": "1025" },
    status: 413,
  });
  await handoff(expected, { method: "GET", status: 405 });
  await handoff({ ...expected, portfolioId: "foreign" }, { status: 409 });
  const draft = structuredClone(fixture);
  draft.samples = {};
  draft.requestedSubdomain = "setup-handoff";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  for (const purpose of ["avatar", "banner"]) {
    const response = await fetch(`${origin}/api/assets`, {
      method: "PUT",
      headers: {
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        Origin: origin,
        Cookie: cookie("fresh"),
        "Content-Type": "image/png",
        "X-Asset-Purpose": purpose,
        "X-Asset-Bytes": String(png.length),
        "X-Expected-Owner-Id": "draft-fresh",
      },
      body: png,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const asset = await response.json();
    draft.profile[purpose] = {
      assetId: asset.id,
      ...(purpose === "avatar" ? { accepted: true } : {}),
    };
  }
  const set = async (value = draft, generation = 2) => {
    await sql(
      "UPDATE portfolio SET draft=?,draft_validation_version=?,draft_rev=draft_rev+1 WHERE id=?",
      [JSON.stringify(value), generation, portfolioId],
    );
    return command();
  };
  expected = await set();
  assert.deepEqual((await check(expected)).issues, ["address"]);
  await request(
    "address",
    {
      id: randomUUID(),
      ...expected,
      context: "setup",
      name: draft.requestedSubdomain,
      progress: { schemaVersion: 1, step: "review" },
    },
    { owner: "fresh" },
  );
  expected = await command();
  assert.equal((await check(expected)).kind, "ready");
  await sql("INSERT INTO reserved_subdomain(name) VALUES(?)", [
    draft.requestedSubdomain,
  ]);
  assert.deepEqual((await check(expected)).issues, ["address"]);
  await sql("DELETE FROM reserved_subdomain WHERE name=?", [
    draft.requestedSubdomain,
  ]);
  for (const field of ["name", "bio", "avatar", "banner"]) {
    const sample = structuredClone(draft);
    sample.samples[`profile.${field}`] = true;
    expected = await set(sample);
    assert.ok((await check(expected)).issues.includes(field));
  }
  for (const field of ["name", "bio"]) {
    const empty = structuredClone(draft);
    empty.profile[field] = "\t\n\u00a0\u2003";
    expected = await set(empty);
    assert.ok((await check(expected)).issues.includes(field));
  }
  for (const status of ["pending", "failed"]) {
    expected = await set();
    await sql("UPDATE asset SET status=? WHERE id=?", [
      status,
      draft.profile.avatar.assetId,
    ]);
    assert.ok((await check(expected)).issues.includes("avatar"));
  }
  await sql("UPDATE asset SET status='ready',kind='banner' WHERE id=?", [
    draft.profile.avatar.assetId,
  ]);
  assert.ok((await check(expected)).issues.includes("avatar"));
  await sql("UPDATE asset SET kind='avatar' WHERE id=?", [
    draft.profile.avatar.assetId,
  ]);
  const missing = structuredClone(draft);
  missing.profile.banner.assetId = "ready-without-object";
  await sql(
    "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES(?,?,'banner','image/png',1,'ready',?,?)",
    [missing.profile.banner.assetId, portfolioId, Date.now(), Date.now()],
  );
  expected = await set(missing);
  assert.ok((await check(expected)).issues.includes("banner"));
  await sql(
    "UPDATE asset SET portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-bob') WHERE id=?",
    [draft.profile.banner.assetId],
  );
  expected = await set();
  assert.ok((await check(expected)).issues.includes("banner"));
  await sql("UPDATE asset SET portfolio_id=? WHERE id=?", [
    portfolioId,
    draft.profile.banner.assetId,
  ]);
  const unaccepted = structuredClone(draft);
  unaccepted.profile.avatar.accepted = false;
  expected = await set(unaccepted);
  assert.ok((await check(expected)).issues.includes("avatar"));
  for (const links of [
    [],
    draft.links.map((l) => ({ ...l, showInProfile: false })),
    draft.links.map((l) => ({ ...l, label: "\t " })),
    draft.links.map((l) => ({ ...l, value: "" })),
  ]) {
    expected = await set({ ...draft, links });
    assert.ok((await check(expected)).issues.includes("links"));
  }
  expected = await set(draft, 0);
  assert.equal(
    (await handoff(expected, { status: 409 })).error,
    "validation_required",
  );
  expected = await set();
  await request(
    "begin",
    {
      revision: expected.revision,
      context: "setup",
      progress: { schemaVersion: 1, step: "review" },
    },
    { owner: "fresh" },
  );
  await handoff(expected, { status: 409 });
  await sql("DELETE FROM owner_save_attempt WHERE user_id='draft-fresh'");
  await handoff(
    { ...expected, revision: expected.revision - 1 },
    { status: 409 },
  );
  await handoff(expected, {
    headers: { "X-Fixture-Setup-Fail": "1" },
    status: 503,
  });
  assert.equal((await meta()).firstEditorEnteredAt, null);
  const race = (query, values = []) => ({
    headers: { "X-Fixture-Setup-SQL": JSON.stringify([{ query, values }]) },
  });
  assert.ok(
    (
      await handoff(
        expected,
        race("UPDATE asset SET status='failed' WHERE id=?", [
          draft.profile.avatar.assetId,
        ]),
      )
    ).issues.includes("avatar"),
  );
  assert.equal((await meta()).firstEditorEnteredAt, null);
  await sql("UPDATE asset SET status='ready' WHERE id=?", [
    draft.profile.avatar.assetId,
  ]);
  assert.ok(
    (
      await handoff(
        expected,
        race("INSERT INTO reserved_subdomain(name) VALUES(?)", [
          draft.requestedSubdomain,
        ]),
      )
    ).issues.includes("address"),
  );
  await sql("DELETE FROM reserved_subdomain WHERE name=?", [
    draft.requestedSubdomain,
  ]);
  await handoff(expected, {
    ...race("UPDATE portfolio SET draft_rev=draft_rev+1 WHERE id=?", [
      portfolioId,
    ]),
    status: 409,
  });
  expected = await command();
  await handoff(expected, {
    ...race("UPDATE session SET expires_at=1 WHERE id='draft-session-fresh'"),
    status: 401,
  });
  await sql("UPDATE session SET expires_at=? WHERE id='draft-session-fresh'", [
    Date.now() + 7200000,
  ]);
  await handoff(expected, {
    ...race("UPDATE user SET deleting_at=? WHERE id='draft-fresh'", [
      Date.now(),
    ]),
    status: 401,
  });
  await sql("UPDATE user SET deleting_at=NULL WHERE id='draft-fresh'");
  const large = structuredClone(draft);
  large.profile.bio = "";
  large.components = [];
  large.profile.bio = "x".repeat(
    1048576 - Buffer.byteLength(JSON.stringify(large)),
  );
  assert.equal(Buffer.byteLength(JSON.stringify(large)), 1048576);
  expected = await set(large);
  assert.equal((await check(expected)).kind, "ready");
  const before = await request("/api/owner/draft", {}, { owner: "fresh" });
  const results = await Promise.all([handoff(expected), handoff(expected)]);
  assert.ok(results.every((r) => r.kind === "editor"));
  assert.equal(
    results[0].firstEditorEnteredAt,
    results[1].firstEditorEnteredAt,
  );
  assert.equal((await meta()).revision, expected.revision + 1);
  assert.deepEqual(
    (await request("/api/owner/draft", {}, { owner: "fresh" })).draft,
    before.draft,
  );
  await sql(
    "UPDATE portfolio SET draft=json_set(draft,'$.profile.name',''),draft_rev=draft_rev+1 WHERE id=?",
    [portfolioId],
  );
  assert.equal((await entry()).entry.kind, "editor");
  assert.equal(
    (await handoff(expected)).firstEditorEnteredAt,
    results[0].firstEditorEnteredAt,
  );
  assert.equal(
    (
      await request(
        "progress",
        {
          revision: (await meta()).revision,
          progress: { schemaVersion: 1, step: "address" },
        },
        { owner: "fresh", status: 409 },
      )
    ).error,
    "setup_closed",
  );
  assert.equal(
    (
      await request(
        "address",
        {
          id: randomUUID(),
          portfolioId,
          revision: (await meta()).revision,
          context: "setup",
          name: "stale-setup",
          progress: { schemaVersion: 1, step: "address" },
        },
        { owner: "fresh", status: 409 },
      )
    ).error,
    "setup_closed",
  );
  assert.equal(
    (await request("address-state", {}, { owner: "fresh" })).name,
    draft.requestedSubdomain,
  );
}
