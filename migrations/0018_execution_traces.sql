-- Trace v2: immutable, allowlisted diagnostics; no document text, filename, raw stack or URL.
-- Apply only after production private backup, isolated restore and schema gate approval.
ALTER TABLE analytics_diagnostics ADD COLUMN trace_schema_version INTEGER;
ALTER TABLE analytics_diagnostics ADD COLUMN trace_id TEXT;
ALTER TABLE analytics_diagnostics ADD COLUMN trace_json TEXT;
CREATE UNIQUE INDEX analytics_diagnostics_trace_id ON analytics_diagnostics(trace_id)
 WHERE trace_id IS NOT NULL;
CREATE INDEX analytics_diagnostics_trace_recent ON analytics_diagnostics(day,received_ms)
 WHERE trace_schema_version=2;
