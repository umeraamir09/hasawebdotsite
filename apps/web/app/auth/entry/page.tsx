import type { Metadata } from "next";
import { EditorEntry } from "../../../components/editor-entry";

export const metadata: Metadata = { title: "Your account | hasaweb.site" };
export default function AccountEntryPage() {
  return <EditorEntry entry />;
}
