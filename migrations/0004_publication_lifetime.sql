-- Backfill legacy entries from their existing publication dates. New drafts
-- acquire a first-publication date only on their first activation, in KST.
ALTER TABLE site_announcements ADD COLUMN first_published_at TEXT;
ALTER TABLE site_releases ADD COLUMN first_published_at TEXT;

UPDATE site_announcements SET first_published_at=date(published_at);
UPDATE site_releases SET first_published_at=date(released_at);

CREATE TRIGGER site_announcements_first_publish_insert
AFTER INSERT ON site_announcements
WHEN NEW.is_active=1 AND NEW.first_published_at IS NULL
BEGIN
  UPDATE site_announcements SET first_published_at=
    CASE WHEN date(NEW.published_at)>date('now','+9 hours')
      THEN date(NEW.published_at) ELSE date('now','+9 hours') END
  WHERE id=NEW.id;
END;

CREATE TRIGGER site_announcements_first_publish_activate
AFTER UPDATE OF is_active ON site_announcements
WHEN NEW.is_active=1 AND OLD.is_active<>1 AND OLD.first_published_at IS NULL
BEGIN
  UPDATE site_announcements SET first_published_at=
    CASE WHEN date(NEW.published_at)>date('now','+9 hours')
      THEN date(NEW.published_at) ELSE date('now','+9 hours') END
  WHERE id=NEW.id;
END;

CREATE TRIGGER site_announcements_first_publish_immutable
BEFORE UPDATE OF first_published_at ON site_announcements
WHEN OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS NOT OLD.first_published_at
BEGIN
  SELECT RAISE(ABORT,'first publication date is immutable');
END;

CREATE TRIGGER site_releases_first_publish_insert
AFTER INSERT ON site_releases
WHEN NEW.is_active=1 AND NEW.first_published_at IS NULL
BEGIN
  UPDATE site_releases SET first_published_at=
    CASE WHEN date(NEW.released_at)>date('now','+9 hours')
      THEN date(NEW.released_at) ELSE date('now','+9 hours') END
  WHERE id=NEW.id;
END;

CREATE TRIGGER site_releases_first_publish_activate
AFTER UPDATE OF is_active ON site_releases
WHEN NEW.is_active=1 AND OLD.is_active<>1 AND OLD.first_published_at IS NULL
BEGIN
  UPDATE site_releases SET first_published_at=
    CASE WHEN date(NEW.released_at)>date('now','+9 hours')
      THEN date(NEW.released_at) ELSE date('now','+9 hours') END
  WHERE id=NEW.id;
END;

CREATE TRIGGER site_releases_first_publish_immutable
BEFORE UPDATE OF first_published_at ON site_releases
WHEN OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS NOT OLD.first_published_at
BEGIN
  SELECT RAISE(ABORT,'first publication date is immutable');
END;
