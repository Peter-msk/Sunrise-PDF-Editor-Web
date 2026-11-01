-- Only the latest retention attempt and last confirmed success; no personal data.
CREATE TABLE admin_maintenance_status (
 id INTEGER PRIMARY KEY CHECK(id=1),
 run_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed')),
 started_ms INTEGER NOT NULL,
 finished_ms INTEGER,
 last_success_ms INTEGER,
 failed_step TEXT CHECK(failed_step IS NULL OR failed_step IN ('private_data','deployment_reports','security_events','status_record'))
);
