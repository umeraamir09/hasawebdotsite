CREATE TABLE `address_confirmation` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`applied` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolio`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "address_confirmation_applied" CHECK("address_confirmation"."applied" = 1)
);
--> statement-breakpoint
ALTER TABLE `subdomain_claim` ADD `state` text DEFAULT 'claimed' NOT NULL;
--> statement-breakpoint
ALTER TABLE `subdomain_claim` ADD `held_at` integer;
--> statement-breakpoint
ALTER TABLE `subdomain_claim` ADD `claimed_at` integer;
--> statement-breakpoint
DROP TRIGGER claim_no_delete;
--> statement-breakpoint
CREATE TRIGGER claim_no_delete BEFORE DELETE ON subdomain_claim
WHEN OLD.state='claimed'
BEGIN SELECT RAISE(ABORT, 'permanent_subdomain_claim'); END;
--> statement-breakpoint
CREATE TRIGGER claim_state BEFORE INSERT ON subdomain_claim
WHEN NEW.state NOT IN ('held','claimed') OR (NEW.state='held' AND (NEW.portfolio_id IS NULL OR NEW.held_at IS NULL OR NEW.held_at<=0 OR NEW.claimed_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'invalid_subdomain_state'); END;
--> statement-breakpoint
CREATE TRIGGER claim_state_update BEFORE UPDATE ON subdomain_claim
WHEN NEW.state NOT IN ('held','claimed') OR (NEW.state='held' AND (NEW.portfolio_id IS NULL OR NEW.held_at IS NULL OR NEW.held_at<=0 OR NEW.claimed_at IS NOT NULL))
  OR NEW.held_at IS NOT OLD.held_at
  OR (OLD.state='claimed' AND (NEW.state!='claimed' OR NEW.claimed_at IS NOT OLD.claimed_at))
  OR (OLD.state='held' AND NEW.state='claimed' AND (NEW.claimed_at IS NULL OR NEW.claimed_at<OLD.held_at))
BEGIN SELECT RAISE(ABORT, 'permanent_subdomain_claim'); END;
--> statement-breakpoint
CREATE TRIGGER portfolio_release_hold BEFORE DELETE ON portfolio
BEGIN DELETE FROM subdomain_claim WHERE portfolio_id=OLD.id AND state='held'; END;
--> statement-breakpoint
CREATE TRIGGER portfolio_address_mirror BEFORE UPDATE OF draft ON portfolio
WHEN json_extract(NEW.draft,'$.requestedSubdomain') IS NOT json_extract(OLD.draft,'$.requestedSubdomain')
  AND EXISTS(SELECT 1 FROM subdomain_claim c WHERE c.portfolio_id=OLD.id
    AND c.name IS NOT json_extract(NEW.draft,'$.requestedSubdomain'))
BEGIN SELECT RAISE(ABORT, 'address_locked'); END;
