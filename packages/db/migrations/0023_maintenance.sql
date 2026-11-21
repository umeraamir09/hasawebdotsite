CREATE TABLE `maintenance_cursor` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asset_collection_idx` ON `asset` (`status`,`updated_at`);