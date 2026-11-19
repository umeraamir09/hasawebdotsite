ALTER TABLE `contact_outbox` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `contact_outbox` ADD `notice` text;--> statement-breakpoint
ALTER TABLE `contact_outbox` ADD `notice_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `contact_outbox` ADD `notice_next_at` integer;--> statement-breakpoint
ALTER TABLE `contact_outbox` ADD `notice_reserved_at` integer;--> statement-breakpoint
CREATE INDEX `outbox_notice_idx` ON `contact_outbox` (`notice`,`notice_next_at`);