-- Anonymous save preparation events, retained with the 14-day tab session.
-- No document names, bytes, text, user identity, or error messages.
CREATE TABLE IF NOT EXISTS analytics_save_operations (
 day TEXT NOT NULL,
 session_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('started','ready','failed','cancelled')),
 PRIMARY KEY(session_id, operation_id)
);
CREATE INDEX IF NOT EXISTS analytics_save_operations_day_session ON analytics_save_operations(day,session_id);
CREATE TRIGGER IF NOT EXISTS cleanup_save_operations AFTER DELETE ON analytics_sessions
BEGIN
 DELETE FROM analytics_save_operations WHERE day=OLD.day AND session_id=OLD.session_id;
END;
