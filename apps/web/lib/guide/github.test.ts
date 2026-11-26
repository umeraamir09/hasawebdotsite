import { afterEach, describe, expect, it } from "vitest";
import { createDraftController } from "../draft/controller";
import { fixtureTransport, memoryStorage } from "../draft/test-fixtures";
import type { GraphSetupStatus } from "../editor/github-graph";
import { acceptGraph, findGraph, graphConnected, graphGap } from "./github";

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
  private: ready,
  privateAvailable: true,
  githubSignIn: true,
  ...change,
});
const graph = (username: string, includePrivate = true) => ({
  data: { username, includePrivate },
});

describe("guide GitHub step", () => {
  it("adds one graph, always with private activity, only when an account is accepted", async () => {
    const controller = await setup();
    expect(findGraph(controller.store.getState().working)).toBeUndefined();
    expect(acceptGraph(controller, "Octo")).toBe(true);
    const added = findGraph(controller.store.getState().working);
    expect(added?.data).toEqual({ username: "Octo", includePrivate: true });
    // A later acceptance (another account) updates the same graph.
    expect(acceptGraph(controller, "someone-else")).toBe(true);
    const graphs = controller.store
      .getState()
      .working?.components.filter((item) => item.type === "github");
    expect(graphs?.map((item) => item.id)).toEqual([added?.id]);
    expect(findGraph(controller.store.getState().working)?.data).toEqual({
      username: "someone-else",
      includePrivate: true,
    });
  });

  it("is connected only with authorized, fetched activity for the account", () => {
    expect(graphConnected(status())).toBe(true);
    expect(graphConnected(status(), "octo")).toBe(true);
    expect(graphConnected(status(), "other")).toBe(false);
    expect(graphConnected(status({ connection: null }))).toBe(false);
    expect(graphConnected(status({ private: { state: "pending" } }))).toBe(
      false,
    );
  });

  it("continues only with an authorized graph; zero contributions are complete", () => {
    expect(graphGap(status(), graph("octo"))).toBeNull();
    // Not connected, or the draft names another account than the server.
    expect(graphGap(status({ connection: null }), graph("octo"))).toBe(
      "connect",
    );
    expect(graphGap(status(), graph(""))).toBe("connect");
    expect(graphGap(status(), graph("other"))).toBe("connect");
    for (const state of [
      { state: "off" },
      { state: "authorizing" },
      { state: "consent_failed", reason: "cancelled" },
      { state: "consent_failed", reason: "wrong_account" },
      { state: "cleanup" },
      { state: "reconnect" },
      { state: "pending" },
      { state: "error", kind: "retry" },
    ] as const)
      expect(graphGap(status({ private: state }), graph("octo"))).toBe(
        "authorize",
      );
    // A failed refresh keeps the last good graph, which is still complete.
    // The public baseline is not needed: the authorized calendar has it all.
    expect(
      graphGap(
        status({
          private: { ...ready, lastError: "retry" },
          public: { state: "restricted" },
        }),
        graph("octo"),
      ),
    ).toBeNull();
  });

  it("checks only the public fetch of a graph saved without private activity", () => {
    expect(
      graphGap(status({ private: { state: "off" } }), graph("octo", false)),
    ).toBeNull();
    expect(
      graphGap(status({ public: { state: "pending" } }), graph("octo", false)),
    ).toBe("authorize");
  });
});
