-- Initial schema: public notices and releases; private user inquiries.
-- To inspect submissions: Cloudflare Dashboard > D1 > sunrise-pdf-editor-web-contact > Console.
CREATE TABLE IF NOT EXISTS site_announcements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL, body TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
 published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
 is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS site_announce_active_idx ON site_announcements(is_active,sort_order);
CREATE TABLE IF NOT EXISTS site_releases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL UNIQUE,
 released_at TEXT NOT NULL, added TEXT NOT NULL DEFAULT '',
 improved TEXT NOT NULL DEFAULT '', removed TEXT NOT NULL DEFAULT '',
 is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS site_releases_active_idx ON site_releases(is_active,sort_order);
CREATE TABLE IF NOT EXISTS inquiries (
 id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL,
 email TEXT NOT NULL, message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS inquiries_created_idx ON inquiries(created_at DESC);
CREATE TABLE IF NOT EXISTS inquiry_rate_limits (
 key TEXT PRIMARY KEY, last_sent_ms INTEGER NOT NULL, daily_count INTEGER NOT NULL, day TEXT NOT NULL
);
-- Initial public notice and release data; never include private user content.
INSERT OR IGNORE INTO site_announcements (id,title,body,level,published_at,sort_order)
 VALUES (1,'이용 전 안내','PDF 편집 파일은 브라우저에서 처리하며, 문의하기에는 PDF 원본을 첨부하지 않습니다.','info','2026-10-30',20);
INSERT OR IGNORE INTO site_announcements (id,title,body,level,published_at,sort_order)
 VALUES (2,'이미지 압축 사용 시 주의','고효율 압축은 스캔 글자와 도면의 선명도에 영향을 줄 수 있습니다. 저장 후 결과 PDF를 확인하세요.','warning','2026-10-30',10);
INSERT OR IGNORE INTO site_releases (version,released_at,added,improved,removed,sort_order)
 VALUES ('2026-10-30 · 압축 엔진','2026-10-30','이미지 JPEG 재인코딩, 고·중·저효율 프리셋, 압축 강도/품질/해상도 직접 설정','압축 전후 실제 용량 비교, 원본 유지 및 지원하지 않는 이미지 보호','삭제된 기능 없음',10);
INSERT OR IGNORE INTO site_releases (version,released_at,added,improved,removed,sort_order)
 VALUES ('2026-10-30 · 웹 화면','2026-10-30','메인 화면 공지사항·업데이트 고정 패널, 문의하기 접수 창구','대표 기능 설명에 이미지 압축 및 북마크 기능 반영','삭제된 기능 없음',20);
