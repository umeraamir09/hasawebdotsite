CREATE TABLE IF NOT EXISTS runtime_probe (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO runtime_probe (key, value) VALUES ('seed', 'local fixture');
