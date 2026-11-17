CREATE TABLE `email_dispatch` (
	`attempt` text PRIMARY KEY NOT NULL,
	`reservation` text NOT NULL,
	`notice` integer NOT NULL,
	`day` text NOT NULL,
	`month` text NOT NULL,
	FOREIGN KEY (`reservation`) REFERENCES `email_reservation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `email_dispatch_day_idx` ON `email_dispatch` (`day`,`notice`);--> statement-breakpoint
CREATE INDEX `email_dispatch_month_idx` ON `email_dispatch` (`month`);--> statement-breakpoint
CREATE TABLE `email_reservation` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`kind` text NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`day` text NOT NULL,
	CONSTRAINT "email_reservation_kind" CHECK("email_reservation"."kind" in ('contact','verification','failure-notice')),
	CONSTRAINT "email_reservation_test" CHECK("email_reservation"."is_test" in (0,1) and ("email_reservation"."kind" = 'contact' or "email_reservation"."is_test" = 0))
);
--> statement-breakpoint
CREATE INDEX `email_reservation_day_idx` ON `email_reservation` (`day`,`kind`,`portfolio_id`);--> statement-breakpoint
-- Acceptance allowances per UTC day: 90 contact messages in total (ten per
-- portfolio, at most two of them tests), and ten owner notices in total
-- (verification and final-failure notices share them; three verifications per
-- portfolio). A replayed reservation ID is a no-op, never a second charge.
CREATE TRIGGER `email_reservation_allowance` BEFORE INSERT ON `email_reservation`
WHEN NOT EXISTS (SELECT 1 FROM `email_reservation` WHERE `id` = NEW.`id`)
BEGIN
  SELECT CASE WHEN NEW.`kind` = 'contact' AND (
    (SELECT COUNT(*) FROM `email_reservation` WHERE `day` = NEW.`day` AND `kind` = 'contact') >= 90 OR
    (SELECT COUNT(*) FROM `email_reservation` WHERE `day` = NEW.`day` AND `kind` = 'contact' AND `portfolio_id` = NEW.`portfolio_id`) >= 10 OR
    (NEW.`is_test` = 1 AND (SELECT COUNT(*) FROM `email_reservation` WHERE `day` = NEW.`day` AND `kind` = 'contact' AND `portfolio_id` = NEW.`portfolio_id` AND `is_test` = 1) >= 2)
  ) THEN RAISE(ABORT, 'contact_allowance') END;
  SELECT CASE WHEN NEW.`kind` = 'verification' AND
    (SELECT COUNT(*) FROM `email_reservation` WHERE `day` = NEW.`day` AND `kind` = 'verification' AND `portfolio_id` = NEW.`portfolio_id`) >= 3
    THEN RAISE(ABORT, 'verification_allowance') END;
  SELECT CASE WHEN NEW.`kind` != 'contact' AND
    (SELECT COUNT(*) FROM `email_reservation` WHERE `day` = NEW.`day` AND `kind` != 'contact') >= 10
    THEN RAISE(ABORT, 'notice_allowance') END;
END;
--> statement-breakpoint
-- Provider attempts per UTC dispatch day stay inside Resend's free tier: 100
-- a day (90 contact, 10 notices) and 3,000 a month. Retries are charged when
-- they are attempted, so cross-midnight retries count against the new day.
CREATE TRIGGER `email_dispatch_allowance` BEFORE INSERT ON `email_dispatch`
WHEN NOT EXISTS (SELECT 1 FROM `email_dispatch` WHERE `attempt` = NEW.`attempt`)
BEGIN
  SELECT CASE WHEN NEW.`notice` != (SELECT `kind` != 'contact' FROM `email_reservation` WHERE `id` = NEW.`reservation`)
    THEN RAISE(ABORT, 'dispatch_kind') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM `email_dispatch` WHERE `day` = NEW.`day` AND `notice` = NEW.`notice`) >= (CASE WHEN NEW.`notice` THEN 10 ELSE 90 END)
    THEN RAISE(ABORT, 'dispatch_daily_allowance') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM `email_dispatch` WHERE `month` = NEW.`month`) >= 3000
    THEN RAISE(ABORT, 'dispatch_monthly_allowance') END;
END;
