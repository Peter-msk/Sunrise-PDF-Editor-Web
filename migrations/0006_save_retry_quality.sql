-- Link only to an anonymous failed preparation in the same browser session.
ALTER TABLE analytics_save_operations ADD COLUMN retry_of TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS analytics_save_retry_once
 ON analytics_save_operations(session_id,retry_of) WHERE retry_of IS NOT NULL;
