CREATE TABLE `github_grant` (
	`app_id` text NOT NULL,
	`github_user_id` text NOT NULL,
	`portfolio_id` text,
	`operation_id` text NOT NULL,
	`generation` integer NOT NULL,
	`state` text NOT NULL,
	`token_enc` text,
	`token_binding` text,
	`attempt_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	PRIMARY KEY(`app_id`, `github_user_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "github_grant_state" CHECK("github_grant"."state" in ('consent','active','pending','inflight','uncertain','idle')),
	CONSTRAINT "github_grant_cleanup_token" CHECK(("github_grant"."state" not in ('pending','inflight','uncertain')) or ("github_grant"."token_enc" is not null and "github_grant"."token_binding" is not null))
);
--> statement-breakpoint
CREATE TABLE `github_legacy_credential` (
	`portfolio_id` text PRIMARY KEY NOT NULL,
	`github_user_id` text NOT NULL,
	`token_enc` text NOT NULL,
	`scopes` text NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `github_activity` ADD `generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `github_activity` ADD `public_calendar` text CHECK(public_calendar IS NULL OR json_valid(public_calendar));--> statement-breakpoint
ALTER TABLE `github_activity` ADD `authorized_calendar` text CHECK(authorized_calendar IS NULL OR json_valid(authorized_calendar));--> statement-breakpoint
ALTER TABLE `github_activity` ADD `public_error` text;--> statement-breakpoint
ALTER TABLE `github_activity` ADD `authorized_error` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `app_id` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `grant_operation` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `token_binding` text;
--> statement-breakpoint
-- Never relabel an unknown legacy private_counts payload as a complete calendar.
INSERT INTO github_legacy_credential(portfolio_id,github_user_id,token_enc,scopes)
 SELECT portfolio_id,github_user_id,token_enc,scopes FROM github_connection WHERE token_enc IS NOT NULL;
--> statement-breakpoint
UPDATE github_connection SET generation=1,private_enabled=0,
 status=CASE WHEN token_enc IS NOT NULL THEN 'needs_reconnect' ELSE 'disconnected' END,
 token_enc=NULL,scopes='',last_checked_at=NULL;
--> statement-breakpoint
UPDATE github_activity SET generation=1,public_days='[]',private_counts=NULL,
 fetched_at=NULL,last_error=NULL,refresh_requested_at=NULL;
--> statement-breakpoint
CREATE TRIGGER github_connection_generation BEFORE UPDATE ON github_connection
WHEN NEW.generation < OLD.generation OR (
 (NEW.login IS NOT OLD.login OR NEW.github_user_id IS NOT OLD.github_user_id
 OR NEW.token_enc IS NOT OLD.token_enc OR NEW.private_enabled IS NOT OLD.private_enabled
 OR NEW.status IS NOT OLD.status OR NEW.app_id IS NOT OLD.app_id
 OR NEW.grant_operation IS NOT OLD.grant_operation OR NEW.token_binding IS NOT OLD.token_binding)
 AND NEW.generation != OLD.generation+1)
BEGIN SELECT RAISE(ABORT,'GitHub connection changes require the next generation'); END;
--> statement-breakpoint
CREATE TRIGGER github_activity_insert_guard BEFORE INSERT ON github_activity
WHEN NEW.private_counts IS NOT NULL OR NOT EXISTS (
 SELECT 1 FROM github_connection c WHERE c.portfolio_id=NEW.portfolio_id AND c.generation=NEW.generation
 AND (NEW.authorized_calendar IS NULL OR (c.private_enabled=1 AND c.status='ok' AND c.token_enc IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'GitHub cache requires a current connection generation'); END;
--> statement-breakpoint
CREATE TRIGGER github_activity_update_guard BEFORE UPDATE ON github_activity
WHEN NEW.private_counts IS NOT NULL OR NOT EXISTS (
 SELECT 1 FROM github_connection c WHERE c.portfolio_id=NEW.portfolio_id AND c.generation=NEW.generation
 AND (NEW.authorized_calendar IS NULL OR (c.private_enabled=1 AND c.status='ok' AND c.token_enc IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'GitHub cache requires a current connection generation'); END;
