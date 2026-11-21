-- Phase 50. The entry page's example portfolio is a real portfolio owned by an
-- internal account and published through the ordinary pipeline
-- (`pnpm example:publish`). `example` stops being a platform-reserved name and
-- becomes this portfolio's address hold in the same migration, so no owner can
-- take it in between. The account has no sign-in provider and an address at
-- the reserved `.invalid` domain, so nobody can sign in to it or link to it by
-- email. scripts/example-portfolio/publish.mjs uses the `internal-example` IDs.
DELETE FROM reserved_subdomain WHERE name = 'example';
--> statement-breakpoint
INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
VALUES ('internal-example', 'hasaweb.site example', 'internal-example@hasaweb.invalid', 0,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
--> statement-breakpoint
INSERT INTO portfolio (id, user_id, draft, draft_validation_version, setup_progress, created_at, updated_at)
VALUES ('internal-example', 'internal-example',
  '{"schemaVersion":2,"requestedSubdomain":"example","profile":{"name":"","bio":"","faceReveal":{"enabled":false}},"links":[],"components":[],"appearance":{"themeId":"leaf","fontId":"dm-sans","colorMode":"system"},"seo":{},"samples":{}}',
  2, '{"schemaVersion":1,"step":"address"}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
--> statement-breakpoint
INSERT INTO subdomain_claim (name, portfolio_id, state, held_at, claimed_at)
VALUES ('example', 'internal-example', 'held', CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL);
