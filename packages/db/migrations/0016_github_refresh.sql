CREATE TABLE `github_published_activity` (
	`portfolio_id` text PRIMARY KEY NOT NULL,
	`github_user_id` text NOT NULL,
	`login` text NOT NULL,
	`public_calendar` text,
	`public_error` text,
	`checked_at` integer,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "github_published_activity_json" CHECK("github_published_activity"."public_calendar" is null or json_valid("github_published_activity"."public_calendar"))
);
--> statement-breakpoint
CREATE TABLE `github_refresh` (
	`portfolio_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade
);
