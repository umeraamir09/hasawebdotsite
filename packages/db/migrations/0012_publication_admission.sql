CREATE TABLE `publication_candidate_pending` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `publication_candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO publication_candidate_pending(candidate_id)
SELECT c.id FROM publication_candidate c
WHERE NOT EXISTS(SELECT 1 FROM publish_version v WHERE v.candidate_id=c.id);
--> statement-breakpoint
CREATE TRIGGER publication_admission_acquire AFTER INSERT ON publication_candidate
BEGIN INSERT INTO publication_candidate_pending(candidate_id) VALUES(NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER publication_admission_release AFTER INSERT ON publish_version
WHEN NEW.candidate_id IS NOT NULL
BEGIN DELETE FROM publication_candidate_pending WHERE candidate_id=NEW.candidate_id; END;
--> statement-breakpoint
CREATE TRIGGER publication_admission_reacquire AFTER DELETE ON publish_version
WHEN OLD.candidate_id IS NOT NULL
BEGIN
  INSERT INTO publication_candidate_pending(candidate_id)
  SELECT id FROM publication_candidate WHERE id=OLD.candidate_id
  ON CONFLICT(candidate_id) DO NOTHING;
END;
