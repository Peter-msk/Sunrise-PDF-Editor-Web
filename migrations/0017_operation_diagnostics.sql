-- Fixed codes/buckets only. No messages, stack traces, document data or filenames.
CREATE TABLE analytics_diagnostics (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 day TEXT NOT NULL, session_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 feature TEXT NOT NULL, code TEXT NOT NULL, phase TEXT NOT NULL,
 origin TEXT NOT NULL, size_bucket TEXT NOT NULL, page_bucket TEXT NOT NULL,
 browser TEXT NOT NULL, client_build TEXT NOT NULL, worker_version TEXT NOT NULL,
 received_ms INTEGER NOT NULL,
 UNIQUE(session_id,operation_id),
 FOREIGN KEY(session_id,operation_id) REFERENCES analytics_operations(session_id,operation_id) ON DELETE CASCADE
);
CREATE INDEX analytics_diagnostics_day ON analytics_diagnostics(day,received_ms);
