import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { EditorEntry } from "../../../components/editor-entry";
import { OwnerEntry } from "../../../components/owner-entry";
import { ownerEntryActive } from "../../../lib/owner-entry-gate";

export const metadata: Metadata = {
  title: "Your account | hasaweb.site",
  robots: { index: false, follow: false },
};
// The shell holds no account data; only the owner API supplies it. The
// Phase 42E gate is a Worker variable, so the page resolves per request.
export const dynamic = "force-dynamic";
export default async function AccountEntryPage() {
  return (await gateOpen()) ? (
    <OwnerEntry route="entry" />
  ) : (
    <EditorEntry entry />
  );
}
async function gateOpen() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return ownerEntryActive(env);
  } catch {
    return false;
  }
}
