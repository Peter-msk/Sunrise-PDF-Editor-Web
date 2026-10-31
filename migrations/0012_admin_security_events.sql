CREATE TABLE IF NOT EXISTS admin_security_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('login_failed','login_succeeded','password_changed','sessions_revoked')),
 happened_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_security_events_recent ON admin_security_events(happened_ms DESC);
