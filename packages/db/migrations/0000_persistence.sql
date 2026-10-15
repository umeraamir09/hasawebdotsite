CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_identity` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_kind" CHECK("asset"."kind" in ('avatar','banner','face','project','case_study','resume','og')),
	CONSTRAINT "asset_status" CHECK("asset"."status" in ('pending','ready','failed')),
	CONSTRAINT "asset_dimensions" CHECK("asset"."bytes" >= 0 and ("asset"."width" is null or "asset"."width" > 0) and ("asset"."height" is null or "asset"."height" > 0))
);
--> statement-breakpoint
CREATE INDEX `asset_portfolio_idx` ON `asset` (`portfolio_id`);--> statement-breakpoint
CREATE TABLE `contact_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`is_test` integer DEFAULT false NOT NULL,
	`accepted_at` integer NOT NULL,
	`deadline_at` integer NOT NULL,
	`budget_window_start` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outbox_status" CHECK("contact_outbox"."status" in ('queued','sending','sent','failed')),
	CONSTRAINT "outbox_attempts" CHECK("contact_outbox"."attempts" between 0 and 5),
	CONSTRAINT "outbox_deadline" CHECK("contact_outbox"."deadline_at" >= "contact_outbox"."accepted_at"),
	CONSTRAINT "outbox_payload" CHECK(("contact_outbox"."payload" is null or json_valid("contact_outbox"."payload")) and ("contact_outbox"."status" not in ('sent','failed') or "contact_outbox"."payload" is null))
);
--> statement-breakpoint
CREATE INDEX `outbox_portfolio_idx` ON `contact_outbox` (`portfolio_id`);--> statement-breakpoint
CREATE INDEX `outbox_due_idx` ON `contact_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `contact_recipient` (
	`portfolio_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`verified_at` integer,
	`pending_token_hash` text,
	`token_expires_at` integer,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `counter` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`),
	CONSTRAINT "counter_count" CHECK("counter"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `github_activity` (
	`portfolio_id` text PRIMARY KEY NOT NULL,
	`public_days` text NOT NULL,
	`private_counts` text,
	`fetched_at` integer,
	`last_error` text,
	`refresh_requested_at` integer,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "github_activity_json" CHECK(json_valid("github_activity"."public_days") and ("github_activity"."private_counts" is null or json_valid("github_activity"."private_counts")))
);
--> statement-breakpoint
CREATE TABLE `github_connection` (
	`portfolio_id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`github_user_id` text NOT NULL,
	`token_enc` text,
	`scopes` text DEFAULT '' NOT NULL,
	`private_enabled` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`last_checked_at` integer,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "github_status" CHECK("github_connection"."status" in ('ok','needs_reconnect','disconnected'))
);
--> statement-breakpoint
CREATE TABLE `operator_email_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`account_id` text NOT NULL,
	`case_reference` text NOT NULL,
	`accessed_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_account_idx` ON `operator_email_audit` (`account_id`);--> statement-breakpoint
CREATE INDEX `audit_retention_idx` ON `operator_email_audit` (`accessed_at`);--> statement-breakpoint
CREATE TABLE `portfolio` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subdomain` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_version` integer,
	`draft` text NOT NULL,
	`draft_rev` integer DEFAULT 0 NOT NULL,
	`suspended_at` integer,
	`suspended_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "portfolio_status" CHECK("portfolio"."status" in ('draft','published','unpublished','suspended','deleting')),
	CONSTRAINT "draft_json" CHECK(json_valid("portfolio"."draft") and json_type("portfolio"."draft") = 'object'),
	CONSTRAINT "draft_bytes" CHECK(length(cast("portfolio"."draft" as blob)) <= 1048576),
	CONSTRAINT "draft_revision" CHECK("portfolio"."draft_rev" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_user_id_unique` ON `portfolio` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_subdomain_unique` ON `portfolio` (`subdomain`);--> statement-breakpoint
CREATE TABLE `publish_version` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`n` integer NOT NULL,
	`status` text DEFAULT 'rendering' NOT NULL,
	`renderer_version` text NOT NULL,
	`manifest` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publish_number" CHECK("publish_version"."n" > 0),
	CONSTRAINT "publish_status" CHECK("publish_version"."status" in ('rendering','live','failed','superseded')),
	CONSTRAINT "manifest_json" CHECK("publish_version"."manifest" is null or json_valid("publish_version"."manifest"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publish_portfolio_number` ON `publish_version` (`portfolio_id`,`n`);--> statement-breakpoint
CREATE TABLE `reserved_subdomain` (
	`name` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `subdomain_claim` (
	`name` text PRIMARY KEY NOT NULL,
	`portfolio_id` text,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subdomain_claim_portfolio_id_unique` ON `subdomain_claim` (`portfolio_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`deleting_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);