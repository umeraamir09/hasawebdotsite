-- Phase 42D: consent may also return to the setup guide. SQLite cannot alter
-- a CHECK, so the table is rebuilt. No table references github_consent; D1
-- runs migrations in a transaction, where only deferred checks apply.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_github_consent` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`session_id` text NOT NULL,
	`portfolio_id` text,
	`app_id` text NOT NULL,
	`github_user_id` text NOT NULL,
	`login` text NOT NULL,
	`operation_id` text NOT NULL,
	`generation` integer NOT NULL,
	`verifier` text NOT NULL,
	`return_to` text NOT NULL,
	`state` text NOT NULL,
	`outcome` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`exchange_started_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "github_consent_state" CHECK("__new_github_consent"."state" in ('issued','exchanging','finished','void')),
	CONSTRAINT "github_consent_return" CHECK("__new_github_consent"."return_to" in ('editor','setup')),
	CONSTRAINT "github_consent_verifier" CHECK(("__new_github_consent"."state" in ('issued','exchanging')) = (length("__new_github_consent"."verifier") = 43))
);
--> statement-breakpoint
INSERT INTO `__new_github_consent`("state_hash", "user_id", "session_id", "portfolio_id", "app_id", "github_user_id", "login", "operation_id", "generation", "verifier", "return_to", "state", "outcome", "created_at", "expires_at", "exchange_started_at") SELECT "state_hash", "user_id", "session_id", "portfolio_id", "app_id", "github_user_id", "login", "operation_id", "generation", "verifier", "return_to", "state", "outcome", "created_at", "expires_at", "exchange_started_at" FROM `github_consent`;--> statement-breakpoint
DROP TABLE `github_consent`;--> statement-breakpoint
ALTER TABLE `__new_github_consent` RENAME TO `github_consent`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE INDEX `github_consent_portfolio` ON `github_consent` (`portfolio_id`,`created_at`);