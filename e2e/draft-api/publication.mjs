import assert from "node:assert/strict";

export async function checkPublicationApi({
  request,
  sql,
  origin,
  cookie,
  secrets,
  email,
}) {
  const options = { owner: "fresh", method: "POST" };
  const meta = () => request("/api/owner/progress", {}, { owner: "fresh" });
  const current = await meta();
  const portfolioId = current.portfolioId;
  const check = (body, extra = {}) =>
    request("/api/owner/publication/check", body, { ...options, ...extra });
  const command = async () => ({
    portfolioId,
    revision: (await meta()).revision,
  });
  for (const owner of [null, "expired", "deleting"])
    await check(await command(), { owner, status: 401 });
  await check(await command(), {
    headers: { "X-Expected-Owner-Id": "draft-bob" },
    status: 409,
  });
  await check(await command(), {
    headers: { Origin: "https://evil.test" },
    status: 403,
  });
  await check(await command(), {
    headers: { "Content-Type": "text/plain" },
    status: 415,
  });
  await check({ ...(await command()), ready: true }, { status: 422 });
  await check(
    { ...(await command()), portfolioId: "foreign" },
    { status: 409 },
  );
  await check({ ...(await command()), revision: 0 }, { status: 409 });
  // Setup handed off this owner permanently, then removed its name. That
  // milestone must not make the publication checklist pass.
  let checked = await check(await command());
  assert.ok(
    checked.issues.some((issue) => issue.path.join(".") === "profile.name"),
  );
  const draft = (await request("/api/owner/draft", {}, { owner: "fresh" }))
    .draft;
  draft.profile.name = "Publication owner";
  draft.profile.bio = "My own biography";
  draft.appearance = {
    themeId: "leaf",
    fontId: "dm-sans",
    colorMode: "system",
  };
  draft.components = [];
  draft.samples = {};
  delete draft.profile.decorationId;
  draft.profile.faceReveal = {
    enabled: false,
    image: { assetId: "retained-missing-face" },
  };
  draft.seo = {};
  draft.links = [
    {
      id: "website",
      label: "Website",
      kind: "website",
      value: "https://example.com",
      showInProfile: true,
      showInSocialComponent: false,
    },
  ];
  async function save(value = draft) {
    await sql(
      "UPDATE portfolio SET draft=?,draft_rev=draft_rev+1,draft_validation_version=2 WHERE id=?",
      [JSON.stringify(value), portfolioId],
    );
    return command();
  }
  async function issues(value = draft) {
    const result = await check(await save(value));
    assert.equal(result.nextAssetOffset, null);
    return result.issues;
  }
  assert.deepEqual(await issues(), []);
  const before = await request("/api/owner/draft", {}, { owner: "fresh" });
  await check(await command());
  assert.deepEqual(
    await request("/api/owner/draft", {}, { owner: "fresh" }),
    before,
  );
  for (const purpose of ["avatar", "banner"]) {
    const original = draft.profile[purpose];
    draft.profile[purpose] = { ...original, assetId: "missing-object" };
    assert.ok((await issues()).some((issue) => issue.code === "asset"));
    draft.profile[purpose] = original;
  }
  for (const [column, value, restore] of [
    ["status", "pending", "ready"],
    ["status", "failed", "ready"],
    ["kind", "resume", "avatar"],
    ["content_type", "application/pdf", "image/png"],
  ]) {
    await sql(`UPDATE asset SET ${column}=? WHERE id=?`, [
      value,
      draft.profile.avatar.assetId,
    ]);
    assert.ok(
      (await issues()).some(
        (issue) => issue.path[0] === "profile" && issue.path[1] === "avatar",
      ),
    );
    await sql(`UPDATE asset SET ${column}=? WHERE id=?`, [
      restore,
      draft.profile.avatar.assetId,
    ]);
  }
  draft.components = [
    { id: "sample", type: "resume", version: 1, data: {} },
    {
      id: "edited",
      type: "projects",
      version: 1,
      data: {
        entries: [
          {
            id: "project",
            title: "",
            summary: "",
            technologies: [],
            contribution: "",
          },
        ],
      },
    },
    {
      id: "graph",
      type: "github",
      version: 1,
      data: { username: "example", includePrivate: false },
    },
    { id: "contact", type: "contact", version: 1, data: {} },
  ];
  draft.samples = { "components.sample": true };
  checked = await check(await save());
  assert.ok(
    !checked.issues.some(
      (issue) => issue.path[1] === 0 && issue.path[0] === "components",
    ),
  );
  assert.ok(
    checked.issues.some(
      (issue) => issue.path.join(".") === "components.1.data.entries.0.title",
    ),
  );
  assert.ok(checked.issues.some((issue) => issue.code === "github"));
  assert.ok(checked.issues.some((issue) => issue.code === "recipient"));
  draft.samples = {};
  assert.ok(
    (await issues()).some(
      (issue) => issue.path.join(".") === "components.0.data.file",
    ),
  );
  await sql(
    "INSERT INTO github_connection(portfolio_id,login,github_user_id,generation,status) VALUES(?,'example','123',0,'ok')",
    [portfolioId],
  );
  await sql(
    "INSERT INTO github_activity(portfolio_id,public_days,generation,public_calendar) VALUES(?,'[]',0,?)",
    [
      portfolioId,
      JSON.stringify({
        days: [{ date: "2026-10-23", count: 0 }],
        fetchedAt: "2026-10-23T00:00:00.000Z",
      }),
    ],
  );
  draft.components = [
    {
      id: "graph",
      type: "github",
      version: 1,
      data: { username: "example", includePrivate: false },
    },
  ];
  assert.deepEqual(await issues(), []);
  draft.components[0].data.includePrivate = true;
  assert.ok((await issues()).some((issue) => issue.code === "github"));
  draft.components[0].data.includePrivate = false;
  await sql("UPDATE github_connection SET generation=1 WHERE portfolio_id=?", [
    portfolioId,
  ]);
  assert.ok((await issues()).some((issue) => issue.code === "github"));
  // Phase 43: the recipient comes from the owner routes, not the draft. The
  // account's verified email needs no link; any other address does, and
  // changing the address blocks the form until it is confirmed again.
  draft.components = [{ id: "contact", type: "contact", version: 1, data: {} }];
  const recipient = (path = "", body = {}, extra = {}) =>
    request(`/api/owner/contact/recipient${path}`, body, {
      owner: "fresh",
      method: "POST",
      ...extra,
    });
  assert.ok((await issues()).some((issue) => issue.code === "recipient"));
  assert.deepEqual((await recipient("/account")).recipient, {
    email: "fresh@draft.example.test",
    state: "verified",
  });
  assert.deepEqual(await issues(), []);
  const changed = "changed-recipient@example.test";
  assert.equal(
    (await recipient("", { email: changed })).recipient.state,
    "pending",
  );
  assert.ok((await issues()).some((issue) => issue.code === "recipient"));
  const link = email
    .to(changed)
    .at(-1)
    .text.match(/#token=([\w-]+)/)[1];
  assert.equal(
    (await recipient("/verify", { token: link })).recipient.state,
    "verified",
  );
  assert.deepEqual(await issues(), []);
  await sql(
    "UPDATE contact_recipient SET verified_at=NULL WHERE portfolio_id=?",
    [portfolioId],
  );
  assert.ok((await issues()).some((issue) => issue.code === "recipient"));
  draft.components = [];
  for (const [field, value] of [
    ["themeId", "unknown"],
    ["fontId", "unknown"],
  ]) {
    const old = draft.appearance[field];
    draft.appearance[field] = value;
    assert.ok(
      (await issues()).some(
        (issue) => issue.path.join(".") === `appearance.${field}`,
      ),
    );
    draft.appearance[field] = old;
  }
  draft.profile.decorationId = "removed-decoration";
  assert.ok((await issues()).some((issue) => issue.code === "catalog"));
  delete draft.profile.decorationId;
  draft.profile.faceReveal.enabled = true;
  assert.ok(
    (await issues()).some((issue) =>
      issue.path.join(".").startsWith("profile.faceReveal"),
    ),
  );
  draft.profile.faceReveal.enabled = false;
  const held = await request("address-state", {}, { owner: "fresh" });
  await sql(
    "DELETE FROM subdomain_claim WHERE portfolio_id=? AND state='held'",
    [portfolioId],
  );
  assert.ok((await issues()).some((issue) => issue.code === "address"));
  assert.equal(
    (await request("/api/owner/entry", {}, options)).entry.kind,
    "editor",
  );
  await sql(
    "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES(?,?,'held',?)",
    [held.name, portfolioId, Date.now()],
  );
  // Use actual R2 bytes, not metadata alone, for the bounded object pages.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  let assetId;
  const response = await fetch(`${origin}/api/assets`, {
    method: "PUT",
    headers: {
      Cookie: cookie("fresh"),
      Origin: origin,
      "X-Runtime-Key": secrets.RUNTIME_KEY,
      "X-Expected-Owner-Id": "draft-fresh",
      "Content-Type": "image/png",
      "X-Asset-Purpose": "project",
      "X-Asset-Bytes": String(png.length),
    },
    body: png,
  });
  assert.equal(response.status, 201);
  assetId = (await response.json()).id;
  draft.components = [
    {
      id: "many",
      type: "projects",
      version: 1,
      data: {
        entries: Array.from({ length: 18 }, (_, index) => ({
          id: `p${index}`,
          title: "Project",
          summary: "Summary",
          technologies: [],
          contribution: "",
          image: { assetId },
        })),
      },
    },
  ];
  let next = await check(await save());
  assert.equal(next.issues.length, 0);
  assert.ok(next.nextAssetOffset > 0);
  let pages = 1;
  while (next.nextAssetOffset !== null) {
    next = await check({
      ...(await command()),
      assetOffset: next.nextAssetOffset,
    });
    assert.equal(next.issues.length, 0);
    pages++;
  }
  assert.ok(pages >= 3);
  const revision = await command();
  await save();
  await check({ ...revision, assetOffset: 8 }, { status: 409 });
  draft.components = [];
  // A compatible historical publication may have no requested-address mirror.
  // The permanent owned claim and fixed published address are authoritative.
  await sql(
    "DELETE FROM subdomain_claim WHERE portfolio_id=? AND state='held'",
    [portfolioId],
  );
  delete draft.requestedSubdomain;
  await save();
  await sql(
    "INSERT INTO subdomain_claim(name,portfolio_id,state,claimed_at) VALUES(?,?,'claimed',?)",
    [held.name, portfolioId, Date.now()],
  );
  await sql("UPDATE portfolio SET subdomain=? WHERE id=?", [
    held.name,
    portfolioId,
  ]);
  assert.deepEqual(await issues(), []);
  await sql("UPDATE portfolio SET subdomain='different-address' WHERE id=?", [
    portfolioId,
  ]);
  assert.ok((await issues()).some((issue) => issue.code === "address"));
  await sql("UPDATE portfolio SET subdomain=? WHERE id=?", [
    held.name,
    portfolioId,
  ]);
  draft.profile.bio = "";
  draft.profile.bio = "x".repeat(
    1048576 - Buffer.byteLength(JSON.stringify(draft)),
  );
  assert.equal(Buffer.byteLength(JSON.stringify(draft)), 1048576);
  assert.deepEqual(await issues(), []);
}
