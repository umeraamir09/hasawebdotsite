// Keep the database seed in migrations/0001_owner_constraints.sql in sync.
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
  "example",
  "demo",
] as const;
