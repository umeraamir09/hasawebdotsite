import {
  createComponent,
  DRAFT_MAX_BYTES,
  type DraftDoc,
  type SocialLink,
} from "@hasaweb/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import { readEditorField } from "./fields";
import {
  addLinkTo,
  addSocialLink,
  editLinkDestination,
  editSocialDestination,
  hasQualifyingProfileLink,
  linkDisplay,
  linkFromText,
  moveSocialLink,
  moveSocialLinkTo,
  readSocialPlacement,
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
  function maximumDraft(draft: DraftDoc): DraftDoc {
    const next = { ...draft, links: [link] };
    const bytes = new TextEncoder().encode(JSON.stringify(next)).byteLength;
    next.profile.bio += "x".repeat(DRAFT_MAX_BYTES - bytes);
    expect(new TextEncoder().encode(JSON.stringify(next)).byteLength).toBe(
      DRAFT_MAX_BYTES,
    );
    return next;
  }
  it("retains paired kind and valid URL text when the complete draft cannot fit them", async () => {
    const { controller, storage } = await setup();
    const draft = controller.store.getState().working;
    if (!draft) throw new Error("Missing draft");
    const full = maximumDraft(structuredClone(draft));
    controller.update(full);
    expect(editSocialDestination(controller, link.id, "kind", "mastodon")).toBe(
      false,
    );
    expect(
      editSocialDestination(
        controller,
        link.id,
        "value",
        "https://example.com/a-longer-destination",
      ),
    ).toBe(false);
    expect(controller.store.getState().working).toEqual(full);
    expect(
      readEditorField(controller.store.getState(), [
        "links",
        { id: link.id },
        "kind",
      ]),
    ).toBe("mastodon");
    expect(
      readEditorField(controller.store.getState(), [
        "links",
        { id: link.id },
        "value",
      ]),
    ).toBe("https://example.com/a-longer-destination");
    await controller.quiesce();
    const [record] = await storage.list("owner-a", "portfolio-a");
    expect(record?.inputs['["links",{"id":"contact"},"kind"]']?.value).toBe(
      "mastodon",
    );
    expect(record?.inputs['["links",{"id":"contact"},"value"]']?.value).toBe(
      "https://example.com/a-longer-destination",
    );
  });
  it("declines new links at the byte limit without changing accepted data", async () => {
    const { controller } = await setup();
    const draft = controller.store.getState().working;
    if (!draft) throw new Error("Missing draft");
    const full = maximumDraft(structuredClone(draft));
    controller.update(full);
    expect(addSocialLink(controller)).toBe(null);
    expect(addSocialLink(controller, "owner@example.com")).toBe(null);
    expect(controller.store.getState().working).toEqual(full);
    expect(controller.store.getState().inputs).toEqual({});
  });
  it("displays a recoverable placement edit when changing true to false exceeds the byte limit", async () => {
    const { controller } = await setup();
    const draft = controller.store.getState().working;
    if (!draft) throw new Error("Missing draft");
    const full = maximumDraft(structuredClone(draft));
    controller.update(full);
    expect(
      controller.edit(["links", { id: link.id }, "showInProfile"], false),
    ).toBe(false);
    expect(
      readSocialPlacement(controller.store.getState(), link, "showInProfile"),
    ).toBe(false);
    expect(controller.store.getState().working?.links[0]?.showInProfile).toBe(
      true,
    );
    expect(
      controller.edit(["links", { id: link.id }, "showInProfile"], true),
    ).toBe(true);
    expect(
      readSocialPlacement(controller.store.getState(), link, "showInProfile"),
    ).toBe(true);
    expect(controller.store.getState().inputs).toEqual({});
  });
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

describe("pasted links", () => {
  it("reads emails, known profiles and websites, adding https:// when missing", () => {
    expect(linkFromText(" mailto:me@example.com ")).toEqual({
      kind: "email",
      value: "me@example.com",
      label: "Email",
    });
    expect(linkFromText("github.com/me")).toEqual({
      kind: "github",
      value: "https://github.com/me",
      label: "GitHub",
    });
    expect(linkFromText("https://www.linkedin.com/in/me")?.kind).toBe(
      "linkedin",
    );
    expect(linkFromText("https://twitter.com/me")?.label).toBe("X");
    expect(linkFromText("https://notgithub.com/me")).toEqual({
      kind: "website",
      value: "https://notgithub.com/me",
      label: "Website",
    });
    expect(linkFromText("hello")).toBeNull();
    expect(linkFromText("javascript:alert(1)")).toBeNull();
    expect(linkFromText("")).toBeNull();
  });
  it("shows a destination without its scheme, www. or trailing slash", () => {
    expect(linkDisplay("github", "https://www.github.com/me/")).toBe(
      "github.com/me",
    );
    expect(linkDisplay("email", "me@example.com")).toBe("me@example.com");
  });
  it("adds a link to one placement and reuses an existing destination", async () => {
    const { controller } = await setup();
    const pasted = linkFromText("github.com/me");
    if (!pasted) throw new Error("Expected a link");
    const id = addLinkTo(controller, pasted, "showInSocialComponent");
    const added = controller.store
      .getState()
      .working?.links.find((link) => link.id === id);
    expect(added).toMatchObject({
      kind: "github",
      label: "GitHub",
      showInProfile: false,
      showInSocialComponent: true,
    });
    const count = controller.store.getState().working?.links.length;
    expect(addLinkTo(controller, pasted, "showInProfile")).toBe(id);
    const links = controller.store.getState().working?.links ?? [];
    expect(links).toHaveLength(count ?? 0);
    expect(links.find((link) => link.id === id)?.showInProfile).toBe(true);
  });
  it("follows a recognised destination's kind and default label", async () => {
    const { controller } = await setup();
    const pasted = linkFromText("https://example.com");
    if (!pasted) throw new Error("Expected a link");
    const id = addLinkTo(controller, pasted, "showInProfile");
    if (!id) throw new Error("Expected an id");
    const read = () =>
      controller.store.getState().working?.links.find((link) => link.id === id);
    expect(editLinkDestination(controller, id, "github.com/me")).toBe(false);
    expect(read()?.value).toBe("https://example.com");
    expect(
      editLinkDestination(controller, id, "github.com/me", { complete: true }),
    ).toBe(true);
    expect(read()).toMatchObject({
      kind: "github",
      label: "GitHub",
      value: "https://github.com/me",
    });
    controller.edit(["links", { id }, "label"], "Code");
    editLinkDestination(controller, id, "me@example.com");
    expect(read()).toMatchObject({
      kind: "email",
      label: "Code",
      value: "me@example.com",
    });
  });
  it("moves a link to another link's position", async () => {
    const { controller } = await setup();
    const first = addLinkTo(
      controller,
      { kind: "website", value: "https://a.example", label: "A" },
      "showInProfile",
    );
    const second = addLinkTo(
      controller,
      { kind: "website", value: "https://b.example", label: "B" },
      "showInProfile",
    );
    if (!first || !second) throw new Error("Expected ids");
    moveSocialLinkTo(controller, second, first);
    const ids = controller.store.getState().working?.links.map((l) => l.id);
    expect(ids?.indexOf(second)).toBeLessThan(ids?.indexOf(first) ?? -1);
  });
});
