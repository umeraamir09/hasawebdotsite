ALTER TABLE publication_candidate ADD facts text;
--> statement-breakpoint
ALTER TABLE publish_version ADD candidate_id text REFERENCES publication_candidate(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX publish_candidate_idx ON publish_version(candidate_id);
--> statement-breakpoint
CREATE TRIGGER publication_retained_cleanup BEFORE UPDATE OF status ON publication_candidate
WHEN NEW.status IN ('cleaning','cleaned','failed') AND EXISTS(SELECT 1 FROM publish_version WHERE candidate_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retained publication candidate'); END;
--> statement-breakpoint
CREATE TRIGGER publication_reference_ready BEFORE INSERT ON publish_version
WHEN NEW.candidate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publication_candidate c WHERE c.id=NEW.candidate_id AND c.portfolio_id=NEW.portfolio_id AND c.status='ready')
BEGIN SELECT RAISE(ABORT,'publication candidate is not ready'); END;
--> statement-breakpoint
CREATE TRIGGER publication_reference_immutable BEFORE UPDATE OF candidate_id ON publish_version
WHEN NEW.candidate_id IS NOT OLD.candidate_id
BEGIN SELECT RAISE(ABORT,'publication candidate reference is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER publication_reference_release AFTER INSERT ON publish_version
WHEN NEW.candidate_id IS NOT NULL
BEGIN UPDATE publication_candidate SET source=NULL,facts=NULL WHERE id=NEW.candidate_id; END;
