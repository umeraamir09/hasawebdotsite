import { afterEach, describe, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import type { GraphSetupStatus } from "../editor/github-graph";
import { acceptGraph, findGraph, graphGap } from "./github";

const controllers: ReturnType<typeof createDraftController>[] = [];
async function setup() {
  const network = fixtureTransport();
  const controller = createDraftController({
    ownerId: "owner-a",
    portfolioId: "portfolio-a",
    context: "setup",
    transport: network.transport,
    storage: memoryStorage(),
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
  const draft = controller.store.getState().working;
  if (!draft) throw new Error("Missing fixture draft");
  controller.update({ ...draft, components: [], samples: {} });
  return controller;
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

const ready = {
  state: "ready",
  fetchedAt: "2026-11-13T00:00:00.000Z",
  total: 0,
  lastError: null,
} as const;
const status = (change: Partial<GraphSetupStatus> = {}): GraphSetupStatus => ({
  connection: {
    username: "Octo",
    profileUrl: "https://github.com/Octo",
    generation: 2,
  },
  public: ready,
  private: { state: "off" },
  privateAvailable: true,
  canDetect: false,
  ...change,
});
const graph = (username: string, includePrivate = false) => ({
  data: { username, includePrivate },
});

describe("guide GitHub step", () => {
  it("adds one graph only when the server accepted a username", async () => {
    const controller = await setup();
    expect(findGraph(controller.store.getState().working)).toBeUndefined();
    expect(acceptGraph(controller, "Octo")).toBe(true);
    const added = findGraph(controller.store.getState().working);
    expect(added?.data).toEqual({ username: "Octo", includePrivate: false });
    // A later acceptance (Retry, another account) updates the same graph.
    expect(acceptGraph(controller, "octo")).toBe(true);
    const graphs = controller.store
      .getState()
      .working?.components.filter((item) => item.type === "github");
    expect(graphs?.map((item) => item.id)).toEqual([added?.id]);
  });

  it("keeps the private choice for the same account and drops it for another", async () => {
    const controller = await setup();
    acceptGraph(controller, "Octo");
    const id = findGraph(controller.store.getState().working)?.id ?? "";
    const { setGitHubPrivate } = await import("../editor/github-graph");
    setGitHubPrivate(controller, id, true);
    acceptGraph(controller, "octo");
    expect(
      findGraph(controller.store.getState().working)?.data.includePrivate,
    ).toBe(true);
    acceptGraph(controller, "someone-else");
    expect(findGraph(controller.store.getState().working)?.data).toEqual({
      username: "someone-else",
      includePrivate: false,
    });
  });

  it("continues only with a complete configuration; zero contributions are complete", () => {
    expect(graphGap(status(), graph("octo"))).toBeNull();
    // Not yet fetched, or the draft names another account than the server.
    expect(graphGap(status({ connection: null }), graph("octo"))).toBe("fetch");
    expect(graphGap(status(), graph(""))).toBe("fetch");
    expect(graphGap(status(), graph("other"))).toBe("fetch");
    // A failed, restricted or unfinished first fetch.
    for (const state of [
      { state: "pending" },
      { state: "restricted" },
      { state: "error", kind: "retry" },
    ] as const)
      expect(graphGap(status({ public: state }), graph("octo"))).toBe("public");
    // A failed refresh keeps the last good graph, which is still complete.
    expect(
      graphGap(
        status({ public: { ...ready, lastError: "retry" } }),
        graph("octo"),
      ),
    ).toBeNull();
  });

  it("requires authorized, fetched private activity only when it is requested", () => {
    for (const state of [
      { state: "off" },
      { state: "authorizing" },
      { state: "consent_failed", reason: "cancelled" },
      { state: "consent_failed", reason: "wrong_account" },
      { state: "consent_failed", reason: "expired" },
      { state: "cleanup" },
      { state: "reconnect" },
      { state: "pending" },
      { state: "error", kind: "retry" },
    ] as const) {
      expect(graphGap(status({ private: state }), graph("octo", true))).toBe(
        "private",
      );
      // Public activity only never needs private access.
      expect(
        graphGap(status({ private: state }), graph("octo", false)),
      ).toBeNull();
    }
    expect(
      graphGap(
        status({ private: { ...ready, total: 3 } }),
        graph("octo", true),
      ),
    ).toBeNull();
  });
});
