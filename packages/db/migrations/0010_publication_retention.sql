CREATE TABLE `publication_candidate_index` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `publication_candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publication_candidate_index_json" CHECK(json_valid("publication_candidate_index"."value"))
);
--> statement-breakpoint
ALTER TABLE `publication_candidate` ADD `cleaned_at` integer;--> statement-breakpoint
CREATE INDEX `publication_candidate_owner_idx` ON `publication_candidate` (`portfolio_id`);