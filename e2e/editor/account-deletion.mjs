import assert from "node:assert/strict";
import { openPanel } from "./shell.mjs";

// Phase 49. Uses its own owner, `draft-closer`, because deletion is
// permanent; `closer-other` is the same account's session on another device.
export async function checkAccountDeletionJourney({
  context,
  browserOrigin,
  sql,
  run,
  authority,
}) {
  await run(
    "cancelling keeps the account; deleting ends access, clears this owner's local recovery in every tab and refuses late writes",
    async () => {
      const owner = "draft-closer";
      const provisioned = await authority(
        "/api/owner/portfolio",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
        "closer",
      );
      assert.equal(provisioned.status, 200);
      const portfolioId = (await provisioned.json()).portfolio.id;
      const name = `closer-${Date.now().toString(36)}`;
      const [{ draft }] = await sql("SELECT draft FROM portfolio WHERE id=?", [
        portfolioId,
      ]);
      await sql(
        "UPDATE portfolio SET draft=?,draft_validation_version=2,draft_rev=draft_rev+1,first_editor_entered_at=? WHERE id=?",
        [
          JSON.stringify({ ...JSON.parse(draft), requestedSubdomain: name }),
          Date.now(),
          portfolioId,
        ],
      );
      await sql(
        "INSERT INTO subdomain_claim(name,portfolio_id,state,held_at) VALUES(?,?,'held',?)",
        [name, portfolioId, Date.now()],
      );
      for (const open of context.pages()) await open.close();
      await context.addCookies([
        { name: "fixture-session", value: "closer", url: browserOrigin },
      ]);
      const tabs = [];
      for (let n = 0; n < 2; n++) {
        const page = await context.newPage();
        await page.goto(browserOrigin);
        await page.waitForFunction(() => window.editorFixture?.ready);
        tabs.push(page);
      }
      const [page, other] = tabs;
      // Another account's recovery in this browser, which must survive.
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("hasaweb-draft-recovery-v1");
            request.onerror = reject;
            request.onsuccess = () => {
              const transaction = request.result.transaction(
                "records",
                "readwrite",
              );
              transaction
                .objectStore("records")
                .put({ version: 1, id: "kept", ownerId: "draft-alice" }, [
                  "draft-alice",
                  "alice-portfolio",
                  "kept",
                ]);
              transaction.oncomplete = resolve;
              transaction.onerror = reject;
            };
          }),
      );
      // A second tab left for recovery sign-in: its continuation names this
      // owner and a review copy sits in the owner's range.
      await other.evaluate(
        async ({ owner, portfolioId }) => {
          await window.editorFixture.storage.put({
            version: 1,
            id: "review-copy",
            ownerId: owner,
            portfolioId,
            context: "content",
            reviewOnly: true,
            base: null,
            working: null,
            progress: null,
            inputs: {},
            batch: null,
          });
          sessionStorage.setItem(
            "hasaweb-draft-auth-v1",
            JSON.stringify({
              version: 1,
              flow: "draft-recovery",
              context: "content",
              ownerId: owner,
              portfolioId,
              recordId: "review-copy",
            }),
          );
        },
        { owner, portfolioId },
      );
      // Unfinished input is mirrored locally before any save.
      await openPanel(page, "Share");
      await page.getByLabel("Address name").fill("Not A Name");
      const keys = (target) =>
        target.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const request = indexedDB.open("hasaweb-draft-recovery-v1");
              request.onerror = reject;
              request.onsuccess = () => {
                const all = request.result
                  .transaction("records")
                  .objectStore("records")
                  .getAllKeys();
                all.onsuccess = () =>
                  resolve(all.result.map((key) => JSON.stringify(key)));
                all.onerror = reject;
              };
            }),
        );
      await page.waitForFunction(async (owner) => {
        const request = indexedDB.open("hasaweb-draft-recovery-v1");
        const db = await new Promise((resolve) => {
          request.onsuccess = () => resolve(request.result);
        });
        const all = db
          .transaction("records")
          .objectStore("records")
          .getAllKeys();
        const found = await new Promise((resolve) => {
          all.onsuccess = () => resolve(all.result);
        });
        return found.filter((key) => key[0] === owner).length >= 2;
      }, owner);

      // Other accounts' records (seeded above, or left by earlier journeys in
      // this browser) must all survive.
      const others = (await keys(page)).filter(
        (key) => !key.startsWith(JSON.stringify([owner]).slice(0, -1)),
      );
      assert.ok(
        others.includes(
          JSON.stringify(["draft-alice", "alice-portfolio", "kept"]),
        ),
      );
      const section = page.getByRole("region", { name: "Delete account" });
      await section
        .getByRole("button", { name: "Delete account", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Delete this account?" });
      await dialog.waitFor();
      for (const text of [
        "Permanently deletes your portfolio, draft, files and connected access. This cannot be undone.",
        `Your reserved address ${name}.hasaweb.site is released, so someone else can choose it.`,
        "GitHub and Google sign-in and private GitHub activity access are removed.",
      ])
        await dialog.getByText(text, { exact: true }).waitFor();
      // Keep my account is the focused default; it changes nothing.
      assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        "Keep my account",
      );
      await dialog
        .getByRole("button", { name: "Keep my account", exact: true })
        .click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        (await authority("/api/owner", {}, "closer-other")).status,
        200,
      );
      assert.deepEqual(
        await sql(
          "SELECT u.deleting_at,p.status,c.state FROM user u JOIN portfolio p ON p.user_id=u.id JOIN subdomain_claim c ON c.portfolio_id=p.id WHERE u.id=?",
          [owner],
        ),
        [{ deleting_at: null, status: "draft", state: "held" }],
      );
      // Escape cancels too.
      await section
        .getByRole("button", { name: "Delete account", exact: true })
        .click();
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal((await authority("/api/owner", {}, "closer")).status, 200);

      await section
        .getByRole("button", { name: "Delete account", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Delete permanently", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Your account was deleted" })
        .waitFor();
      await other
        .getByText(
          "This account was deleted in another tab. Nothing here was saved.",
          { exact: true },
        )
        .waitFor();

      // Every session, including the other device's, is denied at once.
      for (const session of ["closer", "closer-other"])
        assert.equal((await authority("/api/owner", {}, session)).status, 401);
      // The queued cleanup may already have removed the account (this owner
      // has no uploads to wait for); until then it is marked deleting.
      const [state] = await sql(
        "SELECT u.deleting_at,p.status FROM user u LEFT JOIN portfolio p ON p.user_id=u.id WHERE u.id=?",
        [owner],
      );
      if (state) {
        assert.ok(state.deleting_at > 0);
        assert.ok([null, "deleting"].includes(state.status), state.status);
      }
      assert.deepEqual(
        await sql("SELECT count(*) AS n FROM session WHERE user_id=?", [owner]),
        [{ n: 0 }],
      );
      assert.deepEqual(
        await sql("SELECT * FROM subdomain_claim WHERE name=?", [name]),
        [],
      );
      // Only the owner's tombstone remains of its range; another account's
      // recovery stays. The other tab dropped its continuation.
      assert.deepEqual(
        (await keys(page)).sort(),
        [...others, JSON.stringify([owner])].sort(),
      );
      assert.equal(
        await other.evaluate(() =>
          sessionStorage.getItem("hasaweb-draft-auth-v1"),
        ),
        null,
      );
      // A late write from the other tab cannot recreate the data.
      const late = await other.evaluate(
        async ({ owner, portfolioId }) =>
          window.editorFixture.storage
            .put({
              version: 1,
              id: "late",
              ownerId: owner,
              portfolioId,
              context: "content",
              base: null,
              working: null,
              progress: null,
              inputs: {},
              batch: null,
            })
            .then(
              () => "written",
              (error) => error.message,
            ),
        { owner, portfolioId },
      );
      assert.equal(late, "This account was deleted");
      assert.deepEqual(
        (await keys(other)).sort(),
        [...others, JSON.stringify([owner])].sort(),
      );
      for (const tab of tabs) await tab.close();
    },
  );
}
