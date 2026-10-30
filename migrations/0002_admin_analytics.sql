-- Anonymous, session-based metrics. No IP, PDF content, filenames, or search terms.
CREATE TABLE IF NOT EXISTS analytics_daily (
 day TEXT PRIMARY KEY,
 visits INTEGER NOT NULL DEFAULT 0,
 editor_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS analytics_sessions (
 day TEXT NOT NULL,
 session_id TEXT NOT NULL,
 last_pulse_ms INTEGER NOT NULL,
 last_error_ms INTEGER NOT NULL DEFAULT 0,
 error_events INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (day, session_id)
);
CREATE INDEX IF NOT EXISTS analytics_sessions_day_idx ON analytics_sessions(day);
CREATE TABLE IF NOT EXISTS analytics_errors (
 day TEXT NOT NULL,
 feature TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (day,feature)
);
ALTER TABLE inquiries ADD COLUMN admin_note TEXT NOT NULL DEFAULT '';
ALTER TABLE inquiries ADD COLUMN updated_at TEXT;
CREATE TABLE IF NOT EXISTS inquiry_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 inquiry_id INTEGER NOT NULL,
 changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 actor TEXT NOT NULL,
 old_status TEXT NOT NULL,
 new_status TEXT NOT NULL
);
