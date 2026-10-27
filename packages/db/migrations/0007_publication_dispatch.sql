CREATE TABLE `publication_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`source` text,
	`status` text NOT NULL,
	`cursor` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`output_count` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`deadline_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "publication_candidate_status" CHECK("publication_candidate"."status" in ('preparing','assembling','transferring','ready','failed','cleaning','cleaned')),
	CONSTRAINT "publication_candidate_source" CHECK("publication_candidate"."source" is null or json_valid("publication_candidate"."source")),
	CONSTRAINT "publication_candidate_cursor" CHECK(json_valid("publication_candidate"."cursor") and length("publication_candidate"."cursor")<=32768)
);
--> statement-breakpoint
CREATE INDEX `publication_candidate_due_idx` ON `publication_candidate` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `publication_transfer` (
	`candidate_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`purpose` text NOT NULL,
	`bytes` integer NOT NULL,
	`content_type` text NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`candidate_id`, `asset_id`, `purpose`),
	FOREIGN KEY (`candidate_id`) REFERENCES `publication_candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
