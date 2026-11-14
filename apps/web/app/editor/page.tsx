import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { EditorEntry } from "../../components/editor-entry";
import { OwnerEntry } from "../../components/owner-entry";
import { ownerEntryActive } from "../../lib/owner-entry-gate";

export const metadata: Metadata = {
  title: "Your portfolio | hasaweb.site",
  robots: { index: false, follow: false },
};
// Public shell. Only the owner API supplies authenticated account data. The
// Phase 42E gate is a Worker variable, so the page resolves per request.
export const dynamic = "force-dynamic";
export default async function EditorPage() {
  return (await gateOpen()) ? <OwnerEntry route="editor" /> : <EditorEntry />;
}
async function gateOpen() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return ownerEntryActive(env);
  } catch {
    return false;
  }
}
