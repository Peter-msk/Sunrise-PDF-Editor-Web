ALTER TABLE analytics_daily ADD COLUMN returning_visits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_sessions ADD COLUMN active_seconds INTEGER NOT NULL DEFAULT 0;
