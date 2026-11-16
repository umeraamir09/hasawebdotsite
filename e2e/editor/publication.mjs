import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkPublicationControls({
  getPage,
  boot,
  sql,
  run,
  evidence,
}) {
  async function clean() {
    await boot();
    const draft = await getPage().evaluate(() =>
      structuredClone(
        window.editorFixture.recovery.store
          .getState()
          .controller.store.getState().working,
      ),
    );
    draft.profile.name = "";
    draft.profile.bio = "";
    delete draft.profile.avatar;
    delete draft.profile.banner;
    draft.profile.faceReveal = { enabled: false };
    delete draft.profile.decorationId;
    draft.appearance = {
      themeId: "leaf",
      fontId: "dm-sans",
      colorMode: "system",
    };
    draft.components = [];
    draft.links = [];
    draft.samples = {};
    draft.seo = {};
    await boot(draft);
    return draft;
  }
  const checklist = () =>
    getPage().getByRole("region", { name: "Publication checklist" });
  async function check() {
    await checklist()
      .getByRole("button", { name: "Check publication readiness" })
      .click();
    await checklist()
      .getByRole("button", { name: "Complete your name", exact: true })
      .waitFor();
  }
  await run(
    "publication correction follows its project when entries are reordered",
    async () => {
      const draft = await clean();
      draft.components = [
        {
          id: "projects",
          type: "projects",
          version: 1,
          data: {
            entries: [
              {
                id: "first",
                title: "",
                summary: "First summary",
                technologies: [],
                contribution: "",
              },
              {
                id: "second",
                title: "Second",
                summary: "Second summary",
                technologies: [],
                contribution: "",
              },
            ],
          },
        },
      ];
      await boot(draft);
      await check();
      await checklist()
        .getByRole("button", {
          name: "Complete your projects title",
          exact: true,
        })
        .first()
        .click();
      await getPage()
        .getByRole("button", { name: "Move Second up", exact: true })
        .click();
      await getPage().getByLabel("Required value").fill("First project");
      const entries = await getPage().evaluate(
        () =>
          window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().working.components[0].data.entries,
      );
      assert.deepEqual(
        entries.map(({ id, title }) => [id, title]),
        [
          ["second", "Second"],
          ["first", "First project"],
        ],
      );
    },
  );
  await run(
    "publication issues open profile, image, link and address controls on desktop and mobile",
    async () => {
      await clean();
      for (const width of [1440, 390]) {
        await getPage().setViewportSize({ width, height: 900 });
        await check();
        for (const [name, selector] of [
          ["Complete your name", '[data-publication-field="name"] input'],
          ["Complete your bio", '[data-publication-field="bio"] textarea'],
          ["Complete your avatar", '[data-publication-field="avatar"] input'],
          ["Complete your banner", '[data-publication-field="banner"] input'],
          [
            "Complete your profile link",
            '[data-publication-field="links"] input',
          ],
          [
            "Reserve or restore your address",
            '[data-publication-field="address"] input',
          ],
        ]) {
          await checklist().getByRole("button", { name, exact: true }).click();
          await getPage().waitForFunction((selector) => {
            const root = document.querySelector(selector.split(" ")[0]);
            return root?.contains(document.activeElement);
          }, selector);
        }
      }
      await getPage().screenshot({
        path: join(evidence, "publication-mobile.png"),
        fullPage: true,
      });
      await getPage().setViewportSize({ width: 1440, height: 900 });
      await getPage()
        .getByLabel("Name", { exact: true })
        .fill("Edited after check");
      await checklist()
        .getByText("Your draft changed. Check it again before publishing.")
        .waitFor();
      await getPage().waitForFunction(
        () =>
          !window.editorFixture.recovery.store
            .getState()
            .controller.store.getState().pending,
      );
    },
  );
  await run(
    "publication catalog correction and edited optional samples use saved controls",
    async () => {
      const draft = await clean();
      draft.appearance.themeId = "unknown";
      draft.components = [
        { id: "sample-resume", type: "resume", version: 1, data: {} },
        {
          id: "edited-text",
          type: "text",
          version: 1,
          data: {
            title: "",
            body: {
              type: "doc",
              content: [{ type: "paragraph", content: [] }],
            },
          },
        },
      ];
      draft.samples = { "components.sample-resume": true };
      await boot(draft);
      await check();
      assert.equal(
        await checklist()
          .getByRole("button", { name: /resume download resume PDF/ })
          .count(),
        0,
      );
      await checklist()
        .getByRole("button", {
          name: "Choose an approved theme",
        })
        .click();
      await getPage().getByLabel("Approved option").selectOption("violet");
      await getPage().getByRole("button", { name: "Close correction" }).click();
      await getPage()
        .getByRole("region", { name: "Publication checklist" })
        .getByRole("button", { name: "Check publication readiness" })
        .click();
      await checklist()
        .getByRole("button", {
          name: "Complete your text section title",
          exact: true,
        })
        .click();
      await getPage().getByLabel("Required value").fill("My own section");
      await getPage()
        .getByRole("button", { name: "Remove this section" })
        .click();
      await getPage()
        .getByRole("dialog")
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await getPage().waitForFunction(() => {
        const state = window.editorFixture.recovery.store
          .getState()
          .controller.store.getState();
        return state.status === "saved" && !state.pending;
      });
      const row = (
        await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
      )[0];
      const saved = JSON.parse(row.draft);
      assert.equal(saved.appearance.themeId, "violet");
      assert.deepEqual(
        saved.components.map((item) => item.id),
        ["sample-resume"],
      );
      assert.equal(saved.samples["components.sample-resume"], true);
    },
  );
  await run(
    "publication editing an untouched sample activates normal text requirements",
    async () => {
      const draft = await clean();
      draft.components = [
        {
          id: "optional-sample",
          type: "text",
          version: 1,
          data: {
            title: "Example",
            body: {
              type: "doc",
              content: [{ type: "paragraph", content: [] }],
            },
          },
        },
      ];
      draft.samples = { "components.optional-sample": true };
      await boot(draft);
      await check();
      assert.equal(
        await checklist()
          .getByRole("button", {
            name: "Complete your text section text",
            exact: true,
          })
          .count(),
        0,
      );
      await getPage()
        .locator(
          '[data-order-id="optional-sample"] .ordered-item-heading button',
        )
        .nth(1)
        .click();
      await getPage().getByLabel("Section title").fill("My section");
      await checklist()
        .getByRole("button", { name: "Check publication readiness" })
        .click();
      await checklist()
        .getByRole("button", {
          name: "Complete your text section text",
          exact: true,
        })
        .click();
      await getPage()
        .getByLabel("Section text", { exact: true })
        .fill("My own text");
      await checklist()
        .getByRole("button", { name: "Check publication readiness" })
        .click();
      await checklist()
        .getByRole("button", { name: "Complete your name", exact: true })
        .waitFor();
      assert.equal(
        await checklist()
          .getByRole("button", {
            name: "Complete your text section text",
            exact: true,
          })
          .count(),
        0,
      );
      const saved = JSON.parse(
        (
          await sql("SELECT draft FROM portfolio WHERE user_id='draft-alice'")
        )[0].draft,
      );
      assert.equal(saved.samples["components.optional-sample"], undefined);
      assert.equal(
        saved.components[0].data.body.content[0].content[0].text,
        "My own text",
      );
    },
  );
  await run(
    "publication removal clears only the removed section's unfinished input",
    async () => {
      const draft = await clean();
      draft.components = [
        {
          id: "incomplete-work",
          type: "work-experience",
          version: 1,
          data: {
            entries: [
              {
                id: "role",
                role: "Developer",
                organization: "Example",
                startDate: "2026-01",
                endDate: "",
                current: false,
                description: "My work",
              },
            ],
          },
        },
      ];
      await boot(draft);
      const before = (
        await sql(
          "SELECT id,first_editor_entered_at FROM portfolio WHERE user_id='draft-alice'",
        )
      )[0];
      await check();
      await checklist()
        .getByRole("button", {
          name: "Complete your work experience end date",
          exact: true,
        })
        .click();
      await getPage().getByLabel("Required value").fill("2026-");
      await getPage().getByLabel("Address name").fill("unfinished-");
      await getPage()
        .getByRole("button", { name: "Remove this section", exact: true })
        .click();
      await getPage()
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert.equal(
        await getPage().getByLabel("Required value").inputValue(),
        "2026-",
      );
      await getPage()
        .getByRole("button", { name: "Remove this section", exact: true })
        .click();
      await getPage()
        .getByRole("dialog")
        .getByRole("button", { name: "Remove section", exact: true })
        .click();
      await getPage()
        .getByRole("region", { name: "Publication correction" })
        .waitFor({ state: "detached" });
      assert.equal(
        await getPage().getByLabel("Address name").inputValue(),
        "unfinished-",
      );
      assert.equal(
        await checklist()
          .getByRole("button", {
            name: "Finish unsaved section details",
            exact: true,
          })
          .count(),
        0,
      );
      await getPage().getByLabel("Address name").fill("publication-cleanup");
      await getPage()
        .getByRole("button", { name: "Save address", exact: true })
        .click();
      await getPage()
        .getByText("Reserved for your portfolio. Your site is still private.", {
          exact: true,
        })
        .waitFor();
      await check();
      assert.equal(
        await checklist()
          .getByRole("button", {
            name: "Reserve or restore your address",
            exact: true,
          })
          .count(),
        0,
      );
      const saved = (
        await sql(
          "SELECT draft,first_editor_entered_at,subdomain,published_version FROM portfolio WHERE user_id='draft-alice'",
        )
      )[0];
      assert.deepEqual(JSON.parse(saved.draft).components, []);
      assert.equal(
        saved.first_editor_entered_at,
        before.first_editor_entered_at,
      );
      assert.equal(saved.subdomain, null);
      assert.equal(saved.published_version, null);
      assert.deepEqual(
        (
          await sql(
            "SELECT name,state FROM subdomain_claim WHERE portfolio_id=?",
            [before.id],
          )
        )[0],
        { name: "publication-cleanup", state: "held" },
      );
    },
  );
}
