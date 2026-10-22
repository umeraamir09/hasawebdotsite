import { createComponent, type SocialLink } from "@hasaweb/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import { readEditorField } from "./fields";
import {
  addSocialLink,
  editSocialDestination,
  hasQualifyingProfileLink,
  moveSocialLink,
  removeSocialLink,
} from "./social-links";

const controllers: ReturnType<typeof createDraftController>[] = [];
async function setup() {
  const network = fixtureTransport();
  const storage = memoryStorage();
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "content",
    transport: network.transport,
    storage,
    coordinator: {
      exclusive: true,
      run: (work) => work(),
      publish: () => {},
      publishAttempt: () => {},
      close: () => {},
    },
  });
  controllers.push(controller);
  await controller.initialize();
  return { controller, network, storage };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("social and contact identity", () => {
  const link: SocialLink = {
    id: "contact",
    kind: "website",
    label: "My website",
    value: "https://example.com",
    showInProfile: true,
    showInSocialComponent: true,
  };
  it("requires a labeled, nonempty, valid profile link without counting a contact form", () => {
    expect(hasQualifyingProfileLink({ links: [] })).toBe(false);
    expect(hasQualifyingProfileLink({ links: [link] })).toBe(true);
    for (const change of [
      { label: "  " },
      { value: "" },
      { value: "javascript:alert(1)" },
      { value: "https://user:password@example.com" },
      { showInProfile: false },
      { kind: "email", value: "invalid@" },
      { kind: "email", value: "mailto:owner@example.com" },
    ])
      expect(
        hasQualifyingProfileLink({ links: [{ ...link, ...change }] }),
      ).toBe(false);
    expect(
      hasQualifyingProfileLink({
        links: [{ ...link, kind: "email", value: "owner@example.com" }],
      }),
    ).toBe(true);
  });
  it("stores one accepted email, keeps its identity and shares edits between placements", async () => {
    const { controller, network } = await setup();
    const id = addSocialLink(controller, "owner@example.com");
    expect(id).toBeTruthy();
    expect(addSocialLink(controller, "owner@example.com")).toBe(id);
    const draft = controller.store.getState().working;
    if (!draft || !id) throw new Error("Missing accepted link");
    controller.update({
      ...draft,
      components: [createComponent("social-links", "social")],
    });
    controller.edit(["links", { id }, "showInSocialComponent"], true);
    editSocialDestination(controller, id, "value", "new@example.com");
    await controller.flushValid();
    const saved = await network.transport.read();
    expect(saved.draft.links).toEqual([
      {
        id,
        label: "Email",
        kind: "email",
        value: "new@example.com",
        showInProfile: true,
        showInSocialComponent: true,
      },
    ]);
  });
  it("preserves raw destination and selected type through durable recovery without overwriting the valid link", async () => {
    const { controller, storage } = await setup();
    const draft = controller.store.getState().working;
    if (!draft) throw new Error("Missing draft");
    controller.update({ ...draft, links: [link] });
    expect(editSocialDestination(controller, link.id, "kind", "email")).toBe(
      false,
    );
    expect(
      editSocialDestination(controller, link.id, "value", "unfinished@"),
    ).toBe(false);
    const result = await controller.flushValid();
    expect(result.hasLocalOnlyInput).toBe(true);
    const records = await storage.list("owner-a", "portfolio-a");
    expect(records[0]?.working?.links).toEqual([link]);
    expect(records[0]?.inputs['["links",{"id":"contact"},"kind"]']?.value).toBe(
      "email",
    );
    expect(
      records[0]?.inputs['["links",{"id":"contact"},"value"]']?.value,
    ).toBe("unfinished@");
    expect(
      editSocialDestination(controller, link.id, "value", "owner@example.com"),
    ).toBe(true);
    expect(
      readEditorField(controller.store.getState(), [
        "links",
        { id: link.id },
        "value",
      ]),
    ).toBe("owner@example.com");
    expect(controller.store.getState().inputs).toEqual({});
    expect(controller.store.getState().working?.links[0]).toEqual({
      ...link,
      kind: "email",
      value: "owner@example.com",
    });
  });
  it("reorders stable entries and clears only explicitly removed entry input", async () => {
    const { controller } = await setup();
    const draft = controller.store.getState().working;
    if (!draft) throw new Error("Missing draft");
    controller.update({ ...draft, links: [link, { ...link, id: "second" }] });
    editSocialDestination(controller, link.id, "value", "invalid destination");
    controller.setInput(["profile", "name"], "Preserved elsewhere");
    moveSocialLink(controller, link.id, 1);
    expect(
      controller.store.getState().working?.links.map((item) => item.id),
    ).toEqual(["second", "contact"]);
    expect(
      readEditorField(controller.store.getState(), [
        "links",
        { id: "contact" },
        "value",
      ]),
    ).toBe("invalid destination");
    removeSocialLink(controller, "contact");
    expect(
      controller.store.getState().working?.links.map((item) => item.id),
    ).toEqual(["second"]);
    expect(Object.keys(controller.store.getState().inputs)).toEqual([
      '["profile","name"]',
    ]);
  });
});
