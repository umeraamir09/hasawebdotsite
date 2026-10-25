ALTER TABLE `publication_candidate` ADD `renderer_version` text DEFAULT 's8-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication_candidate` ADD `task_batch` integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE `publication_candidate` ADD `asset_origin` text DEFAULT 'https://s8-assets.invalid' NOT NULL;