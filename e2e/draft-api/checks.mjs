import assert from "node:assert/strict";

// Draft and progress API contracts through the built web Worker and the
// real jobs owner router. `check(name, work)` reports one named group.
export async function checkDraftApi(runtime, check) {
  const {
    origin,
    secrets,
    fixture,
    progress,
    readDraft,
    draftSchema,
    sql,
    cookie,
    request,
    read,
    patch,
    pending,
    clear,
    setDraft,
    validateUntilStop,
    start,
    stop,
    email,
    turnstile,
  } = runtime;
  await check(
    "strict bounded request parsing and unsafe path rejection",
    async () => {
      await request("patch", new Uint8Array([0x7b, 0xff, 0x7d]), {
        status: 400,
      });
      await request("patch", " ".repeat(8193), { status: 413 });
      await request("patch", "{", { status: 400 });
      await request("__proto__", {}, { status: 404 });
      for (const value of [
        {
          context: "content",
          revision: 0,
          progress,
          change: { op: "set", path: ["profile", "name"], value: "x" },
        },
        {
          context: "setup",
          revision: 0,
          progress: { ...progress, enteredEditor: true },
          change: { op: "set", path: ["profile", "name"], value: "x" },
        },
      ])
        await request("patch", value, { status: 422 });
      for (const path of [
        ["__proto__"],
        ["firstEditorEnteredAt"],
        ["publishedVersion"],
        ["userId"],
      ])
        await patch(0, path, "x", { status: 422 });
    },
  );
  let revision;
  await check(
    "consistent reads and atomic content/progress races",
    async () => {
      revision = await setDraft(fixture);
      const saved = await read();
      assert.deepEqual(saved.draft, fixture);
      assert.equal(saved.revision, revision);
      const results = await Promise.all([
        patch(revision, ["profile", "name"], "Winner", { status: [200, 409] }),
        request("progress", { revision, progress }, { status: [200, 409] }),
      ]);
      assert.equal(
        results.filter((row) => row.revision !== undefined).length,
        1,
      );
      revision = (await read()).revision;
      assert.equal(
        (
          await patch(revision - 1, ["profile", "name"], "Stale", {
            status: 409,
          })
        ).error,
        "revision_conflict",
      );
      const before = await read();
      await patch(
        revision,
        ["components", 1, "data", "entries", 0, "categoryId"],
        "missing",
        { status: 409 },
      );
      assert.deepEqual(await read(), before);
      assert.equal(
        (
          await request(
            "/api/owner/draft",
            {},
            {
              headers: { "X-Fixture-Fail-Read": "true" },
              status: 503,
            },
          )
        ).error,
        "storage_unavailable",
      );
      for (let i = 0; i < fixture.components.length; i++)
        revision = (
          await patch(revision, ["components", i], fixture.components[i])
        ).revision;
    },
  );
  await check(
    "approved destination boundaries and cross-document invariants",
    async () => {
      const prefix = "https://example.test/",
        url = prefix + '"'.repeat(2048 - prefix.length),
        email = `${"a".repeat(242)}@example.com`;
      for (const [index, value] of [
        [1, url],
        [0, email],
      ]) {
        revision = (
          await patch(revision, ["links", index], {
            ...fixture.links[index],
            value,
          })
        ).revision;
        await patch(
          revision,
          ["links", index],
          { ...fixture.links[index], value: `${value}x` },
          { status: 422 },
        );
      }
      await request(
        "patch",
        {
          revision,
          context: "content",
          change: {
            op: "append",
            path: ["components"],
            values: [fixture.components[0]],
          },
        },
        { status: 409 },
      );
      await patch(revision, ["samples", "components.missing"], true, {
        status: 409,
      });
      await patch(revision, ["links", 0, "value"], "unsafe", { status: 422 });
    },
  );
  await check(
    "rich-text submissions reject executable nodes and preserve canonical content",
    async () => {
      revision = await setDraft(fixture);
      const before = await read();
      for (const body of [
        "<script>alert(1)</script>",
        { type: "doc", content: [{ type: "script", content: "alert(1)" }] },
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { onclick: "alert(1)", style: "color:red" },
            },
          ],
        },
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Unsafe link",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
          ],
        },
      ]) {
        await patch(revision, ["components", 3, "data", "body"], body, {
          status: 422,
        });
        assert.deepEqual(await read(), before);
      }
    },
  );
  await check(
    "case-study image nodes cannot bypass rich-text sanitization",
    async () => {
      revision = await setDraft(fixture);
      const before = await read();
      const caseBody = [
        "components",
        0,
        "data",
        "entries",
        0,
        "caseStudy",
        "body",
      ];
      const doc = (...content) => ({ type: "doc", content });
      const image = (attrs) => ({ type: "image", attrs });
      for (const [path, body] of [
        // Remote or script URLs, event handlers and extra attributes.
        [
          caseBody,
          doc(
            image({ assetId: "case-image", src: "https://evil.example/x.png" }),
          ),
        ],
        [
          caseBody,
          doc(image({ assetId: "case-image", alt: "x", onerror: "alert(1)" })),
        ],
        [
          caseBody,
          doc(image({ assetId: "case-image", style: "position:fixed" })),
        ],
        [caseBody, doc(image({ src: "javascript:alert(1)" }))],
        [caseBody, doc(image({ assetId: "../../etc/passwd" }))],
        [caseBody, doc(image({ assetId: "case-image", alt: 1 }))],
        [
          caseBody,
          doc({
            ...image({ assetId: "case-image" }),
            content: [{ type: "text", text: "x" }],
          }),
        ],
        [
          caseBody,
          doc({
            ...image({ assetId: "case-image" }),
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          }),
        ],
        [
          caseBody,
          doc({ type: "img", attrs: { src: "https://evil.example/x.png" } }),
        ],
        [caseBody, '<img src="x" onerror="alert(1)">'],
        // Images are blocks in case studies only: not inline, in lists or text sections.
        [
          caseBody,
          doc({
            type: "paragraph",
            content: [image({ assetId: "case-image" })],
          }),
        ],
        [
          caseBody,
          doc({
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph" },
                  image({ assetId: "case-image" }),
                ],
              },
            ],
          }),
        ],
        [
          ["components", 3, "data", "body"],
          doc(image({ assetId: "case-image" })),
        ],
        [
          [
            "components",
            0,
            "data",
            "entries",
            0,
            "caseStudy",
            "body",
            "content",
            3,
            "attrs",
          ],
          { assetId: "case-image", src: "https://evil.example/x.png" },
        ],
      ]) {
        await patch(revision, path, body, { status: 422 });
        assert.deepEqual(await read(), before);
      }
    },
  );
  await check(
    "attempt ownership, retries, transfer, stale commits and commit receipts",
    async () => {
      const attempt = await request("begin", {
        revision,
        context: "setup",
        progress,
      });
      assert.equal((await pending()).id, attempt.id);
      for (const action of ["status", "resume", "abort"])
        await request(
          action,
          { id: attempt.id },
          { owner: "bob", status: 409 },
        );
      const command = {
        id: attempt.id,
        sequence: 0,
        change: { op: "set", path: ["profile", "name"], value: "Prepared" },
      };
      await request(
        "change",
        { ...command, context: "content" },
        { status: 422 },
      );
      assert.equal((await request("change", command)).sequence, 1);
      assert.equal((await request("change", command)).replayed, true);
      await request(
        "change",
        { ...command, change: { ...command.change, value: "Mutated" } },
        { status: 409 },
      );
      assert.notEqual((await read()).draft.profile.name, "Prepared");
      const transferred = await request(
        "resume",
        { id: attempt.id },
        { owner: "alice-other" },
      );
      assert.equal(transferred.sequence, 2);
      assert.equal(
        (await request("resume", { id: attempt.id }, { owner: "alice-other" }))
          .sequence,
        2,
      );
      await request("commit", { id: attempt.id, sequence: 2 }, { status: 409 });
      revision = (
        await request(
          "commit",
          { id: attempt.id, sequence: 2 },
          { owner: "alice-other" },
        )
      ).revision;
      assert.equal(
        (
          await request(
            "commit",
            { id: attempt.id, sequence: 2 },
            { owner: "alice-other" },
          )
        ).replayed,
        true,
      );
      assert.equal((await pending()).state, "committed");
      await request("cleanup");
      const stale = await request("begin", { revision, context: "content" });
      revision = (await patch(revision, ["profile", "name"], "Newer")).revision;
      await request("commit", { id: stale.id, sequence: 0 }, { status: 409 });
      await request("abort", { id: stale.id });
      await request("cleanup");
    },
  );
  await check(
    "large free text, encoded pieces and exact document ceiling",
    async () => {
      revision = await setDraft(fixture);
      const base = structuredClone(fixture);
      base.profile.bio = "";
      const length = 1048576 - Buffer.byteLength(JSON.stringify(base)),
        attempt = await request("begin", { revision, context: "content" });
      let sequence = (
        await request("string-start", {
          id: attempt.id,
          sequence: 0,
          path: ["profile", "bio"],
        })
      ).sequence;
      for (let offset = 0; offset < length; offset += 4000)
        sequence = (
          await request("piece", {
            id: attempt.id,
            sequence,
            text: "x".repeat(Math.min(4000, length - offset)),
          })
        ).sequence;
      await request(
        "piece",
        { id: attempt.id, sequence, text: "x".repeat(4095) },
        { status: 422 },
      );
      const finished = await request("string-finish", {
        id: attempt.id,
        sequence,
      });
      sequence = finished.sequence;
      assert.equal(
        (
          await request("string-finish", {
            id: attempt.id,
            sequence: sequence - 1,
          })
        ).replayed,
        true,
      );
      revision = (await request("commit", { id: attempt.id, sequence }))
        .revision;
      const saved = await read();
      assert.equal(Buffer.byteLength(JSON.stringify(saved.draft)), 1048576);
      draftSchema.parse(saved.draft);
      await patch(revision, ["profile", "bio"], "y".repeat(6000), {
        status: 422,
      });
      await patch(
        revision,
        ["profile", "name"],
        `${saved.draft.profile.name}x`,
        { status: 409 },
      );
      const cleaned = await request("cleanup");
      assert.ok(cleaned.pieces <= 32);
      while (await pending()) {
        const batch = await request("cleanup");
        assert.ok(batch.pieces <= 32);
      }
      const unicode = await request("begin", { revision, context: "content" });
      sequence = (
        await request("string-start", {
          id: unicode.id,
          sequence: 0,
          path: ["profile", "bio"],
        })
      ).sequence;
      sequence = (
        await request("piece", { id: unicode.id, sequence, text: "\ud83d" })
      ).sequence;
      await request(
        "piece",
        { id: unicode.id, sequence, text: "\ude00" },
        { status: 422 },
      );
      await request("abort", { id: unicode.id });
      await request("cleanup");
    },
  );
  await check(
    "bounded validation agrees with full reference schemas",
    async () => {
      const valid = [
        fixture,
        {
          ...fixture,
          profile: { ...fixture.profile, bio: "lone \ud83d and \ude00" },
        },
        {
          ...fixture,
          profile: { ...fixture.profile, bio: "\u0000😀".repeat(5000) },
        },
        { ...fixture, schemaVersion: 1 },
      ];
      const invalid = [];
      // Walk to the actual shared depth boundary, including a maximum URL at
      // the deepest valid text mark. This also catches cursor-budget stalls.
      let deepest;
      for (let depth = 0; depth < 30; depth++) {
        const value = structuredClone(fixture);
        const prefix = "https://example.test/";
        let list = {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Deep",
                      marks: [
                        {
                          type: "link",
                          attrs: {
                            href: prefix + '"'.repeat(2048 - prefix.length),
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        };
        for (let i = 0; i < depth; i++)
          list = {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              { type: "listItem", content: [{ type: "paragraph" }, list] },
            ],
          };
        value.components[3].data.body = { type: "doc", content: [list] };
        try {
          readDraft(value);
          deepest = value;
        } catch {
          invalid.push(value);
          break;
        }
      }
      assert.ok(deepest);
      valid.push(deepest);
      const mutate = (fn) => {
        const value = structuredClone(fixture);
        fn(value);
        invalid.push(value);
      };
      mutate((v) => {
        v.profile.extra = true;
      });
      mutate((v) => {
        delete v.profile.name;
      });
      mutate((v) => {
        v.components[0].version = 99;
      });
      mutate((v) => {
        v.components.push(structuredClone(v.components[0]));
      });
      mutate((v) => {
        v.components[1].data.entries[0].categoryId = "missing";
      });
      mutate((v) => {
        v.components[2].data.entries[0].endDate = "2020-01";
      });
      mutate((v) => {
        v.samples["components.missing"] = true;
      });
      mutate((v) => {
        v.links[0].value = "https://example.test";
      });
      mutate((v) => {
        v.links[0].value = `${"a".repeat(2048 - "@example.test".length)}@example.test`;
      });
      mutate((v) => {
        v.profile.faceReveal.enabled = 1;
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [] }],
            },
          ],
        };
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Link",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
          ],
        };
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "" }] },
          ],
        };
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [{ type: "heading", attrs: { level: 1 } }],
        };
      });
      mutate((v) => {
        v.components[3].data.body = "<script>alert(1)</script>";
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [{ type: "script", content: "alert(1)" }],
        };
      });
      mutate((v) => {
        v.components[3].data.body = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { onclick: "alert(1)", style: "color:red" },
            },
          ],
        };
      });
      revision = await setDraft({ ...fixture, schemaVersion: 1 }, 0);
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio','') WHERE user_id='draft-alice'",
      );
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio',replace(hex(zeroblob((1048576-length(CAST(draft AS BLOB)))/2)),'0','x') || CASE WHEN (1048576-length(CAST(draft AS BLOB)))%2 THEN 'x' ELSE '' END) WHERE user_id='draft-alice'",
      );
      const large = await request("/api/owner/draft/recovery");
      assert.equal(Buffer.byteLength(JSON.stringify(large.draft)), 1048576);
      readDraft(large.draft);
      const staged = await request("validation-begin", { revision }),
        checked = await validateUntilStop(staged);
      assert.equal(checked.complete, true);
      await request("commit", {
        id: staged.id,
        sequence: checked.sequence,
      });
      assert.deepEqual((await read()).draft, readDraft(large.draft));
      for (const [expected, values] of [
        [true, valid],
        [false, invalid],
      ])
        for (const value of values) {
          let reference = true,
            referenceIssue = "";
          try {
            readDraft(value);
          } catch (error) {
            reference = false;
            referenceIssue = JSON.stringify(
              error.issues?.map((issue) => ({
                path: issue.path,
                code: issue.code,
              })) ?? error.message,
            );
          }
          assert.equal(reference, expected);
          revision = await setDraft(value, 0);
          assert.equal(
            (await request("/api/owner/draft", {}, { status: 409 })).error,
            "validation_required",
          );
          const attempt = await request("validation-begin", { revision });
          const result = await validateUntilStop(attempt);
          if (
            value.links[0].kind === "email" &&
            Buffer.byteLength(value.links[0].value) > 254
          ) {
            assert.deepEqual(result.issue.path, ["links", 0, "value"]);
            assert.ok(
              result.validationBytes < 2048,
              "Do not load an oversized legacy email",
            );
          }
          assert.equal(
            result.complete,
            reference,
            referenceIssue || JSON.stringify(value).slice(0, 100),
          );
          assert.deepEqual(
            (await request("/api/owner/draft/recovery")).draft,
            value,
          );
          if (expected) {
            revision = (
              await request("commit", {
                id: attempt.id,
                sequence: result.sequence,
              })
            ).revision;
            assert.deepEqual((await read()).draft, readDraft(value));
          } else
            await request(
              "commit",
              { id: attempt.id, sequence: result.sequence },
              { status: 409 },
            );
        }
    },
  );
  await check(
    "explicit legacy corrections stay staged and restart validation",
    async () => {
      const legacy = structuredClone(fixture);
      legacy.schemaVersion = 1;
      legacy.links[1].value = `https://example.test/${"x".repeat(2048)}`;
      revision = await setDraft(legacy, 0);
      const attempt = await request("validation-begin", { revision });
      let result = await validateUntilStop(attempt);
      assert.deepEqual(result.issue, {
        path: ["links", 1, "value"],
        code: "invalid_destination",
      });
      await request(
        "validation-correct",
        {
          id: attempt.id,
          sequence: result.sequence,
          path: ["profile", "name"],
          value: "No",
        },
        { status: 422 },
      );
      await request(
        "validation-correct",
        {
          id: attempt.id,
          sequence: result.sequence,
          path: result.issue.path,
          value: "javascript:alert(1)",
        },
        { status: 422 },
      );
      const command = {
        id: attempt.id,
        sequence: result.sequence,
        path: result.issue.path,
        value: "https://example.test/fixed",
      };
      result = await request("validation-correct", command);
      assert.equal(
        (await request("validation-correct", command)).replayed,
        true,
      );
      assert.deepEqual(
        (await request("/api/owner/draft/recovery")).draft,
        legacy,
      );
      result = await validateUntilStop({
        id: attempt.id,
        sequence: result.sequence,
      });
      assert.equal(result.complete, true);
      revision = (
        await request("commit", { id: attempt.id, sequence: result.sequence })
      ).revision;
      legacy.links[1].value = command.value;
      assert.deepEqual((await read()).draft, readDraft(legacy));
      legacy.links[1].value = "javascript:alert(1)";
      revision = await setDraft(legacy, 0);
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio','') WHERE user_id='draft-alice'",
      );
      await sql(
        "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio',replace(hex(zeroblob((1048576-length(CAST(draft AS BLOB)))/2)),'0','x') || CASE WHEN (1048576-length(CAST(draft AS BLOB)))%2 THEN 'x' ELSE '' END) WHERE user_id='draft-alice'",
      );
      const canonical = await request("/api/owner/draft/recovery");
      const full = await request("validation-begin", { revision });
      const rejected = await validateUntilStop(full);
      assert.equal(rejected.issue.code, "invalid_destination");
      assert.equal(
        (
          await request(
            "validation-correct",
            {
              id: full.id,
              sequence: rejected.sequence,
              path: rejected.issue.path,
              value: `https://example.test/${"x".repeat(2048 - "https://example.test/".length)}`,
            },
            { status: 413 },
          )
        ).error,
        "byte_limit",
      );
      assert.deepEqual(await request("/api/owner/draft/recovery"), canonical);
      assert.equal(
        (await request("status", { id: full.id })).sequence,
        rejected.sequence,
      );
      await request("abort", { id: full.id });
      await request("cleanup");
    },
  );
  await check(
    "unsupported versions and stale legacy commits fail closed",
    async () => {
      for (const schemaVersion of [99, true, "2"]) {
        revision = await setDraft({ ...fixture, schemaVersion }, 0);
        assert.equal(
          (await request("/api/owner/draft", {}, { status: 409 })).error,
          "unsupported_version",
        );
        await request("validation-begin", { revision }, { status: 409 });
        assert.equal(
          (await request("/api/owner/draft/recovery")).draft.schemaVersion,
          schemaVersion,
        );
      }
      revision = await setDraft(fixture, 0);
      const attempt = await request("validation-begin", { revision }),
        result = await validateUntilStop(attempt);
      await sql(
        "UPDATE portfolio SET draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
      );
      await request(
        "commit",
        { id: attempt.id, sequence: result.sequence },
        { status: 409 },
      );
      assert.equal(
        (await request("/api/owner/draft", {}, { status: 409 })).error,
        "validation_required",
      );
      await clear();
    },
  );
  await check(
    "permanent handoff freezes setup while content and cleanup remain usable",
    async () => {
      const bob = await read("bob");
      const receipt = await request(
        "begin",
        {
          revision: bob.revision,
          context: "setup",
          progress,
        },
        { owner: "bob" },
      );
      const confirmed = await request(
        "commit",
        { id: receipt.id, sequence: 0 },
        { owner: "bob" },
      );
      await sql(
        "UPDATE portfolio SET first_editor_entered_at=?,draft_rev=draft_rev+1 WHERE user_id='draft-bob'",
        [Date.now()],
      );
      assert.deepEqual(
        await request(
          "commit",
          { id: receipt.id, sequence: 0 },
          { owner: "bob" },
        ),
        { ...confirmed, replayed: true },
      );
      await request("cleanup", {}, { owner: "bob" });
      revision = await setDraft(fixture);
      const attempt = await request("begin", {
        revision,
        context: "setup",
        progress,
      });
      await sql(
        "UPDATE portfolio SET first_editor_entered_at=?,draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
        [Date.now()],
      );
      const before = await read();
      revision = before.revision;
      await request("commit", { id: attempt.id, sequence: 0 }, { status: 409 });
      await request("progress", { revision, progress }, { status: 409 });
      await request(
        "patch",
        {
          revision,
          context: "setup",
          progress,
          change: { op: "set", path: ["profile", "name"], value: "Old setup" },
        },
        { status: 409 },
      );
      assert.equal((await pending()).context, "setup");
      await request("abort", { id: attempt.id });
      await request("cleanup");
      revision = (await patch(revision, ["profile", "name"], "Editor"))
        .revision;
      const content = await request("begin", { revision, context: "content" });
      await request("change", {
        id: content.id,
        sequence: 0,
        change: { op: "set", path: ["profile", "name"], value: "Content" },
      });
      revision = (await request("commit", { id: content.id, sequence: 1 }))
        .revision;
      const after = await read();
      assert.deepEqual(after.progress, before.progress);
      assert.equal(after.firstEditorEnteredAt, before.firstEditorEnteredAt);
      await request("cleanup");
    },
  );
  await check(
    "revocation at write, storage failures, expiry and owner-scoped cleanup",
    async () => {
      const before = await read();
      await patch(revision, ["profile", "name"], "Failure", {
        headers: { "X-Fixture-Fail": "true" },
        status: 503,
      });
      assert.deepEqual(await read(), before);
      const revoked = await read("revoked");
      await patch(revoked.revision, ["profile", "name"], "Revoked", {
        owner: "revoked",
        headers: { "X-Fixture-Revoke": "draft-session-revoked" },
        status: 401,
      });
      await request("/api/owner/draft", {}, { owner: "revoked", status: 401 });
      const attempt = await request("begin", { revision, context: "content" });
      await sql("UPDATE owner_save_attempt SET expires_at=1 WHERE id=?", [
        attempt.id,
      ]);
      await request("commit", { id: attempt.id, sequence: 0 }, { status: 409 });
      await request("cleanup");
      const fresh = await request("begin", { revision, context: "content" });
      await request("resume", { id: fresh.id }, { owner: "alice-other" });
      await sql("DELETE FROM session WHERE id='draft-session-alice-other'");
      await request("cleanup");
      assert.equal(await pending(), null);
      const bob = await read("bob");
      await patch(bob.revision, ["profile", "name"], "Deleted", {
        owner: "bob",
        headers: { "X-Fixture-Delete": "draft-bob" },
        status: 401,
      });
      await sql("UPDATE user SET deleting_at=NULL WHERE id='draft-bob'");
      assert.deepEqual(await read("bob"), bob);
    },
  );
  await check("candidate saves do not publish or reserve names", async () => {
    for (const owner of ["alice", "bob"]) {
      const saved = await read(owner);
      await patch(saved.revision, ["requestedSubdomain"], "same-candidate", {
        owner,
      });
    }
    const counts = await sql(
      "SELECT (SELECT count(*) FROM subdomain_claim WHERE portfolio_id IS NOT 'internal-example') claims,(SELECT count(*) FROM publish_version) publications,(SELECT count(*) FROM asset) assets,(SELECT count(*) FROM github_connection) github",
    );
    assert.deepEqual(counts[0], {
      claims: 0,
      publications: 0,
      assets: 0,
      github: 0,
    });
  });
  await check(
    "address confirmations enforce real auth, immutable replay and atomic swaps",
    async () => {
      const initial = await read();
      const command = {
        id: crypto.randomUUID(),
        portfolioId: initial.portfolioId,
        context: "content",
        revision: initial.revision,
        name: "same-candidate",
      };
      assert.equal(await request("address-state"), null);
      assert.equal((await request("address", command)).state, "held");
      const replay = await request("address", command);
      assert.equal(replay.replayed, true);
      assert.equal(replay.revision, initial.revision + 1);
      assert.equal(
        (
          await request(
            "address",
            { ...command, name: "changed-command" },
            { status: 409 },
          )
        ).error,
        "command_conflict",
      );
      const current = await read();
      const before = await sql(
        "SELECT name,portfolio_id,state,held_at,claimed_at FROM subdomain_claim ORDER BY name",
      );
      const swap = {
        ...command,
        id: crypto.randomUUID(),
        revision: current.revision,
        name: "attempted-swap",
      };
      await request("address", swap, { owner: null, status: 401 });
      await request("address", swap, {
        headers: { "X-Expected-Owner-Id": "draft-bob" },
        status: 409,
      });
      await request("address", swap, {
        headers: { Origin: "https://foreign.invalid" },
        status: 403,
      });
      await request("address", swap, {
        headers: { "Content-Type": "text/plain" },
        status: 415,
      });
      await request("address", swap, { owner: "bob", status: 409 });
      assert.deepEqual(
        await sql(
          "SELECT name,portfolio_id,state,held_at,claimed_at FROM subdomain_claim ORDER BY name",
        ),
        before,
      );
      const bob = await read("bob");
      assert.equal(
        (
          await request(
            "address",
            {
              ...command,
              id: crypto.randomUUID(),
              portfolioId: bob.portfolioId,
              revision: bob.revision,
            },
            { owner: "bob", status: 409 },
          )
        ).error,
        "address_unavailable",
      );
      await sql(
        "INSERT INTO reserved_subdomain(name) VALUES('dynamic-address')",
      );
      assert.equal(
        (await request("address-availability", { name: "dynamic-address" }))
          .status,
        "reserved",
      );
      assert.equal(
        (
          await request(
            "address",
            { ...swap, name: "dynamic-address" },
            { status: 422 },
          )
        ).error,
        "address_reserved",
      );
      assert.equal(
        (
          await request(
            "address",
            { ...swap, revision: command.revision },
            { status: 409 },
          )
        ).error,
        "revision_conflict",
      );
      assert.deepEqual(await read(), current);
      assert.equal(
        (await request("address", swap)).revision,
        current.revision + 1,
      );
      assert.equal((await request("address-state")).name, "attempted-swap");
      assert.equal(
        (
          await request(
            "address-availability",
            { name: "same-candidate" },
            { owner: "bob" },
          )
        ).status,
        "available",
      );
      const latest = await read();
      assert.equal(
        (
          await patch(
            latest.revision,
            ["requestedSubdomain"],
            "generic-bypass",
            { status: 409 },
          )
        ).error,
        "address_locked",
      );
      await sql(
        "DELETE FROM subdomain_claim WHERE portfolio_id=? AND state='held'",
        [initial.portfolioId],
      );
      await sql("DELETE FROM reserved_subdomain WHERE name='dynamic-address'");
    },
  );
  await check(
    "saves preserve existing publications, assets and services",
    async () => {
      const { portfolioId } = await read();
      const now = Date.now();
      await sql(
        "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES('draft-asset',?,'avatar','image/webp',123,'ready',?,?)",
        [portfolioId, now, now],
      );
      await sql(
        "INSERT INTO publish_version(id,portfolio_id,n,status,renderer_version,manifest,created_at,updated_at) VALUES('draft-publication',?,1,'live','fixture','{\"asset\":\"draft-asset\"}',?,?)",
        [portfolioId, now, now],
      );
      await sql(
        "INSERT INTO subdomain_claim(name,portfolio_id) VALUES('published-fixture',?)",
        [portfolioId],
      );
      await sql(
        "INSERT INTO github_connection(portfolio_id,login,github_user_id,status) VALUES(?,'fixture','fixture','disconnected')",
        [portfolioId],
      );
      await sql(
        "UPDATE portfolio SET subdomain='published-fixture',status='published',published_version=1 WHERE id=?",
        [portfolioId],
      );
      const records = async () =>
        Promise.all([
          sql("SELECT * FROM asset"),
          sql("SELECT * FROM publish_version"),
          sql("SELECT * FROM subdomain_claim"),
          sql("SELECT * FROM github_connection"),
          sql(
            "SELECT id,status,subdomain,published_version,setup_progress,first_editor_entered_at FROM portfolio WHERE id=?",
            [portfolioId],
          ),
        ]);
      const before = await records();
      revision = (
        await patch(
          (
            await read()
          ).revision,
          ["profile", "name"],
          "Private edit",
        )
      ).revision;
      const attempt = await request("begin", { context: "content", revision });
      const changed = await request("change", {
        id: attempt.id,
        sequence: attempt.sequence,
        change: {
          op: "set",
          path: ["profile", "bio"],
          value: "Private staged edit",
        },
      });
      revision = (
        await request("commit", { id: attempt.id, sequence: changed.sequence })
      ).revision;
      assert.deepEqual(await records(), before);
      await request("cleanup");
    },
  );
  await check(
    "confirmed values and progress survive runtime restart",
    async () => {
      const before = await read();
      await stop();
      await start();
      assert.deepEqual(await read(), before);
    },
  );
  await check(
    "setup-aware entry, handoff and publication readiness",
    async () => {
      const { checkSetupEntry } = await import("./setup-entry.mjs");
      await checkSetupEntry({
        request,
        sql,
        fixture,
        origin,
        cookie,
        secrets,
      });
      const { checkPublicationApi } = await import("./publication.mjs");
      await checkPublicationApi({
        request,
        sql,
        origin,
        cookie,
        secrets,
        email,
      });
    },
  );
  await check("contact recipient verification and email budgets", async () => {
    const { checkContactRecipient } = await import("./contact-recipient.mjs");
    await checkContactRecipient({ request, sql, email });
  });
  await check(
    "contact submissions are accepted only into the outbox",
    async () => {
      const { checkContactSubmission } = await import(
        "./contact-submission.mjs"
      );
      await checkContactSubmission({ origin, secrets, sql, turnstile });
    },
  );
  await check(
    "contact delivery retries, exhausts, notifies and sends tests",
    async () => {
      const { checkContactDelivery } = await import("./contact-delivery.mjs");
      await checkContactDelivery({ origin, secrets, sql, email, request });
    },
  );
  await check(
    "account deletion ends every session and releases a never-published hold",
    async () => {
      const { checkAccountDeletion } = await import("./account-deletion.mjs");
      await checkAccountDeletion({ origin, secrets, sql, cookie, request });
    },
  );
}
