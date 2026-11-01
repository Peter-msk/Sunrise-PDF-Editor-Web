-- Preserve collected rows while extending the allowed feature codes.
DROP TRIGGER IF EXISTS cleanup_operation_metrics;
CREATE TABLE analytics_operations_expanded (
 day TEXT NOT NULL,
 session_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 feature TEXT NOT NULL CHECK(feature IN ('open','merge','split','extract_text','search','bookmark_edit','bookmark_auto','page_duplicate','page_delete','page_rotate')),
 state TEXT NOT NULL CHECK(state IN ('started','succeeded','failed','cancelled')),
 PRIMARY KEY(session_id,operation_id)
);
INSERT INTO analytics_operations_expanded(day,session_id,operation_id,feature,state)
 SELECT day,session_id,operation_id,feature,state FROM analytics_operations;
DROP TABLE analytics_operations;
ALTER TABLE analytics_operations_expanded RENAME TO analytics_operations;
CREATE INDEX analytics_operations_day_session ON analytics_operations(day,session_id);
CREATE TRIGGER cleanup_operation_metrics AFTER DELETE ON analytics_sessions
BEGIN
 DELETE FROM analytics_operations WHERE day=OLD.day AND session_id=OLD.session_id;
END;
