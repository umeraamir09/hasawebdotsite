// Keep the database seed in migrations/0001_owner_constraints.sql in sync.
// `example` is not reserved: migration 0022 holds it for the internal example
// portfolio.
// Additional operator deny-list names can be inserted without changing this list.
export const RESERVED_SUBDOMAINS = [
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
  "demo",
] as const;
