import type { Metadata } from "next";
import { AuthRecovery } from "../../../../components/auth-recovery";

export const metadata: Metadata = {
  title: "Resume sign-in | hasaweb.site",
  robots: { index: false, follow: false },
};
export default function RecoveryErrorPage() {
  return <AuthRecovery />;
}
