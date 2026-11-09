-- Trace v2 DEV3: administrator-only incident workflows, independent of 14-day telemetry.
-- Production D1 requires a private backup, isolated restore and explicit release authorization.
CREATE TABLE IF NOT EXISTS admin_trace_incidents (
 fingerprint TEXT PRIMARY KEY CHECK(length(fingerprint)=8),
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','investigating','fix_candidate','verifying','resolved','reopened')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=400),
 fix_commit TEXT,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_ms INTEGER NOT NULL CHECK(created_ms>0),
 updated_ms INTEGER NOT NULL CHECK(updated_ms>0),
 resolved_ms INTEGER,
 CHECK(fix_commit IS NULL OR length(fix_commit)=40)
);
CREATE TABLE IF NOT EXISTS admin_trace_incident_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 fingerprint TEXT NOT NULL REFERENCES admin_trace_incidents(fingerprint) ON DELETE CASCADE,
 status TEXT NOT NULL,
 note TEXT NOT NULL,
 fix_commit TEXT,
 happened_ms INTEGER NOT NULL,
 revision INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_trace_incidents_updated ON admin_trace_incidents(updated_ms DESC);
CREATE INDEX IF NOT EXISTS admin_trace_incident_audit_lookup ON admin_trace_incident_audit(fingerprint,id DESC);
