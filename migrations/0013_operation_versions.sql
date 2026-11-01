-- Server-derived receiving Worker version. Historical records remain unknown.
ALTER TABLE analytics_operations ADD COLUMN worker_version TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE analytics_save_operations ADD COLUMN worker_version TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX analytics_operations_version_day ON analytics_operations(worker_version,day);
CREATE INDEX analytics_save_operations_version_day ON analytics_save_operations(worker_version,day);
