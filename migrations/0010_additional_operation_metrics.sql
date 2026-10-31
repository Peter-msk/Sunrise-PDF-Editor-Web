-- Feature codes are strictly whitelisted by the API. Keep storage extensible.
DROP TRIGGER IF EXISTS cleanup_operation_metrics;
CREATE TABLE analytics_operations_updated (
 day TEXT NOT NULL,
 session_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 feature TEXT NOT NULL CHECK(length(feature) BETWEEN 1 AND 40),
 state TEXT NOT NULL CHECK(state IN ('started','succeeded','failed','cancelled')),
 PRIMARY KEY(session_id,operation_id)
);
INSERT INTO analytics_operations_updated SELECT day,session_id,operation_id,feature,state FROM analytics_operations;
DROP TABLE analytics_operations;
ALTER TABLE analytics_operations_updated RENAME TO analytics_operations;
CREATE INDEX analytics_operations_day_session ON analytics_operations(day,session_id);
CREATE TRIGGER cleanup_operation_metrics AFTER DELETE ON analytics_sessions
BEGIN
 DELETE FROM analytics_operations WHERE day=OLD.day AND session_id=OLD.session_id;
END;
