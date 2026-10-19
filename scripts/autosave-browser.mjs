// Invoked inside the isolated production draft API harness. No product route.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright";
import { writeJsonEvidence } from "./lib/write-json-evidence.mjs";

export async function checkAutosave({
  root,
  origin,
  cookie,
  sql,
  fixture,
  esbuild,
  evidence,
  secrets,
  tokens,
}) {
  const directory = join(root, ".wrangler/autosave-browser");
  await mkdir(directory, { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, "apps/web/integration/autosave-fixture.tsx")],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    external: ["/fonts/*"],
    outdir: directory,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const bundle = await readFile(join(directory, "autosave-fixture.js"));
  const css = await readFile(join(directory, "autosave-fixture.css"));
  const font = await readFile(
    join(root, "apps/web/public/fonts/dm-sans-latin.woff2"),
  );
  const requests = [],
    checks = [],
    errors = [];
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://127.0.0.1:8825").pathname;
      if (
        path === "/fixture.js" ||
        path === "/fixture.css" ||
        path === "/fonts/dm-sans-latin.woff2"
      ) {
        res.setHeader(
          "Content-Type",
          path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : "font/woff2",
        );
        res.end(
          path.endsWith(".js") ? bundle : path.endsWith(".css") ? css : font,
        );
        return;
      }
      if (!path.startsWith("/api/")) {
        res.setHeader("Content-Type", "text/html");
        if (path === "/empty") {
          res.end("<!doctype html><title>Fixture preparation</title>");
          return;
        }
        res.end(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autosave fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
        );
        return;
      }
      const session =
        /(?:^|;\s*)fixture-session=([^;]+)/.exec(
          req.headers.cookie ?? "",
        )?.[1] ?? "alice";
      const body = [];
      for await (const chunk of req) body.push(chunk);
      const headers = {
        Cookie: cookie(session),
        Origin: origin,
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        "Content-Type": "application/json",
        ...(req.headers["x-expected-owner-id"]
          ? { "X-Expected-Owner-Id": req.headers["x-expected-owner-id"] }
          : {}),
      };
      const response = await fetch(`${origin}${req.url}`, {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: Buffer.concat(body) }
          : {}),
      });
      const text = await response.text();
      requests.push({
        path,
        session,
        status: response.status,
        requestBytes: Buffer.concat(body).byteLength,
        reads: Number(response.headers.get("X-Fixture-Rows-Read")),
        writes: Number(response.headers.get("X-Fixture-Rows-Written")),
        queries: Number(response.headers.get("X-Fixture-Queries")),
      });
      res.writeHead(response.status, {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      });
      res.end(text);
    } catch {
      res.writeHead(503);
      res.end('{"error":"storage_unavailable"}');
    }
  });
  await new Promise((resolve) => server.listen(8825, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath:
      process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  let page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const browserOrigin = "http://127.0.0.1:8825";
  async function boot(target = page, suffix = "") {
    await target.goto(`${browserOrigin}/${suffix}`);
    await target.waitForFunction(() => window.fixture?.ready);
  }
  async function run(name, work) {
    const start = requests.length;
    await work();
    checks.push({
      name,
      passed: true,
      requests: requests.length - start,
      rowsRead: requests.slice(start).reduce((n, v) => n + v.reads, 0),
      rowsWritten: requests.slice(start).reduce((n, v) => n + v.writes, 0),
    });
    console.log(`PASS autosave: ${name}`);
  }
  async function reset(draft = fixture, generation = 2) {
    for (const open of context.pages()) await open.close();
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addCookies([
      { name: "fixture-session", value: "alice", url: browserOrigin },
    ]);
    await sql("DELETE FROM owner_save_attempt WHERE user_id='draft-alice'");
    await sql("DELETE FROM portfolio WHERE user_id='draft-alice'");
    // Provision through the product entry so defaults and ownership remain real.
    await page.goto(`${browserOrigin}/empty`);
    await page.evaluate(() =>
      fetch("/api/owner/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    await sql(
      "UPDATE portfolio SET draft=?,draft_validation_version=? WHERE user_id='draft-alice'",
      [JSON.stringify(draft), generation],
    );
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("hasaweb-draft-recovery-v1");
        request.onsuccess = resolve;
        request.onerror = reject;
        request.onblocked = resolve;
      });
    });
    await boot();
  }
  const snapshot = () =>
    page.evaluate(() => window.fixture.controller.store.getState());
  const flush = () =>
    page.evaluate(() => window.fixture.controller.flushValid());
  const edit = (path, value) =>
    page.evaluate(
      ({ path, value }) => window.fixture.controller.edit(path, value),
      { path, value },
    );
  const getDraft = async () =>
    JSON.parse(
      (await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'"))[0]
        .draft,
    );
  try {
    await run(
      "all component types and exact one-MiB staging with bounded cleanup",
      async () => {
        const minimal = {
          ...structuredClone(fixture),
          components: [],
          links: [],
          samples: {},
        };
        await reset(minimal);
        const target = structuredClone(fixture);
        target.profile.bio = "";
        target.profile.bio = "x".repeat(
          1048576 - Buffer.byteLength(JSON.stringify(target)),
        );
        assert.equal(Buffer.byteLength(JSON.stringify(target)), 1048576);
        await page.evaluate(
          (draft) => window.fixture.controller.update(draft),
          target,
        );
        await flush();
        assert.deepEqual(await getDraft(), target);
        assert.equal((await snapshot()).status, "saved");
        assert.equal(
          (
            await sql(
              "SELECT count(*) n FROM owner_save_attempt WHERE user_id='draft-alice'",
            )
          )[0].n,
          0,
        );
        assert.equal(
          (await sql("SELECT count(*) n FROM owner_save_piece"))[0].n,
          0,
        );
      },
    );
    await run(
      "exact profile/order/appearance/ready-reference saves and ordinary request cost",
      async () => {
        await reset();
        const portfolioId = (await snapshot()).confirmed.portfolioId;
        await sql(
          "INSERT INTO asset(id,portfolio_id,kind,content_type,bytes,status,created_at,updated_at) VALUES('ready-avatar',?,'avatar','image/png',1234,'ready',1,1),('pending-avatar',?,'avatar','image/png',0,'pending',1,1)",
          [portfolioId, portfolioId],
        );
        const assetsBefore = await sql(
          "SELECT * FROM asset WHERE portfolio_id=? ORDER BY id",
          [portfolioId],
        );
        const before = requests.length;
        await edit(["profile", "name"], "Exact owner name");
        await flush();
        assert.equal((await getDraft()).profile.name, "Exact owner name");
        assert.equal(
          requests.slice(before).filter((v) => v.path === "/api/owner/draft")
            .length,
          0,
        );
        assert.equal(
          requests.slice(before).filter((v) => v.path.endsWith("/patch"))
            .length,
          1,
        );
        await page.evaluate(() => {
          const c = window.fixture.controller;
          const draft = structuredClone(c.store.getState().working);
          draft.components.reverse();
          draft.appearance.themeId = "violet";
          draft.profile.avatar = {
            assetId: "ready-avatar",
            accepted: true,
            alt: "Owner",
          };
          c.update(draft);
          c.changeProgress({ schemaVersion: 1, step: "review" });
        });
        await flush();
        assert.equal((await snapshot()).status, "saved");
        assert.deepEqual(
          await sql("SELECT * FROM asset WHERE portfolio_id=? ORDER BY id", [
            portfolioId,
          ]),
          assetsBefore,
        );
        const expected = (await snapshot()).working;
        await boot();
        assert.deepEqual((await snapshot()).working, expected);
        assert.equal((await snapshot()).progress.step, "review");
      },
    );
    await run(
      "same-browser invalid recovery remains unsaved and explicit",
      async () => {
        await edit(["requestedSubdomain"], "bad space");
        await page.evaluate(() => window.fixture.controller.persist());
        await boot();
        assert.equal((await snapshot()).error, "recovery_required");
        await page.getByRole("button", { name: "Restore input" }).click();
        await page.waitForFunction(
          () =>
            Object.keys(window.fixture.controller.store.getState().inputs)
              .length === 1,
        );
        assert.equal((await snapshot()).status, "unsaved");
        assert.equal((await getDraft()).requestedSubdomain, undefined);
      },
    );
    for (const action of [
      "patch",
      "begin",
      "change",
      "piece",
      "string-finish",
      "commit",
      "cleanup",
    ]) {
      await run(
        `lost ${action} reply, reload and explicit recovery`,
        async () => {
          await reset();
          await page.evaluate((action) => {
            window.fixture.fault.action = action;
            window.fixture.fault.mode = "after";
          }, action);
          await edit(["profile", "name"], "Interrupted owner");
          if (action !== "patch")
            await edit(["profile", "bio"], "😀\n".repeat(3500));
          await page.evaluate(() =>
            window.fixture.controller.flushValid().catch(() => {}),
          );
          assert.equal((await snapshot()).status, "failed");
          if (action === "cleanup") {
            assert.equal((await snapshot()).batch.confirmedRevision, 1);
            assert.equal(
              await page
                .getByText(
                  "The last save was confirmed. Retry to finish the remaining work.",
                )
                .count(),
              1,
            );
          }
          await boot();
          await page.getByRole("button", { name: "Restore input" }).click();
          await page.waitForFunction(() =>
            Boolean(window.fixture.controller.store.getState().batch),
          );
          if (action === "begin") {
            await page.evaluate(() =>
              window.fixture.controller.retry().catch(() => {}),
            );
            assert.equal((await snapshot()).error, "journal_missing");
            await page
              .getByRole("button", { name: "Discard staged save" })
              .click();
            await page
              .getByRole("button", { name: "Confirm", exact: true })
              .click();
            await page.waitForFunction(
              () => !window.fixture.controller.store.getState().batch,
            );
            await flush();
          } else await page.evaluate(() => window.fixture.controller.retry());
          assert.equal((await snapshot()).status, "saved");
          assert.equal((await getDraft()).profile.name, "Interrupted owner");
        },
      );
    }
    await run(
      "unexpected staged command advancement cannot acknowledge the captured input",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "piece";
          window.fixture.fault.mode = "before";
        });
        await edit(["profile", "bio"], "mine".repeat(3000));
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        const competing = await page.evaluate(async () => {
          const batch = window.fixture.controller.store.getState().batch;
          return (
            await fetch("/api/owner/draft/piece", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Expected-Owner-Id": "draft-alice",
              },
              body: JSON.stringify({
                id: batch.attemptId,
                sequence: batch.sequence,
                text: "another command",
              }),
            })
          ).status;
        });
        assert.equal(competing, 200);
        await page.evaluate(() =>
          window.fixture.controller.retry().catch(() => {}),
        );
        assert.equal((await snapshot()).status, "blocked");
        assert.equal(
          (await snapshot()).working.profile.bio,
          "mine".repeat(3000),
        );
        assert.equal((await getDraft()).profile.bio, fixture.profile.bio);
      },
    );
    await run(
      "another actor's partial commit cannot confirm the entire captured batch",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "change";
          window.fixture.fault.mode = "after";
        });
        await edit(["profile", "name"], "My staged name");
        await edit(["profile", "bio"], "My pending biography");
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        const competing = await page.evaluate(async () => {
          const headers = {
            "Content-Type": "application/json",
            "X-Expected-Owner-Id": "draft-alice",
          };
          const pending = await (
            await fetch("/api/owner/draft/pending", {
              method: "POST",
              headers,
              body: "{}",
            })
          ).json();
          return (
            await fetch("/api/owner/draft/commit", {
              method: "POST",
              headers,
              body: JSON.stringify({
                id: pending.id,
                sequence: pending.sequence,
              }),
            })
          ).status;
        });
        assert.equal(competing, 200);
        await page.evaluate(() =>
          window.fixture.controller.retry().catch(() => {}),
        );
        assert.equal((await snapshot()).error, "revision_conflict");
        assert.equal(
          (await snapshot()).working.profile.bio,
          "My pending biography",
        );
        assert.notEqual((await getDraft()).profile.bio, "My pending biography");
      },
    );
    await run(
      "offline outgoing failure retains input and retries",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "patch";
          window.fixture.fault.mode = "before";
        });
        await edit(["profile", "name"], "Offline owner");
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        assert.equal((await snapshot()).status, "failed");
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await page.waitForFunction(
          () => window.fixture.controller.store.getState().status === "saved",
        );
        assert.equal((await getDraft()).profile.name, "Offline owner");
      },
    );
    await run(
      "two tabs preserve stale edits and cannot silently overwrite",
      async () => {
        await reset();
        const second = await context.newPage();
        await boot(second);
        await second.evaluate(() =>
          window.fixture.controller.edit(["profile", "name"], "Second tab"),
        );
        await edit(["profile", "name"], "First tab");
        await flush();
        await second.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        assert.equal(
          await second.evaluate(
            () => window.fixture.controller.store.getState().error,
          ),
          "revision_conflict",
        );
        assert.equal((await getDraft()).profile.name, "First tab");
        assert.equal(
          await second.evaluate(
            () =>
              window.fixture.controller.store.getState().working.profile.name,
          ),
          "Second tab",
        );
      },
    );
    await run(
      "unfinished input blocks cross-tab refresh and conflict replay",
      async () => {
        await reset();
        const second = await context.newPage();
        await boot(second);
        await page.evaluate(async () => {
          window.fixture.controller.setInput(
            ["requestedSubdomain"],
            "bad space",
          );
          await window.fixture.controller.persist();
        });
        await second.evaluate(async () => {
          window.fixture.controller.edit(["requestedSubdomain"], "other-tab");
          await window.fixture.controller.flushValid();
        });
        await page.waitForFunction(
          () =>
            window.fixture.controller.store.getState().error ===
            "revision_conflict",
        );
        assert.equal((await snapshot()).confirmed.revision, 0);
        await page.evaluate(async () => {
          window.fixture.controller.edit(["requestedSubdomain"], "my-choice");
          await window.fixture.controller.retry().catch(() => {});
          await window.fixture.controller.persist();
        });
        assert.equal((await snapshot()).error, "revision_conflict");
        assert.equal((await getDraft()).requestedSubdomain, "other-tab");
        await boot();
        assert.ok(
          (await snapshot()).recoveries.some(
            (record) =>
              record.blocked === "revision_conflict" &&
              record.working.requestedSubdomain === "my-choice",
          ),
        );
        assert.equal((await getDraft()).requestedSubdomain, "other-tab");
        await second.close();
      },
    );
    await run(
      "a restored save cannot delete newer recovery from its original tab",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "patch";
          window.fixture.fault.mode = "before";
        });
        await edit(["profile", "name"], "Older input to restore");
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        const second = await context.newPage();
        await boot(second);
        await second.getByRole("button", { name: "Restore input" }).click();
        await second.waitForFunction(() =>
          Boolean(window.fixture.controller.store.getState().batch),
        );
        let release = () => {};
        const held = new Promise((resolve) => {
          release = resolve;
        });
        await second.route("**/api/owner/draft/patch", async (route) => {
          const response = await route.fetch();
          await held;
          await route.fulfill({ response });
        });
        const outgoing = second.waitForRequest("**/api/owner/draft/patch");
        const saving = second.evaluate(() => window.fixture.controller.retry());
        try {
          await outgoing;
          await page.evaluate(async () => {
            window.fixture.controller.edit(
              ["profile", "name"],
              "Newer original-tab input",
            );
            await window.fixture.controller.persist();
            window.fixture.controller.dispose();
            await window.fixture.controller.persist();
          });
        } finally {
          release();
        }
        await saving;
        const reopened = await context.newPage();
        await boot(reopened);
        assert.ok(
          await reopened.evaluate(() =>
            window.fixture.controller.store
              .getState()
              .recoveries.some(
                (record) =>
                  record.working?.profile.name === "Newer original-tab input",
              ),
          ),
        );
        assert.equal((await getDraft()).profile.name, "Older input to restore");
        await reopened.close();
        await second.close();
      },
    );
    await run(
      "account switch at the same revision blocks stale-tab writes",
      async () => {
        await reset();
        await context.addCookies([
          { name: "fixture-session", value: "bob", url: browserOrigin },
        ]);
        await edit(["profile", "name"], "Alice's private edit");
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        assert.equal((await snapshot()).error, "owner_changed");
        assert.equal((await getDraft()).profile.name, fixture.profile.name);
        const bob = await sql(
          "SELECT draft FROM portfolio WHERE user_id='draft-bob'",
        );
        assert.notEqual(
          JSON.parse(bob[0].draft).profile.name,
          "Alice's private edit",
        );
        await boot();
        assert.equal((await snapshot()).recoveries.length, 0);
      },
    );
    await run(
      "another session requires explicit resume of the original journal",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "piece";
          window.fixture.fault.mode = "before";
        });
        await edit(["profile", "bio"], "resume".repeat(2000));
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        await context.addCookies([
          { name: "fixture-session", value: "alice-other", url: browserOrigin },
        ]);
        await boot();
        await page.getByRole("button", { name: "Restore input" }).click();
        await page.waitForFunction(() =>
          Boolean(window.fixture.controller.store.getState().batch),
        );
        await page.evaluate(() =>
          window.fixture.controller.retry().catch(() => {}),
        );
        assert.equal((await snapshot()).error, "recovery_required");
        await page.evaluate(() => window.fixture.controller.resumeAttempt());
        assert.equal((await getDraft()).profile.bio, "resume".repeat(2000));
      },
    );
    await run(
      "unfinished staging without a journal requires explicit discard",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "piece";
          window.fixture.fault.mode = "before";
        });
        await edit(["profile", "bio"], "missing".repeat(2000));
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        const other = await browser.newContext();
        const otherPage = await other.newPage();
        await boot(otherPage);
        assert.equal(
          await otherPage.getByRole("button", { name: "Resume save" }).count(),
          0,
        );
        await otherPage
          .getByRole("button", { name: "Discard staged save" })
          .click();
        await otherPage
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await otherPage.waitForFunction(
          () => !window.fixture.controller.store.getState().pending,
        );
        assert.equal((await getDraft()).profile.bio, fixture.profile.bio);
        await other.close();
      },
    );
    await run(
      "expired attempts retain input for explicit recovery",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "piece";
          window.fixture.fault.mode = "before";
        });
        await edit(["profile", "bio"], "expiry".repeat(2000));
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        await sql(
          "UPDATE owner_save_attempt SET expires_at=1 WHERE user_id='draft-alice'",
        );
        await page.evaluate(() =>
          window.fixture.controller.retry().catch(() => {}),
        );
        assert.equal((await snapshot()).error, "attempt_unavailable");
        assert.equal(
          (await snapshot()).working.profile.bio,
          "expiry".repeat(2000),
        );
        await page.getByRole("button", { name: "Discard staged save" }).click();
        await page
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await page.waitForFunction(
          () => !window.fixture.controller.store.getState().batch,
        );
        await flush();
        assert.equal((await getDraft()).profile.bio, "expiry".repeat(2000));
      },
    );
    await run(
      "dense collections keep changed-leaf transport bounded and expose read cost",
      async () => {
        const dense = structuredClone(fixture);
        dense.components = Array.from({ length: 3000 }, (_, index) => ({
          id: `dense-${index}`,
          type: "text",
          version: 1,
          data: { title: "", body: { type: "doc", content: [] } },
        }));
        dense.samples = {};
        await reset(dense);
        const start = requests.length;
        await edit(
          ["components", { id: "dense-1500" }, "data", "title"],
          "One changed entry",
        );
        await flush();
        const changes = requests.slice(start);
        assert.equal(changes.length, 1);
        assert.ok(changes[0].requestBytes < 1024);
        assert.ok(changes[0].reads > 10000);
        assert.equal(
          (await getDraft()).components[1500].data.title,
          "One changed entry",
        );
      },
    );
    await run(
      "actual session expiry preserves input until the controlled flow restores access",
      async () => {
        await reset();
        await context.addCookies([
          { name: "fixture-session", value: "alice-other", url: browserOrigin },
        ]);
        await edit(["profile", "name"], "Expired session input");
        await sql(
          "UPDATE session SET expires_at=1 WHERE id='draft-session-alice-other'",
        );
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        assert.equal((await snapshot()).error, "unauthorized");
        assert.equal(
          (await snapshot()).working.profile.name,
          "Expired session input",
        );
        // Better Auth removes expired rows; simulate the controlled return with
        // another valid signed session, rather than reviving a deleted session.
        await context.addCookies([
          { name: "fixture-session", value: "alice", url: browserOrigin },
        ]);
        await page.evaluate(() => window.fixture.controller.retry());
        assert.equal((await getDraft()).profile.name, "Expired session input");
      },
    );
    await run(
      "discarding legacy validation leaves canonical recovery blocked rather than Saved",
      async () => {
        const legacy = structuredClone(fixture);
        legacy.links[1].value = "javascript:alert(1)";
        await reset(legacy, 0);
        await page
          .getByRole("button", { name: "Validate saved draft" })
          .click();
        await page
          .getByRole("textbox", { name: "Correct destination" })
          .waitFor();
        await page.getByRole("button", { name: "Discard staged save" }).click();
        await page
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await page.waitForFunction(
          () => !window.fixture.controller.store.getState().pending,
        );
        assert.equal((await snapshot()).error, "validation_required");
        assert.equal((await snapshot()).status, "blocked");
        assert.equal((await snapshot()).confirmed, null);
        await page
          .getByRole("button", { name: "Validate saved draft" })
          .waitFor();
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll("button")).some(
            (button) =>
              button.textContent.trim() === "Validate saved draft" &&
              !button.disabled,
          ),
        );
        assert.equal(
          await page
            .getByRole("button", { name: "Download original draft" })
            .count(),
          1,
        );
        assert.equal((await getDraft()).links[1].value, "javascript:alert(1)");
      },
    );
    await run(
      "bounded legacy validation and explicit destination correction",
      async () => {
        const legacy = structuredClone(fixture);
        legacy.links[0].value = "not-a-url";
        await reset(legacy, 0);
        assert.equal((await snapshot()).error, "validation_required");
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        assert.equal(
          (await snapshot()).validation.issue.code,
          "invalid_destination",
        );
        await page.evaluate(() =>
          window.fixture.controller
            .validateLegacy("https://wrong-kind.example.test")
            .catch(() => {}),
        );
        assert.equal((await snapshot()).error, "invalid_input");
        assert.equal(
          await page
            .getByRole("button", { name: "Validate correction" })
            .count(),
          1,
        );
        await page.evaluate(() =>
          window.fixture.controller.validateLegacy("corrected@example.test"),
        );
        assert.equal((await snapshot()).status, "saved");
        assert.equal(
          (await getDraft()).links[0].value,
          "corrected@example.test",
        );
      },
    );
    await run(
      "unfinished legacy correction survives reload and explicit staging discard",
      async () => {
        const legacy = structuredClone(fixture);
        legacy.links[0].value = "not-an-email";
        await reset(legacy, 0);
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        await page
          .getByRole("textbox", { name: "Correct destination" })
          .fill("unfinished correction");
        await page.evaluate(() => window.fixture.controller.persist());
        await boot();
        await page.getByRole("button", { name: "Restore input" }).click();
        await page
          .getByRole("textbox", { name: "Correct destination" })
          .waitFor();
        assert.equal(
          await page
            .getByRole("textbox", { name: "Correct destination" })
            .inputValue(),
          "unfinished correction",
        );
        await page.evaluate(() =>
          window.fixture.controller.discardAttempt().catch(() => {}),
        );
        assert.equal(
          Object.values((await snapshot()).validationInputs)[0].value,
          "unfinished correction",
        );
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        assert.equal(
          await page
            .getByRole("textbox", { name: "Correct destination" })
            .inputValue(),
          "unfinished correction",
        );
        await page
          .getByRole("textbox", { name: "Correct destination" })
          .fill("recovered@example.test");
        await page.getByRole("button", { name: "Validate correction" }).click();
        await page.waitForFunction(
          () => window.fixture.controller.store.getState().status === "saved",
        );
        assert.equal(
          (await getDraft()).links[0].value,
          "recovered@example.test",
        );
      },
    );
    await run(
      "a lost correction reply replays its exact journal and refreshes the validation issue",
      async () => {
        const legacy = structuredClone(fixture);
        legacy.links[0].value = "not-an-email";
        await reset(legacy, 0);
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        await page.evaluate(async () => {
          window.fixture.fault.action = "validation-correct";
          window.fixture.fault.mode = "after";
          await window.fixture.controller
            .validateLegacy("replayed@example.test")
            .catch(() => {});
        });
        assert.equal((await snapshot()).status, "failed");
        await boot();
        await page.getByRole("button", { name: "Restore input" }).click();
        await page.waitForFunction(() =>
          Boolean(window.fixture.controller.store.getState().validationJournal),
        );
        await page.evaluate(() => window.fixture.controller.retry());
        assert.equal((await snapshot()).status, "saved");
        assert.equal(
          (await getDraft()).links[0].value,
          "replayed@example.test",
        );
      },
    );
    await run(
      "a validation acknowledgement cannot erase newer correction input",
      async () => {
        const legacy = structuredClone(fixture);
        legacy.links[0].value = "not-an-email";
        await reset(legacy, 0);
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        let release = () => {};
        const held = new Promise((resolve) => {
          release = resolve;
        });
        await page.route(
          "**/api/owner/draft/validation-correct",
          async (route) => {
            const response = await route.fetch();
            await held;
            await route.fulfill({ response });
          },
        );
        const sent = page.waitForRequest(
          "**/api/owner/draft/validation-correct",
        );
        const saving = page.evaluate(() =>
          window.fixture.controller.validateLegacy("captured@example.test"),
        );
        try {
          await sent;
          await page.evaluate(() =>
            window.fixture.controller.setValidationInput(
              "newer unfinished value",
            ),
          );
        } finally {
          release();
        }
        await saving;
        await page.unroute("**/api/owner/draft/validation-correct");
        assert.equal(
          (await getDraft()).links[0].value,
          "captured@example.test",
        );
        assert.equal((await snapshot()).status, "unsaved");
        assert.equal(
          Object.values((await snapshot()).validationInputs)[0].value,
          "newer unfinished value",
        );
        assert.equal((await flush()).hasLocalOnlyInput, true);
      },
    );
    await run(
      "validation metadata without its correction journal cannot authorize a commit",
      async () => {
        const legacy = structuredClone(fixture);
        legacy.links[0].value = "not-an-email";
        await reset(legacy, 0);
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        await sql(
          "UPDATE owner_save_attempt SET draft=json_set(draft,'$.links[0].value','unknown@example.test'),validation_complete=1,validation_issue=NULL,sequence=sequence+1 WHERE user_id='draft-alice'",
        );
        const isolated = await browser.newContext();
        const foreign = await isolated.newPage();
        try {
          await boot(foreign);
          assert.equal(
            await foreign.getByRole("button", { name: "Resume save" }).count(),
            0,
          );
          assert.equal(
            await foreign
              .getByRole("button", { name: "Validate saved draft" })
              .count(),
            0,
          );
          const before = requests.filter((v) =>
            v.path.endsWith("/commit"),
          ).length;
          await foreign.evaluate(() =>
            window.fixture.controller.validateLegacy().catch(() => {}),
          );
          assert.equal(
            await foreign.evaluate(
              () => window.fixture.controller.store.getState().error,
            ),
            "journal_missing",
          );
          assert.equal(
            requests.filter((v) => v.path.endsWith("/commit")).length,
            before,
          );
          assert.equal((await getDraft()).links[0].value, "not-an-email");
          await foreign.evaluate(() =>
            window.fixture.controller.discardAttempt().catch(() => {}),
          );
          assert.equal((await getDraft()).links[0].value, "not-an-email");
        } finally {
          await isolated.close();
        }
      },
    );
    for (const validation of [false, true]) {
      await run(
        `lost explicit session transfer reply recovers ${validation ? "validation" : "content"} journal`,
        async () => {
          // The earlier expiry scenario deletes this isolated signed session.
          await sql(
            "INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('draft-session-alice-other',?,'draft-alice',?,1,1)",
            [tokens["alice-other"], Date.now() + 7200000],
          );
          if (validation) {
            const legacy = structuredClone(fixture);
            legacy.links[0].value = "not-an-email";
            await reset(legacy, 0);
            await page.evaluate(() =>
              window.fixture.controller.validateLegacy(),
            );
          } else {
            await reset();
            await page.evaluate(() => {
              window.fixture.fault.action = "piece";
              window.fixture.fault.mode = "before";
            });
            await edit(["profile", "bio"], "transferred".repeat(1200));
            await page.evaluate(() =>
              window.fixture.controller.flushValid().catch(() => {}),
            );
          }
          await context.addCookies([
            {
              name: "fixture-session",
              value: "alice-other",
              url: browserOrigin,
            },
          ]);
          await boot();
          await page.getByRole("button", { name: "Restore input" }).click();
          await page.waitForFunction(() =>
            Boolean(
              window.fixture.controller.store.getState().batch ||
                window.fixture.controller.store.getState().validationJournal,
            ),
          );
          await page.evaluate(async () => {
            window.fixture.fault.action = "resume";
            window.fixture.fault.mode = "after";
            await window.fixture.controller.resumeAttempt().catch(() => {});
          });
          assert.equal((await snapshot()).status, "failed");
          await page.evaluate(() => window.fixture.controller.retry());
          if (validation)
            await page.evaluate(() =>
              window.fixture.controller.validateLegacy(
                "transferred@example.test",
              ),
            );
          assert.equal((await snapshot()).status, "saved");
          assert.equal(
            validation
              ? (await getDraft()).links[0].value
              : (await getDraft()).profile.bio,
            validation
              ? "transferred@example.test"
              : "transferred".repeat(1200),
          );
        },
      );
    }
    for (const lost of ["abort", "cleanup"]) {
      await run(
        `lost ${lost} reply preserves explicit discard intent across reload`,
        async () => {
          const legacy = structuredClone(fixture);
          legacy.links[0].value = "not-an-email";
          await reset(legacy, 0);
          await page.evaluate(() => window.fixture.controller.validateLegacy());
          await page
            .getByRole("textbox", { name: "Correct destination" })
            .fill("raw discard input");
          await page.evaluate(async (action) => {
            window.fixture.fault.action = action;
            window.fixture.fault.mode = "after";
            await window.fixture.controller.discardAttempt().catch(() => {});
          }, lost);
          assert.ok((await snapshot()).discardJournal);
          await boot();
          await page.getByRole("button", { name: "Restore input" }).click();
          await page.waitForFunction(() =>
            Boolean(window.fixture.controller.store.getState().discardJournal),
          );
          await page.evaluate(() =>
            window.fixture.controller.retry().catch(() => {}),
          );
          assert.equal((await snapshot()).discardJournal, null);
          assert.equal((await snapshot()).error, "validation_required");
          assert.equal(
            Object.values((await snapshot()).validationInputs)[0].value,
            "raw discard input",
          );
          assert.equal((await getDraft()).links[0].value, "not-an-email");
        },
      );
    }
    for (const lost of ["validation-begin", "validation-step", "commit"]) {
      await run(`legacy validation recovers a lost ${lost} reply`, async () => {
        await reset(fixture, 0);
        await page.evaluate((action) => {
          window.fixture.fault.action = action;
          window.fixture.fault.mode = "after";
        }, lost);
        await page.evaluate(() =>
          window.fixture.controller.validateLegacy().catch(() => {}),
        );
        assert.equal((await snapshot()).status, "failed");
        await boot();
        await page
          .getByRole("button", { name: "Restore input" })
          .first()
          .click();
        await page.waitForFunction(() =>
          Boolean(window.fixture.controller.store.getState().validationJournal),
        );
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        assert.equal((await snapshot()).status, "saved");
        assert.deepEqual(await getDraft(), fixture);
      });
    }
    await run(
      "handoff closes active setup staging while content preserves milestone",
      async () => {
        await reset();
        await page.evaluate(() => {
          window.fixture.fault.action = "piece";
          window.fixture.fault.mode = "before";
        });
        await edit(["profile", "bio"], "handoff".repeat(2000));
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        await sql(
          "UPDATE portfolio SET first_editor_entered_at=?,draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
          [Date.now()],
        );
        await page.evaluate(() =>
          window.fixture.controller.retry().catch(() => {}),
        );
        assert.equal((await snapshot()).error, "setup_closed");
        await page.evaluate(() =>
          window.fixture.controller.discardAttempt().catch(() => {}),
        );
        assert.equal((await snapshot()).error, "setup_closed");
        await boot(page, "?context=content");
        const records = (await snapshot()).recoveries;
        for (const record of records)
          await page.evaluate(
            (id) => window.fixture.controller.discardRecovery(id),
            record.id,
          );
        await edit(["profile", "name"], "Editor after handoff");
        await flush();
        const row = (
          await sql(
            "SELECT first_editor_entered_at,setup_progress FROM portfolio WHERE user_id='draft-alice'",
          )
        )[0];
        assert.ok(row.first_editor_entered_at);
        assert.equal(JSON.parse(row.setup_progress).step, "address");
      },
    );
    await run(
      "responsive keyboard controls, status announcements and axe",
      async () => {
        await boot(page, "?context=content");
        await edit(["requestedSubdomain"], "invalid address");
        await page.addScriptTag({
          path: join(root, "node_modules/axe-core/axe.min.js"),
        });
        for (const width of [360, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          await page.locator("#fixture-name").focus();
          await page.keyboard.press("Shift+Tab");
          await page.keyboard.press("Tab");
          assert.ok(
            await page.evaluate(() => document.activeElement !== document.body),
          );
          const audit = await page.evaluate(() =>
            window.axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag22aa"],
              },
            }),
          );
          assert.deepEqual(
            audit.violations.map((v) => v.id),
            [],
          );
          assert.equal(
            await page.getByRole("status").textContent(),
            "Unsaved input",
          );
          await page.screenshot({
            path: join(evidence, `controls-${width}.png`),
            fullPage: true,
          });
        }
        // Audit the actual recovery/correction controls, including their
        // confirmation state, at the same widths as the ordinary status.
        const legacy = structuredClone(fixture);
        legacy.links[0].value = "not-an-email";
        await reset(legacy, 0);
        await page.evaluate(() => window.fixture.controller.validateLegacy());
        await page.evaluate(() => window.fixture.controller.persist());
        await boot();
        await page.getByRole("button", { name: "Restore input" }).click();
        await page
          .getByRole("textbox", { name: "Correct destination" })
          .waitFor();
        await page.evaluate(async () => {
          window.fixture.fault.action = "validation-correct";
          window.fixture.fault.mode = "before";
          await window.fixture.controller
            .validateLegacy("accessible@example.test")
            .catch(() => {});
        });
        await page.addScriptTag({
          path: join(root, "node_modules/axe-core/axe.min.js"),
        });
        for (const width of [360, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page
            .getByRole("button", { name: "Discard staged save" })
            .focus();
          await page.keyboard.press("Enter");
          await page
            .getByRole("group", { name: "Confirm staged save action" })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "Retry", exact: true })
              .count(),
            1,
          );
          assert.equal(
            await page.getByRole("button", { name: "Resume save" }).count(),
            1,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          const audit = await page.evaluate(() =>
            window.axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag22aa"],
              },
            }),
          );
          assert.deepEqual(
            audit.violations.map((v) => v.id),
            [],
          );
          await page.screenshot({
            path: join(evidence, `controls-recovery-${width}.png`),
            fullPage: true,
          });
          await page
            .getByRole("button", { name: "Cancel", exact: true })
            .focus();
          await page.keyboard.press("Enter");
          assert.equal(
            await page
              .getByRole("group", { name: "Confirm staged save action" })
              .count(),
            0,
          );
        }
      },
    );
    assert.deepEqual(errors, []);
    assert.ok(requests.every((v) => v.queries <= 50));
    await writeJsonEvidence(
      new URL(`file://${join(evidence, "browser-results.json")}`),
      {
        recordedAt: new Date().toISOString(),
        checks,
        requests,
        errors,
      },
    );
  } catch (error) {
    await writeJsonEvidence(
      new URL(`file://${join(evidence, "browser-partial.json")}`),
      {
        recordedAt: new Date().toISOString(),
        checks,
        requests,
        errors,
        failure: error.message.slice(0, 1000),
      },
    );
    throw error;
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
