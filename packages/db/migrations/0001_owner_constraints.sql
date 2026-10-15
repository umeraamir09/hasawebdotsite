-- Platform names remain reserved independently of permanent published claims.
INSERT INTO reserved_subdomain (name) VALUES
  ('www'), ('app'), ('api'), ('assets'), ('mail'), ('admin'), ('status'),
  ('docs'), ('blog'), ('help'), ('support'), ('static'), ('cdn'), ('example'), ('demo');
--> statement-breakpoint
CREATE TRIGGER claim_reserved BEFORE INSERT ON subdomain_claim
WHEN EXISTS (SELECT 1 FROM reserved_subdomain WHERE name = NEW.name)
BEGIN SELECT RAISE(ABORT, 'reserved_subdomain'); END;
--> statement-breakpoint
CREATE TRIGGER claim_name BEFORE INSERT ON subdomain_claim
WHEN length(NEW.name) NOT BETWEEN 3 AND 30
  OR NEW.name GLOB '*[^a-z0-9-]*'
  OR substr(NEW.name, 1, 1) = '-' OR substr(NEW.name, -1) = '-'
BEGIN SELECT RAISE(ABORT, 'invalid_subdomain'); END;
--> statement-breakpoint
CREATE TRIGGER claim_no_transfer BEFORE UPDATE ON subdomain_claim
WHEN NEW.name != OLD.name
  OR (NEW.portfolio_id IS NOT NULL AND NEW.portfolio_id IS NOT OLD.portfolio_id)
BEGIN SELECT RAISE(ABORT, 'permanent_subdomain_claim'); END;
--> statement-breakpoint
CREATE TRIGGER claim_no_delete BEFORE DELETE ON subdomain_claim
BEGIN SELECT RAISE(ABORT, 'permanent_subdomain_claim'); END;
