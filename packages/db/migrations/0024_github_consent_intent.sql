-- A switch attempt may replace the graph account. Repair stays bound to it.
-- Existing rows are repairs. SQLite accepts a CHECK on a new column.
ALTER TABLE `github_consent` ADD `intent` text DEFAULT 'repair' NOT NULL CHECK(`intent` in ('repair','switch'));
