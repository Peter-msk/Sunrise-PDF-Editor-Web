CREATE TABLE IF NOT EXISTS analytics_operations (
 day TEXT NOT NULL,
 session_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 feature TEXT NOT NULL CHECK(feature IN ('open','merge','split','extract_text')),
 state TEXT NOT NULL CHECK(state IN ('started','succeeded','failed','cancelled')),
 PRIMARY KEY(session_id,operation_id)
);
CREATE INDEX IF NOT EXISTS analytics_operations_day_session ON analytics_operations(day,session_id);
CREATE TRIGGER IF NOT EXISTS cleanup_operation_metrics AFTER DELETE ON analytics_sessions
BEGIN
 DELETE FROM analytics_operations WHERE day=OLD.day AND session_id=OLD.session_id;
END;
