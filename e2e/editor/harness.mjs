import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createGroupRunner } from "../support/groups.mjs";
import { freePort } from "../support/ports.mjs";
import { openPanel, outline, resize } from "./shell.mjs";

// Serves the editor, guide and owner-entry fixtures through a local proxy in
// front of the owner runtime and opens one Chromium context. `core()` runs the
// editor's own groups; journeys in this folder receive `controls`.
export async function createEditorHarness({
  workDirectory,
  root,
  origin,
  cookie,
  sql,
  fixture,
  esbuild,
  evidence,
  secrets,
  github,
  email,
}) {
  const directory = join(workDirectory, "editor-bundle");
  await mkdir(directory, { recursive: true });
  await esbuild.build({
    entryPoints: {
      "editor-fixture": join(root, "apps/web/integration/editor-fixture.tsx"),
      "guide-fixture": join(root, "apps/web/integration/guide-fixture.tsx"),
      "auth-recovery-page-fixture": join(
        root,
        "apps/web/integration/auth-recovery-page-fixture.tsx",
      ),
      "owner-entry-fixture": join(
        root,
        "apps/web/integration/owner-entry-fixture.tsx",
      ),
      "editor-preview-fixture": join(
        root,
        "apps/web/integration/editor-preview-fixture.ts",
      ),
      // The shipped full-page preview client, served as /preview-assets/app.*.
      "full-preview-entry": join(
        root,
        "apps/web/lib/editor/full-preview-entry.ts",
      ),
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    external: ["/fonts/*", "/portfolio-platform/*"],
    // The Workbench CSS self-hosts Geist; the bundle emits the font files.
    loader: { ".ttf": "file" },
    assetNames: "[name]-[hash]",
    outdir: directory,
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const adapterFile = join(directory, "preview-document.cjs");
  await esbuild.build({
    entryPoints: [join(root, "apps/web/lib/editor/preview-document.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: adapterFile,
  });
  const { serveEditorPreview } = (await import(pathToFileURL(adapterFile)))
    .default;
  const browserPort = await freePort();
  const browserOrigin = `http://127.0.0.1:${browserPort}`;
  const requests = [],
    errors = [],
    checks = [];
  const shell = (script, preview = false) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private editor handoff fixture</title><link rel="stylesheet" href="/${script}.css"></head><body><div id="${preview ? "preview-root" : "root"}"></div><script type="module" src="/${script}.js"></script></body></html>`;
  async function authority(path, init = {}, session = "alice") {
    const response = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        Cookie: session === "none" ? "" : cookie(session),
        Origin: origin,
        "X-Runtime-Key": secrets.RUNTIME_KEY,
        ...init.headers,
      },
    });
    requests.push({ path, session, status: response.status });
    return response;
  }
  async function relay(response, res) {
    const headers = new Headers(response.headers);
    for (const name of [
      "content-encoding",
      "content-length",
      "transfer-encoding",
    ])
      headers.delete(name);
    res.writeHead(response.status, Object.fromEntries(headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, browserOrigin);
      const session =
        /(?:^|;\s*)fixture-session=([^;]+)/.exec(
          req.headers.cookie ?? "",
        )?.[1] ?? "none";
      if (url.pathname === "/_public") {
        const response = await authority(
          "/__fixture/public",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: url.searchParams.get("target"),
              method: req.method,
            }),
          },
          "none",
        );
        await relay(response, res);
        return;
      }
      if (url.pathname === "/private/editor-preview") {
        const response = await serveEditorPreview(
          new Request(url, { headers: { Cookie: req.headers.cookie ?? "" } }),
          {
            APP_ORIGIN: browserOrigin,
            OWNER_API: { fetch: () => authority("/api/owner", {}, session) },
          },
          shell("editor-preview-fixture", true),
        );
        await relay(response, res);
        return;
      }
      // The full-page preview goes through the production Worker gate.
      if (url.pathname === "/preview" || url.pathname.startsWith("/preview/")) {
        await relay(
          await authority(req.url, { method: req.method }, session),
          res,
        );
        return;
      }
      if (/^\/preview-assets\/(?:app|editor)\.(?:js|css)$/.test(url.pathname)) {
        const extension = url.pathname.slice(-2) === "js" ? "js" : "css";
        res.setHeader(
          "Content-Type",
          extension === "js" ? "text/javascript" : "text/css",
        );
        // `editor.*` is the iframe child that the production `/editor/preview`
        // shell loads; the harness builds the same entry.
        const bundle = url.pathname.includes("/editor.")
          ? "editor-preview-fixture"
          : "full-preview-entry";
        res.end(await readFile(join(directory, `${bundle}.${extension}`)));
        return;
      }
      // The provider hop of the recovery callback. Only the sign-in start and
      // the provider's return are fixtures; the callback page, the recovery
      // records and every owner API request stay the product's.
      // `fixture-session` models the account the provider signs in (`as`), a
      // cancellation or a failure.
      // Connecting a sign-in method uses the same provider hop. The real
      // link flow (OAuth state, ownership, account rules) is the auth
      // project's; here the browser only shows where it would go.
      if (
        (url.pathname === "/api/auth/sign-in/social" ||
          url.pathname === "/api/auth/link-social") &&
        req.method === "POST"
      ) {
        const body = [];
        for await (const chunk of req) body.push(chunk);
        const { provider, callbackURL, errorCallbackURL } = JSON.parse(
          Buffer.concat(body).toString(),
        );
        const target = new URL(
          "/o/authorize",
          provider === "github"
            ? "https://github.com"
            : "https://accounts.google.com",
        );
        target.search = new URLSearchParams({
          provider,
          cb: callbackURL,
          err: errorCallbackURL,
        }).toString();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ url: target.href }));
        return;
      }
      if (url.pathname === "/__provider/return") {
        const as = url.searchParams.get("as") ?? "alice";
        const failed = ["cancel", "fail"].includes(as);
        if (!failed)
          res.setHeader(
            "Set-Cookie",
            `fixture-session=${as}; Path=/; HttpOnly`,
          );
        const next = new URL(
          url.searchParams.get(failed ? "err" : "cb") ?? "/",
        );
        if (failed)
          next.searchParams.set(
            "error",
            as === "cancel" ? "access_denied" : "server_error",
          );
        res.writeHead(302, { Location: next.href });
        res.end();
        return;
      }
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname === "/editor/preview"
      ) {
        const body = [];
        for await (const chunk of req) body.push(chunk);
        const response = await authority(
          req.url,
          {
            method: req.method,
            // Redirects (the GitHub consent callback's 303) belong to the
            // browser, as in production, not to this proxy's fetch.
            redirect: "manual",
            headers: {
              "Content-Type": req.headers["content-type"] ?? "application/json",
              ...(req.headers["x-asset-purpose"]
                ? { "X-Asset-Purpose": req.headers["x-asset-purpose"] }
                : {}),
              ...(req.headers["x-asset-bytes"]
                ? { "X-Asset-Bytes": req.headers["x-asset-bytes"] }
                : {}),
              ...(req.headers["x-expected-owner-id"]
                ? { "X-Expected-Owner-Id": req.headers["x-expected-owner-id"] }
                : {}),
            },
            ...(!["GET", "HEAD"].includes(req.method)
              ? { body: Buffer.concat(body) }
              : {}),
          },
          session,
        );
        await relay(response, res);
        return;
      }
      if (
        /^\/(?:editor(?:-preview)?|guide|owner-entry|auth-recovery-page)-fixture\.(?:js|css)$/.test(
          url.pathname,
        )
      ) {
        res.setHeader(
          "Content-Type",
          url.pathname.endsWith(".js") ? "text/javascript" : "text/css",
        );
        res.end(await readFile(join(directory, url.pathname.slice(1))));
        return;
      }
      if (/^\/geist(?:-mono)?-variable-[A-Z0-9]+\.ttf$/.test(url.pathname)) {
        res.setHeader("Content-Type", "font/ttf");
        res.end(await readFile(join(directory, url.pathname.slice(1))));
        return;
      }
      if (/^\/assets\/crop\/[a-z-]+\.svg$/.test(url.pathname)) {
        res.setHeader("Content-Type", "image/svg+xml");
        res.end(await readFile(join(root, "apps/web/public", url.pathname)));
        return;
      }
      if (
        url.pathname === "/fonts/dm-sans-latin.woff2" ||
        url.pathname.startsWith("/portfolio-platform/")
      ) {
        const filename =
          url.pathname === "/fonts/dm-sans-latin.woff2"
            ? join(root, "apps/web/public/fonts/dm-sans-latin.woff2")
            : join(
                root,
                "packages/components/static",
                url.pathname
                  .split("/")
                  .at(-1)
                  .replace(/^[a-f0-9]+-/, ""),
              );
        res.setHeader(
          "Content-Type",
          extname(filename) === ".ttf" ? "font/ttf" : "font/woff2",
        );
        res.end(await readFile(filename));
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        url.pathname === "/empty"
          ? "<!doctype html><title>Prepare</title>"
          : shell(
              // `/auth/entry` and `/editor` mount the production `OwnerEntry`
              // resolver that the gated pages render (Phase 42E). `/guide`
              // keeps the direct guide fixture of 42A–42D.
              ["/auth/entry", "/editor"].includes(url.pathname)
                ? "owner-entry-fixture"
                : url.pathname.startsWith("/auth/recovery")
                  ? "auth-recovery-page-fixture"
                  : url.pathname === "/guide"
                    ? "guide-fixture"
                    : "editor-fixture",
            ),
      );
    } catch (error) {
      errors.push(String(error));
      res.writeHead(503);
      res.end("Unavailable");
    }
  });
  await new Promise((resolve) =>
    server.listen(browserPort, "127.0.0.1", resolve),
  );
  const browser = await chromium.launch({
    executablePath:
      process.env.AUTH_SPIKE_CHROMIUM ?? "/opt/google/chrome/chrome",
    headless: true,
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  });
  let page;
  async function boot(draft = fixture) {
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
    await page.goto(`${browserOrigin}/empty`);
    await page.evaluate(() =>
      fetch("/api/owner/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    await sql(
      "UPDATE portfolio SET draft=?,draft_validation_version=2,draft_rev=draft_rev+1,first_editor_entered_at=? WHERE user_id='draft-alice'",
      [JSON.stringify(draft), Date.now()],
    );
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("hasaweb-draft-recovery-v1");
        request.onsuccess = resolve;
        request.onerror = reject;
        request.onblocked = reject;
      });
    });
    await page.goto(browserOrigin);
    if (errors.length) throw new Error(errors.join("; "));
    await page.waitForFunction(() => window.editorFixture?.ready);
    await displayed();
  }
  const displayed = () =>
    page.waitForFunction(
      () =>
        document.querySelector("[data-preview-state]")?.dataset.previewState ===
        "displayed",
      { timeout: 45000 },
    );
  const frame = () =>
    page
      .frames()
      .find(
        (candidate) =>
          candidate.url().includes("/private/editor-preview") ||
          new URL(candidate.url()).pathname === "/editor/preview",
      );
  async function readyFrame(timeout = 15000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const current = frame();
      if (current) return current;
      if (Date.now() > deadline) throw new Error("preview frame not found");
      await page.waitForTimeout(50);
    }
  }
  const runnerOptions = {
    label: "editor",
    evidence,
    checks,
    errors,
    getPage: () => page,
    // Separates a stale preview from a lost edit when a group fails.
    diagnose: (current) =>
      current.evaluate(() => {
        const status = document.querySelector("[data-preview-state]");
        const recovery = window.editorFixture?.recovery?.store.getState();
        const draft = recovery?.controller.store.getState();
        return {
          preview: status && { ...status.dataset },
          previewNotice: document
            .querySelector("iframe")
            ?.contentDocument?.getElementById("preview-root")
            ?.textContent.slice(0, 300),
          recoveryBusy: recovery?.busy,
          recoveryError: recovery?.error,
          suspended: draft?.suspended,
          saveStatus: draft?.status,
          draftError: draft?.error,
          inputs: draft ? Object.keys(draft.inputs) : null,
          components: draft?.working?.components.map((component) => ({
            id: component.id,
            type: component.type,
            data: JSON.stringify(component.data).slice(0, 2000),
          })),
        };
      }),
  };
  let run = createGroupRunner(runnerOptions);
  const useStep = (step) => {
    run = createGroupRunner({ ...runnerOptions, step });
  };
  async function seed(kind = "ordinary") {
    return page.evaluate(async (kind) => {
      const f = window.editorFixture,
        controller = f.recovery.store.getState().controller;
      const state = controller.store.getState(),
        id = crypto.randomUUID();
      const working = structuredClone(state.confirmed.draft);
      working.profile.name = "Restored owner";
      const record = {
        version: 1,
        id,
        ...f.scope,
        context: "content",
        base: state.confirmed,
        working,
        progress: state.progress,
        inputs: {
          '["profile","bio"]': {
            path: ["profile", "bio"],
            value: "Raw preserved bio",
          },
        },
        batch: null,
        validationJournal: null,
      };
      if (kind === "prepared") {
        const replacement = { ...record, id: crypto.randomUUID() };
        await f.storage.put(replacement);
        record.review = {
          version: 1,
          phase: "prepared",
          choice: "review",
          canonical: state.confirmed,
          selection: { itemIds: [] },
          replacementId: replacement.id,
        };
      }
      await f.storage.put(record);
      controller.store.setState({ recoveries: [record] });
      return id;
    }, kind);
  }
  async function holdStorage() {
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open("hasaweb-draft-recovery-v1");
        open.onsuccess = () => resolve(open.result);
        open.onerror = reject;
      });
      const transaction = db.transaction("records", "readwrite"),
        store = transaction.objectStore("records");
      window.storageReleased = false;
      const keep = () => {
        if (!window.storageReleased) store.get("hold").onsuccess = keep;
      };
      keep();
      transaction.oncomplete = () => db.close();
    });
  }
  async function core() {
    await run(
      "address local typing, explicit reservation, reload, keyboard and mobile",
      async () => {
        await boot();
        await openPanel(page, "Share");
        const control = page.getByRole("form", { name: "Portfolio address" });
        const input = control.getByRole("textbox", { name: "Address name" });
        await input.fill("raw INVALID");
        await page.waitForTimeout(2200);
        assert.equal(
          (
            await sql(
              "SELECT count(*) n FROM subdomain_claim WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
            )
          )[0].n,
          0,
        );
        assert.equal(await input.inputValue(), "raw INVALID");
        await input.fill("editor-reservation");
        await input.press("Tab");
        await control
          .getByRole("button", { name: "Save address", exact: true })
          .click();
        await control
          .getByRole("status")
          .filter({ hasText: "Reserved for your portfolio" })
          .waitFor();
        const row = (
          await sql(
            "SELECT p.subdomain,json_extract(p.draft,'$.requestedSubdomain') name,c.state FROM portfolio p JOIN subdomain_claim c ON c.portfolio_id=p.id WHERE p.user_id='draft-alice'",
          )
        )[0];
        assert.deepEqual(row, {
          subdomain: null,
          name: "editor-reservation",
          state: "held",
        });
        await page.reload();
        await page.waitForFunction(() => window.editorFixture?.ready);
        await openPanel(page, "Share");
        await page
          .getByRole("form", { name: "Portfolio address" })
          .getByRole("status")
          .filter({ hasText: "Reserved for your portfolio" })
          .waitFor();
        assert.equal(
          await page
            .getByRole("textbox", { name: "Address name" })
            .inputValue(),
          "editor-reservation",
        );
        await page.evaluate(() => {
          window.editorFixture.recovery.store
            .getState()
            .controller.setInput(["requestedSubdomain"], "restored-candidate");
        });
        await page.waitForFunction(
          () =>
            document.querySelector('form[aria-label="Portfolio address"] input')
              ?.value === "restored-candidate",
        );
        assert.doesNotMatch(
          await control.getByRole("status").innerText(),
          /Reserved for your portfolio/,
        );
        assert.match(
          await control.innerText(),
          /Current reservation: editor-reservation\.hasaweb\.site/,
        );
        await resize(page, { width: 390, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await openPanel(page, "Share");
        await page
          .getByRole("textbox", { name: "Address name" })
          .fill("editor-replacement");
        await page
          .getByRole("textbox", { name: "Address name" })
          .press("Enter");
        await page
          .getByRole("form", { name: "Portfolio address" })
          .getByRole("status")
          .filter({ hasText: "Reserved for your portfolio" })
          .waitFor();
        assert.equal(
          (
            await sql(
              "SELECT name FROM subdomain_claim WHERE portfolio_id=(SELECT id FROM portfolio WHERE user_id='draft-alice')",
            )
          )[0].name,
          "editor-replacement",
        );
        await page.screenshot({
          path: join(evidence, "address-mobile.png"),
          fullPage: true,
        });
        await resize(page, { width: 1500, height: 1000 });
      },
    );
    await run(
      "authorized preview document and gated production route",
      async () => {
        const anonymous = await context.request.get(
          `${browserOrigin}/private/editor-preview`,
          { headers: { Cookie: "fixture-session=none" } },
        );
        assert.equal(anonymous.status(), 401);
        await boot();
        const response = await context.request.get(
          `${browserOrigin}/private/editor-preview`,
        );
        assert.equal(response.status(), 200);
        assert.match(response.headers()["cache-control"], /private.*no-store/);
        assert.equal(response.headers()["x-robots-tag"], "noindex");
        assert.match(response.headers().vary, /Cookie/);
        assert.match(
          response.headers()["content-security-policy"],
          /frame-ancestors 'self'/,
        );
        assert.doesNotMatch(
          await response.text(),
          /recipient-1|avatar-1|includePrivate|umer@example/,
        );
        // The production Worker route (gate open in this harness) applies
        // the same owner check, headers and permitted frame parent.
        const signedOut = await context.request.get(
          `${browserOrigin}/editor/preview`,
          { headers: { Cookie: "fixture-session=none" } },
        );
        assert.equal(signedOut.status(), 401);
        assert.match(signedOut.headers()["cache-control"], /private.*no-store/);
        const shell = await context.request.get(
          `${browserOrigin}/editor/preview`,
        );
        assert.equal(shell.status(), 200);
        assert.match(shell.headers()["cache-control"], /private.*no-store/);
        assert.equal(shell.headers()["x-robots-tag"], "noindex");
        assert.equal(shell.headers()["x-frame-options"], "SAMEORIGIN");
        assert.match(
          shell.headers()["content-security-policy"],
          /frame-ancestors 'self'/,
        );
        const body = await shell.text();
        assert.match(body, /\/preview-assets\/editor\.js/);
        assert.doesNotMatch(
          body,
          /recipient-1|avatar-1|includePrivate|umer@example/,
        );
      },
    );
    await run(
      "preview status leaves up to date in the same task as a committed edit",
      async () => {
        await boot();
        // Microtasks let React commit the store update but run no later task,
        // so a deferred passive effect would still report the old display.
        const observed = await page.evaluate(async () => {
          const status = () => ({
            ...document.querySelector("[data-preview-state]").dataset,
          });
          const before = status();
          window.editorFixture.recovery.store
            .getState()
            .controller.edit(["profile", "name"], "Same task owner");
          for (let i = 0; i < 5; i++) await Promise.resolve();
          return { before, after: status() };
        });
        assert.equal(observed.before.previewState, "displayed");
        assert.notEqual(observed.after.previewState, "displayed");
        assert.ok(
          Number(observed.after.previewSequence) >
            Number(observed.before.previewSequence),
        );
        await displayed();
        await frame().waitForFunction(
          () => document.querySelector("h1")?.textContent === "Same task owner",
        );
      },
    );
    await run(
      "valid edits reach both preview widths across the viewport matrix before autosave",
      async () => {
        await boot();
        let release;
        const blocked = new Promise((resolve) => {
          release = resolve;
        });
        await page.route("**/api/owner/draft/*", async (route) => {
          if (route.request().method() === "POST") await blocked;
          await route.continue();
        });
        await page.getByLabel("Name", { exact: true }).fill("Immediate owner");
        await frame().waitForFunction(
          () => document.querySelector("h1")?.textContent === "Immediate owner",
        );
        const saved = JSON.parse(
          (
            await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
          )[0].draft,
        );
        assert.equal(saved.profile.name, fixture.profile.name);
        // The confirmed viewport matrix: desktop, tablet and phone.
        for (const parentWidth of [1280, 768, 360]) {
          await resize(page, { width: parentWidth, height: 1000 });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          for (const [label, width] of [
            ["Desktop", 1120],
            ["Mobile", 390],
          ]) {
            await page.getByRole("radio", { name: label, exact: true }).click();
            assert.equal(await frame().evaluate(() => innerWidth), width);
            assert.equal(
              await frame().locator("h1").innerText(),
              "Immediate owner",
            );
            await page.screenshot({
              path: join(
                evidence,
                `editor-${parentWidth}-${label.toLowerCase()}.png`,
              ),
            });
          }
        }
        release();
        await page.unrouteAll({ behavior: "wait" });
        await resize(page, { width: 1500, height: 1000 });
      },
    );
    await run(
      "stable selection, unfinished raw input and sample acceptance",
      async () => {
        const draft = structuredClone(fixture);
        draft.samples["profile.name"] = true;
        draft.samples["components.text-1"] = true;
        await boot(draft);
        assert.equal(await frame().locator("h1").innerText(), "Name not added");
        await page.getByLabel("Name", { exact: true }).fill("Accepted name");
        await frame().waitForFunction(
          () => document.querySelector("h1")?.textContent === "Accepted name",
        );
        await page
          .getByLabel("Email address", { exact: true })
          .fill("unfinished@");
        assert.equal(
          await page
            .getByLabel("Email address", { exact: true })
            .getAttribute("aria-invalid"),
          "true",
        );
        assert.match(await frame().locator("main").innerText(), /Email me/);
        await page.evaluate(() => {
          const c = window.editorFixture.recovery.store.getState().controller;
          const d = structuredClone(c.store.getState().working);
          d.links.reverse();
          c.update(d);
        });
        assert.equal(
          await page.getByLabel("Email address", { exact: true }).inputValue(),
          "unfinished@",
        );
        await (await outline(page))
          .locator('.page-outline-sections [data-order-id="text-1"] button')
          .click();
        await page.getByLabel("Section title").fill("Accepted section");
        await frame().waitForFunction(
          () =>
            document.querySelector('[data-component-id="text-1"] h2')
              ?.textContent === "Accepted section",
        );
        await page.evaluate(() => {
          const delayed = new WeakSet();
          window.addEventListener(
            "message",
            (event) => {
              if (event.data?.kind !== "select" || delayed.has(event)) return;
              delayed.add(event);
              event.stopImmediatePropagation();
              setTimeout(() => window.dispatchEvent(event), 250);
            },
            { capture: true },
          );
        });
        await frame()
          .locator('[data-component-id="projects-1"]')
          .click({ position: { x: 10, y: 10 } });
        await page
          .getByRole("region", { name: "Projects controls" })
          .waitFor({ state: "visible" });
        await frame().locator('[data-component-id="skills-1"]').focus();
        await frame().locator('[data-component-id="skills-1"]').press("Enter");
        await page
          .getByRole("region", { name: "Skills and technologies controls" })
          .waitFor({ state: "visible" });
        await frame().locator("[data-theme-toggle]").click();
        assert.equal(
          await (await outline(page))
            .getByRole("button", {
              name: "Skills and technologies",
              exact: true,
            })
            .getAttribute("aria-current"),
          "true",
        );
        await page.getByRole("button", { name: "Style", exact: true }).click();
        // This fixture draft stores non-catalog IDs, so the panel lists the
        // six approved presets and asks the owner to choose.
        const customization = page.getByRole("region", {
          name: "Customization",
        });
        assert.equal(
          await customization
            .getByRole("group", { name: "Theme", exact: true })
            .getByRole("radio")
            .count(),
          6,
        );
        assert.match(
          await customization.innerText(),
          /Your saved theme is no longer available\. Choose a theme\./,
        );
      },
    );
    await run(
      "equivalent owner rerenders retain active controller and iframe",
      async () => {
        await boot();
        const before = await page
          .locator("[data-editor-scope]")
          .getAttribute("data-editor-scope");
        const channel = await page.locator("iframe").getAttribute("src");
        await page.evaluate(() => window.editorFixture.rerender());
        await page.getByLabel("Name", { exact: true }).fill("Same session");
        await frame().waitForFunction(
          () => document.querySelector("h1")?.textContent === "Same session",
        );
        assert.equal(
          await page
            .locator("[data-editor-scope]")
            .getAttribute("data-editor-scope"),
          before,
        );
        assert.equal(await page.locator("iframe").getAttribute("src"), channel);
      },
    );
    for (const kind of ["ordinary", "prepared"]) {
      for (const fail of [false, true]) {
        await run(
          `${kind} restoration suspends editor through storage ${fail ? "failure" : "success"}`,
          async () => {
            await boot();
            const id = await seed(kind);
            await holdStorage();
            await page.evaluate(
              ({ id, kind }) => {
                const f = window.editorFixture;
                window.restoreResult = null;
                void (
                  kind === "prepared"
                    ? f.recovery.reopen(id)
                    : f.recovery.continueRecord(id)
                ).then(
                  () => {
                    window.restoreResult = "success";
                  },
                  () => {
                    window.restoreResult = "failure";
                  },
                );
              },
              { id, kind },
            );
            await page.waitForFunction(
              () =>
                document.querySelector('[data-publication-field="name"] input')
                  ?.disabled,
            );
            assert.equal(
              await page.evaluate(() => {
                try {
                  window.editorFixture.recovery.store
                    .getState()
                    .controller.edit(["profile", "name"], "Must reject");
                  return false;
                } catch {
                  return true;
                }
              }),
              true,
            );
            await page.evaluate((fail) => {
              if (fail) {
                const original = IDBObjectStore.prototype.getAll;
                IDBObjectStore.prototype.getAll = () => {
                  IDBObjectStore.prototype.getAll = original;
                  throw new Error("Fixture storage failure");
                };
              }
              window.storageReleased = true;
            }, fail);
            await page.waitForFunction(() => window.restoreResult !== null);
            assert.equal(
              await page.evaluate(() => window.restoreResult),
              fail ? "failure" : "success",
            );
            if (!fail) {
              await page.waitForFunction(
                () =>
                  document.querySelector(
                    '[data-publication-field="name"] input',
                  )?.value === "Restored owner",
              );
              assert.equal(
                await page.getByLabel("Bio", { exact: true }).inputValue(),
                "Raw preserved bio",
              );
            }
            await page.waitForFunction(
              () =>
                !document.querySelector('[data-publication-field="name"] input')
                  ?.disabled,
            );
            await page
              .getByLabel("Name", { exact: true })
              .fill("Usable after restoration");
            await frame().waitForFunction(
              () =>
                document.querySelector("h1")?.textContent ===
                "Usable after restoration",
            );
          },
        );
      }
    }
    await run(
      "pinned discard keeps working values and requires review on a changed base",
      async () => {
        await boot();
        const id = await seed();
        await page.evaluate(async (id) => {
          const f = window.editorFixture;
          const records = await f.storage.list(
            f.scope.ownerId,
            f.scope.portfolioId,
          );
          const source = records.find((record) => record.id === id);
          source.discardJournal = {
            id: null,
            revision: source.base.revision,
            confirmed: true,
          };
          await f.storage.put(source);
        }, id);
        await sql(
          "UPDATE portfolio SET draft=json_set(draft,'$.profile.location','Remote location'),draft_rev=draft_rev+1 WHERE user_id='draft-alice'",
        );
        await page.evaluate(async (id) => {
          await window.editorFixture.recovery
            .continueRecord(id)
            .catch(() => {});
        }, id);
        assert.equal(
          await page.getByLabel("Name", { exact: true }).inputValue(),
          "Restored owner",
        );
        assert.equal(
          await page.getByLabel("Bio", { exact: true }).inputValue(),
          "Raw preserved bio",
        );
        const status = await page.evaluate(() => {
          const state = window.editorFixture.recovery.store
            .getState()
            .controller.store.getState();
          return { error: state.error, discardJournal: state.discardJournal };
        });
        assert.equal(status.error, "revision_conflict");
        assert.equal(status.discardJournal, null);
        await page
          .getByRole("button", {
            name: "Keep my edits for review",
            exact: true,
          })
          .first()
          .click();
        const checkboxes = page.getByRole("checkbox", {
          name: /Apply this change/,
        });
        await checkboxes.first().waitFor({ state: "visible" });
        for (let i = 0; i < (await checkboxes.count()); i++) {
          if (!(await checkboxes.nth(i).isEnabled())) continue;
          await checkboxes.nth(i).click();
          await page.waitForFunction(
            () => !window.editorFixture.recovery.store.getState().busy,
          );
          assert.equal(await checkboxes.nth(i).isChecked(), true);
        }
        await page
          .getByRole("button", { name: "Apply selected changes", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            window.editorFixture.recovery.store
              .getState()
              .controller.store.getState().status === "unsaved",
        );
        assert.equal(
          await page.getByLabel("Name", { exact: true }).inputValue(),
          "Restored owner",
        );
        assert.equal(
          await page.getByLabel("Location", { exact: true }).inputValue(),
          "Remote location",
        );
      },
    );
    await run(
      "editor exit cancels an Apply waiting on replacement persistence",
      async () => {
        await boot();
        const originalName = await page
          .getByLabel("Name", { exact: true })
          .inputValue();
        await page
          .getByLabel("Name", { exact: true })
          .fill("Do not save after exit");
        await page.evaluate(async () => {
          const recovery = window.editorFixture.recovery;
          await recovery.start();
          for (const item of recovery.store.getState().items)
            if (item.selectable) await recovery.select(item.id, true);
        });
        await holdStorage();
        await page.evaluate(() => {
          window.applyAfterExit = null;
          void window.editorFixture.recovery.apply().then(
            () => {
              window.applyAfterExit = "success";
            },
            () => {
              window.applyAfterExit = "failure";
            },
          );
        });
        await page.waitForFunction(
          () => window.editorFixture.recovery.store.getState().busy,
        );
        await page.evaluate(() => {
          window.editorFixture.root.unmount();
          window.storageReleased = true;
        });
        await page.waitForFunction(() => window.applyAfterExit !== null);
        assert.equal(
          await page.evaluate(() => window.applyAfterExit),
          "failure",
        );
        assert.equal(
          await page.evaluate(() => {
            try {
              window.editorFixture.recovery.store
                .getState()
                .controller.edit(["profile", "name"], "Must stay stopped");
              return false;
            } catch {
              return true;
            }
          }),
          true,
        );
        const saved = await authority("/api/owner/draft", {
          headers: { "X-Expected-Owner-Id": "draft-alice" },
        });
        assert.equal((await saved.json()).draft.profile.name, originalName);
      },
    );
    await run("failed review checkpoint keeps the editor usable", async () => {
      await boot();
      await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = () => {
          IDBObjectStore.prototype.put = put;
          throw new Error("Fixture checkpoint failed");
        };
        window.reviewResult = null;
        void window.editorFixture.recovery.start().then(
          () => {
            window.reviewResult = "success";
          },
          () => {
            window.reviewResult = "failure";
          },
        );
      });
      await page.waitForFunction(() => window.reviewResult !== null);
      assert.equal(await page.evaluate(() => window.reviewResult), "failure");
      await page.getByLabel("Name", { exact: true }).fill("Still editable");
      await frame().waitForFunction(
        () => document.querySelector("h1")?.textContent === "Still editable",
      );
    });
    await run(
      "review replacement clears scope field state and follows the fresh controller",
      async () => {
        await boot();
        await page
          .getByLabel("Name", { exact: true })
          .fill("Local review edit");
        await page.getByLabel("Email address", { exact: true }).fill("raw@");
        const before = await page
          .locator("[data-editor-scope]")
          .getAttribute("data-editor-scope");
        await page.evaluate(() => window.editorFixture.recovery.start());
        assert.equal(
          await page.getByLabel("Name", { exact: true }).isDisabled(),
          true,
        );
        const changes = page.getByRole("checkbox", {
          name: /Apply this change/,
        });
        await changes.first().waitFor({ state: "visible" });
        for (let i = 0; i < (await changes.count()); i++) {
          if (!(await changes.nth(i).isEnabled())) continue;
          await changes.nth(i).click();
          await page.waitForFunction(
            () => !window.editorFixture.recovery.store.getState().busy,
          );
          assert.equal(await changes.nth(i).isChecked(), true);
        }
        await page
          .getByRole("button", { name: "Apply selected changes", exact: true })
          .click();
        await page.waitForFunction(
          (before) =>
            document.querySelector("[data-editor-scope]")?.dataset
              .editorScope !== before,
          before,
        );
        await page
          .getByLabel("Name", { exact: true })
          .fill("New controller edit");
        await (await readyFrame()).waitForFunction(
          () =>
            document.querySelector("h1")?.textContent === "New controller edit",
        );
        assert.equal(
          await page.getByLabel("Email address", { exact: true }).inputValue(),
          "raw@",
        );
        assert.equal(
          await (await outline(page))
            .getByRole("button", { name: /^Profile\b/ })
            .getAttribute("aria-current"),
          "true",
        );
      },
    );
    await run(
      "maximal one-MiB strings and dense collections retain cancellation and live rendering",
      async () => {
        const draft = structuredClone(fixture);
        draft.samples = {};
        draft.profile.bio = "";
        draft.profile.bio = "x".repeat(
          1048576 - Buffer.byteLength(JSON.stringify(draft)),
        );
        assert.equal(Buffer.byteLength(JSON.stringify(draft)), 1048576);
        await boot(draft);
        assert.equal(
          (await frame().locator(".pf-bio").innerText()).length,
          draft.profile.bio.length,
        );
        await page.evaluate(() => {
          const c = window.editorFixture.recovery.store.getState().controller;
          c.edit(["profile", "name"], "Earlier");
          setTimeout(() => c.edit(["profile", "name"], "Latest"), 1);
        });
        await frame().waitForFunction(
          () => document.querySelector("h1")?.textContent === "Latest",
        );
        const dense = structuredClone(fixture);
        dense.samples = {};
        const skills = dense.components.find(
          (component) => component.type === "skills",
        );
        skills.data = {
          categories: [],
          entries: Array.from({ length: 12000 }, (_, i) => ({
            id: `s${i}`,
            name: "",
          })),
        };
        dense.profile.bio = "";
        dense.profile.bio = "d".repeat(
          1048576 - Buffer.byteLength(JSON.stringify(dense)),
        );
        await boot(dense);
        assert.equal(
          await frame()
            .locator('[data-component-id="skills-1"] .pf-tags li')
            .count(),
          12000,
        );
        assert.equal(
          await frame().evaluate(async () => {
            await document.fonts.ready;
            return document.fonts.check('16px "DM Sans"');
          }),
          true,
        );
        assert.equal(await frame().locator("[data-theme-toggle]").count(), 1);
      },
    );
    await run(
      "protocol rejects stale, untrusted and malformed updates and survives reload and disposal",
      async () => {
        await boot();
        await page.evaluate(() => {
          const f = window.editorFixture;
          const iframe = document.createElement("iframe");
          iframe.id = "protocol-frame";
          iframe.src = "/private/editor-preview#channel=protocol-fixture";
          document.body.append(iframe);
          const states = [];
          window.protocolStates = states;
          const bridge = f.connectPreviewBridge({
            iframe,
            origin: location.origin,
            channel: "protocol-fixture",
            identity: f.scope,
            onState: (state) => states.push(state),
            onSelect: () => {},
          });
          window.protocolBridge = bridge;
          bridge.request((signal) =>
            f.projectPortfolioCancellable(
              f.recovery.store.getState().controller.store.getState().working,
              {
                assetOrigins: [],
                resolveAsset: () => ({ state: "unavailable" }),
              },
              signal,
            ),
          );
        });
        await page.waitForFunction(
          () => window.protocolStates.at(-1)?.kind === "displayed",
        );
        const child = page
          .frames()
          .find((candidate) =>
            candidate.url().includes("channel=protocol-fixture"),
          );
        const original = await child.locator("main").innerText();
        await child.evaluate(() => {
          for (const [source, origin, channel] of [
            [window, location.origin, "protocol-fixture"],
            [parent, "https://foreign.example", "protocol-fixture"],
            [parent, location.origin, "wrong"],
          ])
            window.dispatchEvent(
              new MessageEvent("message", {
                source,
                origin,
                data: {
                  protocol: 1,
                  channel,
                  kind: "begin",
                  sequence: 999,
                  bytes: 10,
                },
              }),
            );
          window.dispatchEvent(
            new MessageEvent("message", {
              source: parent,
              origin: location.origin,
              data: {
                protocol: 1,
                channel: "protocol-fixture",
                kind: "begin",
                sequence: 0,
                bytes: 10,
              },
            }),
          );
        });
        assert.equal(await child.locator("main").innerText(), original);
        await page.evaluate(() =>
          window.protocolBridge.request(async () => ({
            profile: {
              name: "Leak",
              bio: "",
              avatar: { state: "missing" },
              banner: { state: "missing" },
              links: [],
            },
            components: [],
            recipientId: "private",
          })),
        );
        await page.waitForFunction(
          () => window.protocolStates.at(-1)?.kind === "rejected",
        );
        const rejected = await page.evaluate(() =>
          window.protocolStates.at(-1),
        );
        assert.ok(rejected.displayed < rejected.requested);
        assert.equal(await child.locator("main").innerText(), original);
        await page.evaluate(() => {
          const f = window.editorFixture,
            prepare = (signal) =>
              f.projectPortfolioCancellable(
                f.recovery.store.getState().controller.store.getState().working,
                {
                  assetOrigins: [],
                  resolveAsset: () => ({ state: "unavailable" }),
                },
                signal,
              );
          window.protocolBridge.request(prepare);
          document
            .getElementById("protocol-frame")
            .contentWindow.location.reload();
        });
        await page.waitForFunction(
          () => window.protocolStates.at(-1)?.kind === "displayed",
        );
        await page.evaluate(() => {
          window.protocolBridge.dispose();
          document.getElementById("protocol-frame").remove();
          window.editorFixture.root.unmount();
        });
        assert.equal(await page.locator("iframe").count(), 0);
        assert.equal(
          await page.evaluate(() => window.protocolStates.at(-1).kind),
          "closed",
        );
      },
    );
    await run(
      "Back restores a reauthorized preview with a fresh display acknowledgement",
      async () => {
        await boot();
        const name = await frame().locator("h1").innerText();
        const beforeSequence = Number(
          await page
            .locator("[data-preview-state]")
            .getAttribute("data-preview-displayed"),
        );
        await page.evaluate(() => {
          window.bfcacheReturned = false;
          window.addEventListener("pageshow", (event) => {
            window.bfcacheReturned = event.persisted;
          });
          const link = document.createElement("a");
          link.href = "/empty";
          link.textContent = "Leave editor fixture";
          document.body.append(link);
        });
        await page
          .getByRole("link", { name: "Leave editor fixture", exact: true })
          .click();
        await page.goBack({ waitUntil: "commit" });
        await page.waitForFunction((before) => {
          const state = document.querySelector("[data-preview-state]")?.dataset;
          return (
            state?.previewState === "displayed" &&
            Number(state.previewDisplayed) > before
          );
        }, beforeSequence);
        assert.equal(await page.evaluate(() => window.bfcacheReturned), true);
        await page.waitForFunction(() =>
          document
            .querySelector("iframe")
            ?.contentDocument?.querySelector("h1"),
        );
        assert.equal(
          await page.evaluate(
            () =>
              document
                .querySelector("iframe")
                .contentDocument.querySelector("h1").textContent,
          ),
          name,
        );
      },
    );
    // The other owner's state is set here, not inherited from earlier
    // journeys (the setup guide deletes bob's portfolio). A signed-in owner
    // with or without a portfolio must both read as a session change.
    async function otherOwner(withPortfolio) {
      if (withPortfolio) {
        const response = await authority(
          "/api/owner/portfolio",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
          "bob",
        );
        assert.equal(response.status, 200);
        return "bob";
      }
      const owner = await (await authority("/api/owner", {}, "fresh")).json();
      assert.equal(owner.portfolio, null, "fresh owner has no portfolio");
      return "fresh";
    }
    // Waits until the preview child replaces its content with a notice, then
    // returns it, so a wrong notice fails here instead of waiting forever.
    async function childNotice() {
      const child = frame();
      await child.waitForFunction(
        () => {
          const root = document.getElementById("preview-root");
          return root && !root.querySelector("main") && root.textContent.trim();
        },
        undefined,
        { timeout: 15000 },
      );
      return (await child.locator("#preview-root").textContent()).trim();
    }
    await run(
      "a cached child rechecks identity before restoring its mount",
      async () => {
        for (const withPortfolio of [true, false]) {
          const session = await otherOwner(withPortfolio);
          await boot();
          await frame().evaluate(() =>
            window.dispatchEvent(
              new PageTransitionEvent("pagehide", { persisted: true }),
            ),
          );
          assert.equal(await frame().locator("h1").count(), 0);
          await context.addCookies([
            { name: "fixture-session", value: session, url: browserOrigin },
          ]);
          await frame().evaluate(() =>
            window.dispatchEvent(
              new PageTransitionEvent("pageshow", { persisted: true }),
            ),
          );
          assert.equal(
            await childNotice(),
            "Your session changed. Reopen the editor to preview.",
          );
          assert.equal(await frame().locator("h1").count(), 0);
        }
      },
    );
    await run(
      "changed owner cannot receive the previous owner model or private configuration",
      async () => {
        const session = await otherOwner(true);
        await boot();
        const html = await frame().content();
        assert.doesNotMatch(
          html,
          /recipient-1|avatar-1|banner-1|resume-pdf|includePrivate|sharing-image/,
        );
        await context.addCookies([
          { name: "fixture-session", value: session, url: browserOrigin },
        ]);
        await frame().evaluate(() => window.dispatchEvent(new Event("focus")));
        assert.equal(
          await childNotice(),
          "Your session changed. Reopen the editor to preview.",
        );
        assert.equal(await frame().locator("h1").count(), 0);
        await page.waitForFunction(
          () =>
            document.querySelector("[data-preview-state]")?.dataset
              .previewState === "rejected",
        );
        await page.evaluate(() =>
          window.editorFixture.recovery.store
            .getState()
            .controller.edit(["profile", "name"], "Must not cross owners"),
        );
        await page.waitForTimeout(100);
        assert.doesNotMatch(
          await frame().locator("body").innerText(),
          /Must not cross owners/,
        );
        await context.addCookies([
          { name: "fixture-session", value: "expired", url: browserOrigin },
        ]);
        assert.equal(
          (
            await context.request.get(`${browserOrigin}/private/editor-preview`)
          ).status(),
          401,
        );
      },
    );
  }
  const controls = {
    getPage: () => page,
    context,
    boot,
    displayed,
    frame,
    sql,
    run: (name, work) => run(name, work),
    evidence,
    browserOrigin,
    authority,
    cookie,
    // The owner runtime itself, for journeys that act as an operator would
    // (Phase 50 publishes the internal example with a signed session).
    origin,
    secrets,
    root,
    github,
    email,
  };
  return {
    controls,
    errors,
    core,
    useStep,
    async close() {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
