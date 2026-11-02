-- Sunrise R05. Apply ONLY after explicit operator approval; never automatically.
-- The restore is limited to publications; no inquiries, sessions or analytics.
CREATE TABLE IF NOT EXISTS admin_publication_restore_runs (
 operation_id TEXT PRIMARY KEY,
 actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 100),
 backup_sha256 TEXT NOT NULL CHECK(length(backup_sha256)=64),
 started_ms INTEGER NOT NULL CHECK(started_ms>0),
 insert_count INTEGER NOT NULL CHECK(insert_count>=0),
 update_count INTEGER NOT NULL CHECK(update_count>=0)
);
CREATE TABLE IF NOT EXISTS admin_publication_restore_steps (
 operation_id TEXT NOT NULL,
 table_name TEXT NOT NULL CHECK(table_name IN ('announcements','releases')),
 row_id INTEGER NOT NULL CHECK(row_id>0),
 action TEXT NOT NULL CHECK(action IN ('insert','update')),
 changed INTEGER NOT NULL CHECK(changed=1),
 PRIMARY KEY(operation_id,table_name,row_id),
 FOREIGN KEY(operation_id) REFERENCES admin_publication_restore_runs(operation_id)
);
CREATE INDEX IF NOT EXISTS admin_publication_restore_recent ON admin_publication_restore_runs(started_ms DESC);
