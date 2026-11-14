import type { ComponentOf, DraftDoc } from "@hasaweb/schema";
import type { DraftController } from "../draft/controller";
import {
  type GraphSetupStatus,
  setGitHubUsername,
} from "../editor/github-graph";
import { addGuideComponent } from "./order";

// The optional GitHub screen (Phase 42D). It reuses the editor's graph
// service and panel; this module only decides what the guide may do with
// the draft component and the server's status.

export type GraphComponent = ComponentOf<"github">;

export function findGraph(draft: DraftDoc | null | undefined) {
  return draft?.components.find((item) => item.type === "github") as
    | GraphComponent
    | undefined;
}

/**
 * Records a username the server accepted. The graph component is created
 * only here, after the owner chose Add graph and the setup route selected the
 * account (even when its first fetch failed), so visiting or skipping the
 * screen never adds a graph and signup alone never implies one.
 */
export function acceptGraph(
  controller: DraftController,
  username: string,
): boolean {
  const existing = findGraph(controller.store.getState().working);
  const id = existing?.id ?? addGuideComponent(controller, "github");
  return id ? setGitHubUsername(controller, id, username) : false;
}

export type GraphGap = "fetch" | "public" | "private";

/**
 * Whether the selected configuration is complete enough to Continue: the
 * draft names the account the server selected, its public fetch succeeded
 * (zero contributions included), and a requested private graph is authorized
 * and fetched. Anything else stays in the draft with its publication blocker;
 * the owner can Retry, use public activity only, or finish later.
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
    return "fetch";
  if (status.public.state !== "ready") return "public";
  if (graph.data.includePrivate && status.private.state !== "ready")
    return "private";
  return null;
}

export const graphGapMessage: Record<GraphGap, string> = {
  fetch:
    "Fetch activity for your GitHub username to add the graph, or skip this step.",
  public:
    "Your graph hasn't been fetched successfully yet. Retry, or finish it later in the editor.",
  private:
    "Private activity isn't authorized and fetched yet. Authorize again, use public activity only, or finish it later in the editor.",
};
