-- Compare-and-swap revision protects notes/publications edited in multiple tabs.
ALTER TABLE inquiries ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE site_announcements ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE site_releases ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);
