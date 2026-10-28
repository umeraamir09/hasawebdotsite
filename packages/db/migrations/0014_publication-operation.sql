CREATE TABLE `publication_operation` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`expected_version` integer,
	`expected_status` text NOT NULL,
	`failed_code` text,
	`cleanup_cursor` text DEFAULT '' NOT NULL,
	`cleanup_attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publication_operation_status" CHECK("publication_operation"."expected_status" in ('draft','published','unpublished'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_operation_active` ON `publication_operation` (`portfolio_id`) WHERE "publication_operation"."completed_at" is null and "publication_operation"."failed_code" is null;--> statement-breakpoint
CREATE INDEX `publication_operation_due` ON `publication_operation` (`completed_at`,`next_attempt_at`);