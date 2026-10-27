CREATE TABLE `publication_commit` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`version` integer NOT NULL,
	`address` text NOT NULL,
	`committed_at` integer NOT NULL,
	`applied` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publication_commit_applied" CHECK("publication_commit"."applied" = 1),
	CONSTRAINT "publication_commit_version" CHECK("publication_commit"."version" > 0)
);
