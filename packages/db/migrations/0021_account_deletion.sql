CREATE TABLE `account_deletion` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`portfolio_id` text,
	`address` text,
	`stage` text DEFAULT 'public' NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "account_deletion_stage" CHECK("account_deletion"."stage" in ('public','purge','verify','candidates','draft','rows','final'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_user` ON `account_deletion` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_deletion_due` ON `account_deletion` (`next_attempt_at`);
