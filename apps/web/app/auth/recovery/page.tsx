import type { Metadata } from "next";
import { AuthRecovery } from "../../../components/auth-recovery";

export const metadata: Metadata = {
  title: "Recover your draft | hasaweb.site",
  robots: { index: false, follow: false },
};
export default function RecoveryPage() {
  return <AuthRecovery />;
}
