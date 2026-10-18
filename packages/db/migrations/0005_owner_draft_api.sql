ALTER TABLE `owner_save_attempt` ADD `context` text DEFAULT 'setup' NOT NULL;--> statement-breakpoint
ALTER TABLE `owner_save_attempt` ADD `validation_cursor` text;--> statement-breakpoint
ALTER TABLE `owner_save_attempt` ADD `validation_complete` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `owner_save_attempt` ADD `validation_issue` text;