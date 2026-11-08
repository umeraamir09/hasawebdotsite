CREATE TABLE `github_consent` (
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
	CONSTRAINT "github_consent_state" CHECK("github_consent"."state" in ('issued','exchanging','finished','void')),
	CONSTRAINT "github_consent_return" CHECK("github_consent"."return_to" in ('editor')),
	CONSTRAINT "github_consent_verifier" CHECK(("github_consent"."state" in ('issued','exchanging')) = (length("github_consent"."verifier") = 43))
);
--> statement-breakpoint
CREATE INDEX `github_consent_portfolio` ON `github_consent` (`portfolio_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `github_grant` ADD `provider_rejected` integer DEFAULT false NOT NULL;