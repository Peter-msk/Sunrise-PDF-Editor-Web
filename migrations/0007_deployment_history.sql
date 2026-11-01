-- Signed deployment pipeline reports. No credentials or user content.
CREATE TABLE IF NOT EXISTS operation_deployments (
 run_id TEXT NOT NULL,
 run_attempt INTEGER NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN ('production','staging')),
 status TEXT NOT NULL CHECK(status IN ('succeeded','failed','rolled_back')),
 commit_sha TEXT NOT NULL,
 worker_version TEXT,
 reported_ms INTEGER NOT NULL,
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(run_id,run_attempt,environment)
);
CREATE INDEX IF NOT EXISTS operation_deployments_recent ON operation_deployments(reported_ms DESC);
