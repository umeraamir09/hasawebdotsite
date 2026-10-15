import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="hasaweb.site home">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>hasaweb.site</span>
    </Link>
  );
}
