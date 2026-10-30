-- Password-only administrator authentication; one account only.
-- Password verifier uses PBKDF2-HMAC-SHA256 with unique random salt (600000 iterations).
CREATE TABLE IF NOT EXISTS admin_accounts (
 id INTEGER PRIMARY KEY CHECK(id=1),
 username TEXT NOT NULL UNIQUE,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 iterations INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY,
 admin_id INTEGER NOT NULL DEFAULT 1,
 created_ms INTEGER NOT NULL,
 last_seen_ms INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL,
 FOREIGN KEY(admin_id) REFERENCES admin_accounts(id)
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_ms);
CREATE TABLE IF NOT EXISTS admin_login_limits (
 key TEXT PRIMARY KEY,
 window_start_ms INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 blocked_until_ms INTEGER NOT NULL DEFAULT 0
);
