import Link from "next/link";
import { Brand } from "../components/brand";

export default function HomePage() {
  return (
    <main className="home">
      <Brand />
      <h1>
        Everyone should have
        <br />a website.
      </h1>
      <p>
        A portfolio for your profile and work, at your own hasaweb.site address.
      </p>
      <Link className="ghost-button" href="/sign-in">
        Start building
      </Link>
    </main>
  );
}
