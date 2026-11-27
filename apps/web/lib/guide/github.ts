import type { ComponentOf, DraftDoc } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import {
  type GraphSetupStatus,
  setGitHubAccount,
} from "../editor/github-graph";
import { addGuideComponent } from "./order";

// The optional GitHub screen (Phase 42D). It reuses the editor's graph
// service; this module only decides what the guide may do with the draft
// component and the server's status.

export type GraphComponent = ComponentOf<"github">;

export function findGraph(draft: DraftDoc | null | undefined) {
  return draft?.components.find((item) => item.type === "github") as
    | GraphComponent
    | undefined;
}

/**
 * Records an account the server selected. The graph component is created
 * only here: when the owner continues with a connected graph, or leaves to
 * authorize the sign-in account. Visiting or skipping the screen never adds
 * a graph.
 */
export function acceptGraph(
  controller: DraftController,
  username: string,
): boolean {
  const existing = findGraph(controller.store.getState().working);
  const id = existing?.id ?? addGuideComponent(controller, "github");
  return id ? setGitHubAccount(controller, id, username) : false;
}

/** Whether the server holds an authorized, fetched graph for this account. */
export function graphConnected(status: GraphSetupStatus, username?: string) {
  const { connection } = status;
  return Boolean(
    connection &&
      (username === undefined ||
        connection.username.toLowerCase() === username.toLowerCase()) &&
      status.private.state === "ready",
  );
}

export type GraphGap = "connect" | "authorize";

/**
 * Whether the graph is complete enough to Continue: the draft names the
 * account the server selected, and that account is authorized and fetched.
 * A graph saved before every graph included private activity needs only its
 * public fetch, as Publish does. Anything else stays in the draft with its
 * publication blocker; the owner can authorize again or finish later.
 */
export function graphGap(
  status: GraphSetupStatus,
  graph: Pick<GraphComponent, "data">,
): GraphGap | null {
  const { connection } = status;
  if (
    !graph.data.username ||
    !connection ||
    connection.username.toLowerCase() !== graph.data.username.toLowerCase()
  )
    return "connect";
  if (!graph.data.includePrivate)
    return status.public.state === "ready" ? null : "authorize";
  return graphConnected(status) ? null : "authorize";
}

export const graphGapMessage: Record<GraphGap, string> = {
  connect: "Connect a GitHub account to add the graph, or skip.",
  authorize:
    "Your GitHub account isn't authorized yet. Authorize it on GitHub, or finish later in the editor.",
};
