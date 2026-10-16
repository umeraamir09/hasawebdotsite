CREATE TABLE `owner_save_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`last_hash` text,
	`state` text DEFAULT 'open' NOT NULL,
	`draft` text,
	`progress` text NOT NULL,
	`expires_at` integer NOT NULL,
	`string_path` text,
	`string_minimum` integer,
	`piece_count` integer DEFAULT 0 NOT NULL,
	`string_chars` integer DEFAULT 0 NOT NULL,
	`string_bytes` integer DEFAULT 0 NOT NULL,
	`last_code_unit` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "save_attempt_state" CHECK("owner_save_attempt"."state" in ('open','string','committed','aborted')),
	CONSTRAINT "save_attempt_draft" CHECK("owner_save_attempt"."draft" is null or (json_valid("owner_save_attempt"."draft") and length(cast("owner_save_attempt"."draft" as blob)) <= 1048576)),
	CONSTRAINT "save_attempt_progress" CHECK(json_valid("owner_save_attempt"."progress"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_save_attempt_user_id_unique` ON `owner_save_attempt` (`user_id`);--> statement-breakpoint
CREATE INDEX `save_attempt_expiry` ON `owner_save_attempt` (`expires_at`);--> statement-breakpoint
CREATE TABLE `owner_save_piece` (
	`attempt_id` text NOT NULL,
	`n` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`attempt_id`, `n`),
	FOREIGN KEY (`attempt_id`) REFERENCES `owner_save_attempt`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "save_piece_data" CHECK(json_valid("owner_save_piece"."data") and json_type("owner_save_piece"."data") = 'text' and length(cast("owner_save_piece"."data" as blob)) <= 4096)
);
--> statement-breakpoint
ALTER TABLE portfolio ADD COLUMN draft_validation_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Add columns in place. Rebuilding portfolio would risk cascading child rows
-- and dropping permanent-claim triggers on existing databases.
ALTER TABLE portfolio ADD COLUMN setup_progress TEXT NOT NULL
 DEFAULT '{"schemaVersion":1,"step":"address"}' CHECK(json_valid(setup_progress));
--> statement-breakpoint
ALTER TABLE portfolio ADD COLUMN first_editor_entered_at INTEGER
 CHECK(first_editor_entered_at IS NULL OR first_editor_entered_at > 0);
--> statement-breakpoint
CREATE TRIGGER portfolio_setup_revision BEFORE UPDATE ON portfolio
WHEN (NEW.setup_progress IS NOT OLD.setup_progress
 OR NEW.first_editor_entered_at IS NOT OLD.first_editor_entered_at)
 AND NEW.draft_rev != OLD.draft_rev + 1
BEGIN
 SELECT RAISE(ABORT, 'setup changes require the next draft revision');
END;
--> statement-breakpoint
CREATE TRIGGER portfolio_editor_entry_permanent BEFORE UPDATE ON portfolio
WHEN OLD.first_editor_entered_at IS NOT NULL
 AND (NEW.first_editor_entered_at IS NOT OLD.first_editor_entered_at
 OR NEW.setup_progress IS NOT OLD.setup_progress)
BEGIN
 SELECT RAISE(ABORT, 'first editor entry is permanent and setup progress is frozen');
END;
