import type { Metadata } from "next";
import { EditorEntry } from "../../components/editor-entry";

export const metadata: Metadata = { title: "Your portfolio | hasaweb.site" };
// Public static shell. Only /api/owner may supply authenticated account data.
export default function EditorPage() {
  return <EditorEntry />;
}
