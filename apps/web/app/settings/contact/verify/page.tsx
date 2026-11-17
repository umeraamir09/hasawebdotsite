import type { Metadata } from "next";
import { RecipientVerification } from "../../../../components/recipient-verification";

export const metadata: Metadata = {
  title: "Confirm your contact address | hasaweb.site",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
// The link from a recipient confirmation email. The token stays in the URL
// fragment, so it never reaches a server log; the owner confirms explicitly,
// which keeps link scanners from confirming an address by opening it.
export default function RecipientVerificationPage() {
  return <RecipientVerification />;
}
