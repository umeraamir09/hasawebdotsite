-- Runtime follow-up storage. Integrate with the approved progress schema before
-- adding this to product migrations in Phase 11B/13.
CREATE TABLE IF NOT EXISTS owner_save_attempt (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL,
 base_revision INTEGER NOT NULL,
 sequence INTEGER NOT NULL DEFAULT 0,
 last_hash TEXT,
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','string','committed','aborted')),
 draft TEXT CHECK(draft IS NULL OR json_valid(draft)),
 progress TEXT NOT NULL CHECK(json_valid(progress)),
 expires_at INTEGER NOT NULL,
 string_path TEXT,
 string_minimum INTEGER,
 piece_count INTEGER NOT NULL DEFAULT 0,
 string_chars INTEGER NOT NULL DEFAULT 0,
 string_bytes INTEGER NOT NULL DEFAULT 0,
 last_code_unit INTEGER,
 CHECK(draft IS NULL OR length(CAST(draft AS BLOB)) <= 1048576)
);
CREATE INDEX IF NOT EXISTS save_attempt_expiry ON owner_save_attempt(expires_at);
CREATE TABLE IF NOT EXISTS owner_save_piece (
 attempt_id TEXT NOT NULL REFERENCES owner_save_attempt(id) ON DELETE CASCADE,
 n INTEGER NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'text' AND length(CAST(data AS BLOB)) <= 4096),
 PRIMARY KEY(attempt_id,n)
);
