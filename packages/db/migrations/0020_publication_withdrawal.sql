CREATE TABLE `publication_withdrawal` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`address` text NOT NULL,
	`version` integer NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publication_withdrawal_version" CHECK("publication_withdrawal"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `publication_withdrawal_portfolio` ON `publication_withdrawal` (`portfolio_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `publication_withdrawal_due` ON `publication_withdrawal` (`completed_at`,`next_attempt_at`);