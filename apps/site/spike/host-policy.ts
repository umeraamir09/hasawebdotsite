// S-3 host-boundary experiment. This is not subdomain claiming or publication.
export const reserved = new Set([
  "www",
  "app",
  "api",
  "assets",
  "mail",
  "admin",
  "status",
  "docs",
  "blog",
  "help",
  "support",
  "static",
  "cdn",
  "example",
  "demo",
]);
export type HostTarget =
  | "web"
  | "redirect"
  | "assets"
  | "portfolio"
  | "internal-example"
  | "reserved"
  | "invalid";
export function classifyHost(authority: string): HostTarget {
  const host = authority.toLowerCase();
  if (host === "hasaweb.site") return "web";
  if (host === "www.hasaweb.site") return "redirect";
  if (host === "assets.hasaweb.site") return "assets";
  if (!host.endsWith(".hasaweb.site")) return "invalid";
  const label = host.slice(0, -".hasaweb.site".length);
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(label)) return "invalid";
  if (label === "example") return "internal-example";
  return reserved.has(label) ? "reserved" : "portfolio";
}
