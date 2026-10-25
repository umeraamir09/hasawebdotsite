CREATE TABLE `publication_page` (
	`candidate_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`path` text NOT NULL,
	`parts` integer DEFAULT 0 NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`candidate_id`, `ordinal`),
	FOREIGN KEY (`candidate_id`) REFERENCES `publication_candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `publication_candidate` ADD `page_index` integer DEFAULT 0 NOT NULL;