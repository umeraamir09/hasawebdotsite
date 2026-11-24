// Invoked inside the isolated production draft API harness. No product route.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright";
import { freePort } from "../support/ports.mjs";
import { writeJsonEvidence } from "../support/write-json-evidence.mjs";

const browserFilter = process.env.GROUP_FILTER;

export async function checkAutosave({
  workDirectory,
  step = (_name, body) => body(),
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
  const browserPort = await freePort();
  const browserOrigin = `http://127.0.0.1:${browserPort}`;
  const directory = join(workDirectory, "autosave-bundle");
  await mkdir(directory, { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, "apps/web/integration/autosave-fixture.tsx")],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    external: ["/fonts/*"],
    // The Workbench CSS self-hosts Geist; the bundle emits the font files.
    loader: { ".ttf": "file" },
    assetNames: "[name]-[hash]",
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
      const path = new URL(req.url, browserOrigin).pathname;
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
      if (/^\/geist(?:-mono)?-variable-[A-Z0-9]+\.ttf$/.test(path)) {
        res.setHeader("Content-Type", "font/ttf");
        res.end(await readFile(join(directory, path.slice(1))));
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
  await new Promise((resolve) =>
    server.listen(browserPort, "127.0.0.1", resolve),
  );
  const browser = await chromium.launch({
    executablePath:
      process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  let page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  async function boot(target = page, suffix = "") {
    await target.goto(`${browserOrigin}/${suffix}`);
    await target.waitForFunction(() => window.fixture?.ready);
  }
  async function run(name, work) {
    if (browserFilter && !new RegExp(browserFilter).test(name)) return;
    const start = requests.length;
    await step(name, work);
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
    await sql(
      "DELETE FROM owner_save_attempt WHERE user_id='draft-alice'",
      [],
      { idempotent: true },
    );
    await sql("DELETE FROM portfolio WHERE user_id='draft-alice'", [], {
      idempotent: true,
    });
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
      "authoritative handoff retains optional recovery and retries a lost successful reply",
      async () => {
        await reset();
        await boot(page, "?handoff&recovery");
        const geometry = await page
          .getByRole("button", { name: "Open editor", exact: true })
          .evaluate((button) => {
            // The Workbench primary button fills with the ink token.
            const probe = document.createElement("span");
            probe.style.background = "var(--wb-ink-fill)";
            button.parentElement.append(probe);
            const ink = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {
              height: button.getBoundingClientRect().height,
              width: button.getBoundingClientRect().width,
              color: getComputedStyle(button).backgroundColor,
              ink,
            };
          });
        assert.equal(geometry.height, 36);
        assert.ok(geometry.width <= 520);
        assert.equal(geometry.color, geometry.ink);
        assert.notEqual(geometry.ink, "rgba(0, 0, 0, 0)");
        await page
          .getByRole("button", { name: "Open editor", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Complete address" })
          .waitFor();
        assert.equal(
          (
            await sql(
              "SELECT first_editor_entered_at FROM portfolio WHERE user_id='draft-alice'",
            )
          )[0].first_editor_entered_at,
          null,
        );
        const ready = structuredClone(fixture);
        ready.samples = {};
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
              Cookie: cookie("alice"),
              "Content-Type": "image/png",
              "X-Asset-Purpose": purpose,
              "X-Expected-Owner-Id": "draft-alice",
              "X-Asset-Bytes": String(png.length),
            },
            body: png,
          });
          assert.equal(response.status, 201, await response.clone().text());
          const asset = await response.json();
          ready.profile[purpose] = {
            assetId: asset.id,
            ...(purpose === "avatar" ? { accepted: true } : {}),
          };
        }
        await sql(
          "UPDATE portfolio SET draft=?,draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
          [JSON.stringify(ready)],
        );
        await boot(page, "?handoff&recovery");
        await page.evaluate(() =>
          window.fixture.controller.confirmAddress("browser-handoff"),
        );
        await page.getByLabel("Name", { exact: true }).fill("Final setup name");
        await page.evaluate(() => {
          window.fixture.controller.setInput(
            [
              "components",
              { id: "projects-1" },
              "data",
              "entries",
              { id: "project-1" },
              "codeUrl",
            ],
            "https://",
          );
          window.fixture.fault.action = "handoff";
          window.fixture.fault.mode = "after";
        });
        await page
          .getByRole("button", { name: "Open editor", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "We couldn't open the editor" })
          .waitFor();
        const entered = (
          await sql(
            "SELECT first_editor_entered_at,draft_rev,setup_progress FROM portfolio WHERE user_id='draft-alice'",
          )
        )[0];
        assert.ok(entered.first_editor_entered_at);
        assert.equal((await getDraft()).profile.name, "Final setup name");
        await page
          .getByRole("button", { name: "Open editor", exact: true })
          .click();
        await page
          .getByRole("status")
          .filter({ hasText: "Editor opened. Unsaved input remains" })
          .waitFor();
        const after = (
          await sql(
            "SELECT first_editor_entered_at,draft_rev,setup_progress FROM portfolio WHERE user_id='draft-alice'",
          )
        )[0];
        assert.deepEqual(after, entered);
        assert.equal((await snapshot()).suspended, true);
        const records = await page.evaluate(() =>
          window.fixture.storage.list(
            "draft-alice",
            window.fixture.portfolioId,
          ),
        );
        assert.ok(
          records.some(
            (v) => v.context === "setup" && Object.keys(v.inputs).length > 0,
          ),
        );
        await page.screenshot({
          path: join(evidence, "setup-handoff.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        const mobile = await page
          .getByRole("button", { name: "Open editor", exact: true })
          .boundingBox();
        assert.ok(
          mobile &&
            mobile.x >= 0 &&
            mobile.x + mobile.width <= 390 &&
            mobile.height === 36,
        );
        await page.screenshot({
          path: join(evidence, "setup-handoff-mobile.png"),
          fullPage: true,
        });
        const recoveryStart = requests.length;
        await boot(page, "?context=content&recovery");
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        await page
          .getByRole("heading", {
            name: "Review your preserved edits",
            exact: true,
          })
          .waitFor();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await page
          .getByRole("button", { name: "Apply selected changes", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            !window.fixture.recovery.store.getState().review &&
            window.fixture.controller.store.getState().status === "unsaved",
        );
        const recovered = await snapshot();
        assert.equal(
          recovered.confirmed.firstEditorEnteredAt,
          entered.first_editor_entered_at,
        );
        assert.ok(
          Object.values(recovered.inputs).some(
            (input) => input.value === "https://",
          ),
        );
        assert.deepEqual(
          (
            await sql(
              "SELECT first_editor_entered_at,draft_rev,setup_progress FROM portfolio WHERE user_id='draft-alice'",
            )
          )[0],
          entered,
        );
        assert.ok(
          !requests
            .slice(recoveryStart)
            .some((request) =>
              ["/api/owner/draft/progress", "/api/owner/draft/begin"].includes(
                request.path,
              ),
            ),
        );
      },
    );
    await run(
      "address confirmation flushes earlier edits and replays lost replies after reload",
      async () => {
        await reset();
        await edit(["profile", "name"], "Before reservation");
        await page.evaluate(async () => {
          const f = window.fixture;
          f.fault.action = "address";
          f.fault.mode = "after";
          await f.controller
            .confirmAddress("autosave-reserved")
            .catch(() => {});
        });
        const interrupted = await snapshot();
        assert.equal(interrupted.batch.mode, "address");
        assert.equal(interrupted.batch.address.revision, 1);
        assert.equal((await getDraft()).profile.name, "Before reservation");
        assert.equal(
          (await getDraft()).requestedSubdomain,
          "autosave-reserved",
        );
        const commandId = interrupted.batch.address.id;
        await page.reload();
        await page.waitForFunction(() => window.fixture?.ready);
        await page.evaluate(async () => {
          const f = window.fixture;
          const record = f.controller.store
            .getState()
            .recoveries.find((r) => r.batch?.mode === "address");
          if (!record) throw new Error("Missing durable address journal");
          await f.controller.restore(record.id);
          await f.controller.retry();
        });
        assert.equal((await snapshot()).confirmed.revision, 2);
        assert.equal(
          (await snapshot()).working.requestedSubdomain,
          "autosave-reserved",
        );
        const receipts = await sql(
          "SELECT id,revision FROM address_confirmation WHERE id=?",
          [commandId],
        );
        assert.deepEqual(receipts, [{ id: commandId, revision: 2 }]);
      },
    );
    for (const reload of [false, true]) {
      await run(
        `address historical receipt after newer device save ${reload ? "after reload" : "in same tab"}`,
        async () => {
          await reset();
          await page.evaluate(async () => {
            const f = window.fixture;
            f.controller.setInput(["requestedSubdomain"], "first-device-name");
            f.fault.action = "address";
            f.fault.mode = "after";
            await f.controller
              .confirmAddress("first-device-name")
              .catch(() => {});
            const saved = await (
              await fetch("/api/owner/draft", {
                headers: { "X-Expected-Owner-Id": "draft-alice" },
              })
            ).json();
            const response = await fetch("/api/owner/draft/address", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Expected-Owner-Id": "draft-alice",
              },
              body: JSON.stringify({
                id: crypto.randomUUID(),
                portfolioId: saved.portfolioId,
                revision: saved.revision,
                context: "content",
                name: "second-device-name",
              }),
            });
            if (!response.ok) throw new Error(await response.text());
          });
          if (reload) {
            await page.reload();
            await page.waitForFunction(() => window.fixture?.ready);
            await page.evaluate(async () => {
              const f = window.fixture;
              const record = f.controller.store
                .getState()
                .recoveries.find((r) => r.batch?.mode === "address");
              if (!record) throw new Error("Missing address journal");
              await f.controller.restore(record.id).catch(() => {});
            });
          }
          await page.evaluate(() =>
            window.fixture.controller.retry().catch(() => {}),
          );
          const local = await snapshot();
          assert.equal(local.error, "revision_conflict");
          assert.notEqual(local.status, "saved");
          assert.equal(local.batch.address.name, "first-device-name");
          assert.equal(
            local.inputs['["requestedSubdomain"]'].value,
            "first-device-name",
          );
          assert.equal(
            (await getDraft()).requestedSubdomain,
            "second-device-name",
          );
          assert.equal(
            (
              await sql(
                "SELECT name FROM subdomain_claim WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
              )
            )[0].name,
            "second-device-name",
          );
        },
      );
    }
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
        await page.waitForFunction(() => {
          const state = window.fixture.controller.store.getState();
          return (
            Object.keys(state.inputs).length === 1 &&
            state.error === null &&
            state.status === "unsaved"
          );
        });
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
        `changed-base working discard recovers a lost ${lost} reply through review`,
        async () => {
          await reset();
          await boot(page, "?recovery");
          await page.evaluate(() => {
            window.fixture.fault.action = "piece";
            window.fixture.fault.mode = "before";
            window.fixture.controller.edit(
              ["profile", "bio"],
              "preserved-discard".repeat(800),
            );
            window.fixture.controller.setInput(
              ["requestedSubdomain"],
              "unfinished-discard-",
            );
            return window.fixture.controller.flushValid().catch(() => {});
          });
          await sql(
            "UPDATE portfolio SET draft=json_set(draft,'$.profile.location','Remote location'),draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
          );
          await page.evaluate(async (action) => {
            window.fixture.fault.action = action;
            window.fixture.fault.mode = "after";
            await window.fixture.controller.discardAttempt().catch(() => {});
          }, lost);
          assert.ok((await snapshot()).discardJournal);
          await boot(page, "?recovery");
          await page
            .getByRole("button", {
              name: "Continue preserved edits",
              exact: true,
            })
            .click();
          await page.waitForFunction(
            () =>
              !window.fixture.recovery.store.getState().busy &&
              window.fixture.controller.store.getState().error ===
                "revision_conflict",
          );
          assert.equal((await snapshot()).discardJournal, null);
          assert.equal(
            (await snapshot()).working.profile.bio,
            "preserved-discard".repeat(800),
          );
          assert.equal((await getDraft()).profile.location, "Remote location");
          await page
            .getByRole("region", { name: "Resolve saved version", exact: true })
            .getByRole("button", {
              name: "Keep my edits for review",
              exact: true,
            })
            .click();
          await page.waitForFunction(
            () =>
              !window.fixture.recovery.store.getState().busy &&
              Boolean(window.fixture.recovery.store.getState().review),
          );
          assert.equal(await page.getByRole("checkbox").count(), 1);
          await page.getByRole("checkbox").click();
          await page.waitForFunction(
            () => !window.fixture.recovery.store.getState().busy,
          );
          await page
            .getByRole("button", { name: "Apply selected changes" })
            .click();
          await page.waitForFunction(
            () =>
              window.fixture.controller.store.getState().status === "unsaved",
          );
          assert.equal(
            (await getDraft()).profile.bio,
            "preserved-discard".repeat(800),
          );
          assert.equal((await getDraft()).profile.location, "Remote location");
          assert.equal(
            Object.values((await snapshot()).inputs)[0].value,
            "unfinished-discard-",
          );
        },
      );
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
      "selected conflict review preserves newer fields and unfinished input across reload",
      async () => {
        await reset();
        await boot(page, "?recovery");
        await edit(["profile", "name"], "Reviewed owner");
        await page.evaluate(() =>
          window.fixture.controller.setInput(
            ["requestedSubdomain"],
            "unfinished-",
          ),
        );
        const second = await context.newPage();
        await boot(second);
        // The second session loads the existing recovery but does not adopt it.
        await second.evaluate(async () => {
          const c = window.fixture.controller;
          for (const record of c.store.getState().recoveries)
            await c.discardRecovery(record.id);
          c.edit(["profile", "bio"], "Saved in the other tab");
          await c.flushValid();
        });
        await page.waitForFunction(
          () =>
            window.fixture.controller.store.getState().error ===
            "revision_conflict",
        );
        await second.close();
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        await page
          .getByRole("heading", { name: "Review your preserved edits" })
          .waitFor();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        assert.equal(
          await page.getByRole("checkbox", { checked: true }).count(),
          0,
        );
        await page.getByRole("checkbox").first().click();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await boot(page, "?recovery");
        await page
          .getByRole("button", { name: "Reopen review", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Review your preserved edits" })
          .waitFor();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await page.getByRole("checkbox", { checked: true }).first().waitFor();
        assert.equal(
          await page.getByRole("checkbox", { checked: true }).count(),
          1,
        );
        await page
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await page.waitForFunction(
          () =>
            window.fixture.controller.store.getState().confirmed?.draft.profile
              .name === "Reviewed owner",
        );
        assert.equal((await getDraft()).profile.bio, "Saved in the other tab");
        assert.equal((await snapshot()).status, "unsaved");
        assert.equal(
          Object.values((await snapshot()).inputs)[0].value,
          "unfinished-",
        );
        assert.equal(
          await page
            .getByText("Retained recovery copy", { exact: true })
            .count(),
          1,
        );
      },
    );
    await run(
      "review revision recheck resets selections and load newer retains local values",
      async () => {
        await reset();
        await boot(page, "?recovery");
        await edit(["profile", "name"], "Keep for review");
        await sql(
          "UPDATE portfolio SET draft=json_set(draft,'$.profile.name','Newer saved'),draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
        );
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        await page.getByRole("checkbox").first().click();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await sql(
          "UPDATE portfolio SET draft=json_set(draft,'$.profile.bio','Another newer value'),draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
        );
        await page
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Another version" })
          .waitFor();
        assert.equal(
          await page.getByRole("checkbox", { checked: true }).count(),
          0,
        );
        await page
          .getByRole("button", { name: "Load newer version", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Confirm load newer version" })
          .click();
        await page.waitForFunction(
          () => window.fixture.controller.store.getState().status === "saved",
        );
        assert.equal((await snapshot()).working.profile.name, "Newer saved");
        assert.equal((await getDraft()).profile.bio, "Another newer value");
        await page.getByText("Retained recovery copy", { exact: true }).click();
        await page
          .getByRole("button", { name: "Review retained edits" })
          .click();
        await page
          .getByRole("heading", { name: "Review your preserved edits" })
          .waitFor();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        assert.ok(
          await page.getByText("Keep for review", { exact: true }).count(),
        );
      },
    );
    await run(
      "setup recovery contributes selected content after permanent handoff",
      async () => {
        await reset();
        await boot(page, "?recovery");
        await edit(["profile", "name"], "Post-handoff review");
        const milestone = Date.now();
        await sql(
          "UPDATE portfolio SET first_editor_entered_at=?,setup_progress=?,draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
          [milestone, JSON.stringify({ schemaVersion: 1, step: "review" })],
        );
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        await page.getByRole("checkbox").first().click();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await page
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await page.waitForFunction(
          () => window.fixture.controller.store.getState().status === "saved",
        );
        const row = (
          await sql(
            "SELECT first_editor_entered_at,setup_progress FROM portfolio WHERE user_id='draft-alice'",
          )
        )[0];
        assert.equal(row.first_editor_entered_at, milestone);
        assert.equal(JSON.parse(row.setup_progress).step, "review");
        assert.equal((await getDraft()).profile.name, "Post-handoff review");
      },
    );
    await run(
      "separate-session same-field and structural selections use bounded staging",
      async () => {
        await reset();
        await boot(page, "?recovery");
        await sql(
          "INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('draft-session-alice-other',?,'draft-alice',?,1,1)",
          [tokens["alice-other"], Date.now() + 7200000],
        );
        const separate = await browser.newContext();
        try {
          await separate.addCookies([
            {
              name: "fixture-session",
              value: "alice-other",
              url: browserOrigin,
            },
          ]);
          const other = await separate.newPage();
          await boot(other);
          await other.evaluate(async () => {
            const c = window.fixture.controller;
            c.edit(["profile", "name"], "Other saved name");
            c.edit(["profile", "bio"], "Unrelated other-session bio");
            await c.flushValid();
          });
        } finally {
          await separate.close();
        }
        await page.evaluate(() => {
          const c = window.fixture.controller;
          const draft = structuredClone(c.store.getState().working);
          draft.profile.name = "Local selected name";
          draft.links = [
            {
              ...draft.links[0],
              id: "local-added",
              label: "Selected addition",
            },
            ...draft.links.toReversed(),
          ];
          c.update(draft);
        });
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        await page
          .getByRole("heading", { name: "Review your preserved edits" })
          .waitFor();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        for (const checkbox of await page.getByRole("checkbox").all()) {
          await checkbox.click();
          await page.waitForFunction(
            () => !window.fixture.recovery.store.getState().busy,
          );
        }
        const requestStart = requests.length;
        await page
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await page.waitForFunction(
          () => window.fixture.controller.store.getState().status === "saved",
        );
        const saved = await getDraft();
        assert.equal(saved.profile.name, "Local selected name");
        assert.equal(saved.profile.bio, "Unrelated other-session bio");
        assert.equal(saved.links[0].id, "local-added");
        assert.equal(saved.links[1].id, fixture.links.at(-1).id);
        assert.ok(
          requests.slice(requestStart).some((v) => v.path.endsWith("/begin")),
        );
        assert.ok(
          requests.slice(requestStart).some((v) => v.path.endsWith("/commit")),
        );
      },
    );
    await run(
      "conflict review keyboard, focus, status, axe and responsive controls",
      async () => {
        await reset();
        await boot(page, "?recovery");
        await edit(["profile", "name"], "Accessible conflict");
        await sql(
          "UPDATE portfolio SET draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
        );
        await page.evaluate(() =>
          window.fixture.controller.flushValid().catch(() => {}),
        );
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .focus();
        await page.keyboard.press("Enter");
        await page
          .getByRole("heading", { name: "Review your preserved edits" })
          .waitFor();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          "draft-review-heading",
        );
        await page.addScriptTag({
          path: join(root, "node_modules/axe-core/axe.min.js"),
        });
        for (const width of [360, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          const checkbox = page.getByRole("checkbox").first();
          await checkbox.focus();
          await page.keyboard.press("Space");
          await page.waitForFunction(
            () => !window.fixture.recovery.store.getState().busy,
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
            path: join(evidence, `conflict-review-${width}.png`),
            fullPage: true,
          });
        }
        await page
          .getByRole("button", { name: "Load newer version", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Confirm load newer version" })
          .focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          () => window.fixture.controller.store.getState().status === "saved",
        );
        assert.equal(
          await page.getByRole("status").first().textContent(),
          "Saved",
        );
      },
    );
    await run(
      "committed receipt retirement preserves conflict review across a lost cleanup reply",
      async () => {
        await reset();
        await boot(page, "?recovery");
        await sql(
          "INSERT OR REPLACE INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES('draft-session-alice-other',?,'draft-alice',?,1,1)",
          [tokens["alice-other"], Date.now() + 7200000],
        );
        const separate = await browser.newContext();
        try {
          await separate.addCookies([
            {
              name: "fixture-session",
              value: "alice-other",
              url: browserOrigin,
            },
          ]);
          const owner = await (
            await separate.request.get(`${browserOrigin}/api/owner`)
          ).json();
          const action = async (name, body) => {
            const response = await separate.request.post(
              `${browserOrigin}/api/owner/draft/${name}`,
              { headers: { "X-Expected-Owner-Id": owner.user.id }, data: body },
            );
            assert.equal(response.status(), 200);
            return response.json();
          };
          const base = await snapshot();
          const begin = await action("begin", {
            context: "content",
            revision: base.confirmed.revision,
          });
          const changed = await action("change", {
            id: begin.id,
            sequence: begin.sequence,
            change: {
              op: "set",
              path: ["profile", "bio"],
              value: "Canonical terminal receipt",
            },
          });
          await action("commit", { id: begin.id, sequence: changed.sequence });
        } finally {
          await separate.close();
        }
        await page.evaluate(async () => {
          const c = window.fixture.controller;
          c.edit(["profile", "name"], "Local after terminal receipt");
          await c.flushValid().catch(() => {});
          window.fixture.fault.action = "cleanup";
          window.fixture.fault.mode = "after";
        });
        const requestStart = requests.length;
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .click();
        await page.waitForFunction(
          () =>
            !window.fixture.recovery.store.getState().busy &&
            Boolean(window.fixture.controller.store.getState().discardJournal),
        );
        await boot(page, "?recovery");
        await page
          .getByRole("button", { name: "Reopen review", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Review your preserved edits" })
          .waitFor();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await page.getByRole("checkbox").first().click();
        await page.waitForFunction(
          () => !window.fixture.recovery.store.getState().busy,
        );
        await page
          .getByRole("button", { name: "Apply selected changes" })
          .click();
        await page.waitForFunction(
          () => window.fixture.controller.store.getState().status === "saved",
        );
        assert.equal(
          (await getDraft()).profile.name,
          "Local after terminal receipt",
        );
        assert.equal(
          (await getDraft()).profile.bio,
          "Canonical terminal receipt",
        );
        assert.equal(
          requests
            .slice(requestStart)
            .some((request) => request.path.endsWith("/resume")),
          false,
        );
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
        filter: browserFilter ?? null,
        browser: browser.version(),
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
        filter: browserFilter ?? null,
        browser: browser.version(),
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
