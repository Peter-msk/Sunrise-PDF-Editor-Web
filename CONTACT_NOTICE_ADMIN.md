# Sunrise PDF Editor Web · Cloudflare 관리자 운영 안내

## 1. 고객 문의 확인 (비공개)
Cloudflare Dashboard → **Storage & databases → D1** → **sunrise-pdf-editor-web-contact** → **Console**에서 SQL을 실행한다.

```sql
SELECT id, created_at, category, email, message, status
FROM inquiries
ORDER BY created_at DESC LIMIT 100;
```

읽고 처리한 문의는 `UPDATE inquiries SET status='answered' WHERE id=123;`로 변경한다. 관리자 로그인 없이 문의를 조회하는 공개 API는 **없다**. 메일 자동 발송 기능은 없고, 고객이 남긴 이메일로 관리자가 직접 답변한다.

운영 DB 식별자: `efaab4d4-9d79-46dd-b037-461c4cd4c683`.

## 2. 공지사항 수정
공지는 공개 API `GET /api/site-updates`로 전달되며 메인 화면 좌측 고정 영역에 표시된다. SQL에서 활성 공지만 전달한다. `sort_order`가 높을수록 먼저 나온다.

```sql
INSERT INTO site_announcements(title, body, level, published_at, sort_order)
VALUES ('서비스 점검 안내', '점검 일정 및 내용을 입력하세요.', 'info', '2026-10-30', 30);
```

- 경고형 공지: `level='warning'`.
- 숨기기: `UPDATE site_announcements SET is_active=0 WHERE id=123;`
- 수정: `UPDATE site_announcements SET body='수정된 공지 내용' WHERE id=123;`

## 3. 업데이트 이력 관리
대표 기능 업데이트 시 반드시 **신규 기능 / 보완 기능 / 삭제 기능**을 구분해 기록한다. 삭제가 없으면 `삭제된 기능 없음`으로 명시한다. 실제 구현되지 않은 기능을 기재하지 않는다.

```sql
INSERT INTO site_releases(version, released_at, added, improved, removed, sort_order)
VALUES ('2026-11-01 · 문서 편집 개선', '2026-11-01',
 '새롭게 배포한 기능 이름', '개선한 기존 기능 이름', '삭제된 기능 없음', 100);
```

새로운 대표 기능은 `dist/index.html`의 `#features` 기능 설명 카드에도 추가한 뒤 테스트·배포한다.

## 4. 문의 개인정보 처리
- 문의하기 폼은 이메일·문의 내용·분류·접수 시각만 Cloudflare D1에 저장한다.
- 파일 업로드를 받지 않으며 PDF 원본이나 편집 내용은 문의 API에 전송하지 않는다.
- 이메일은 회신을 위해 사용하고, 90일이 지난 문의는 Worker의 매일 실행되는 예약 정리 작업으로 삭제한다.
- 관리자 Cloudflare 계정의 접근 권한·2단계 인증을 관리한다.
- 브라우저 출처 검사, 허니팟, 최소 입력 길이, 하루 8건/분당 1건 제한을 적용한다. 비정상적인 봇 트래픽이 늘면 Cloudflare Turnstile / WAF로 추가 보호한다.
- `INQUIRY_HASH_SALT`는 Workers 시크릿으로 설정하며 **소스코드·HTML·공개 API에 절대 포함하지 않는다**.
- 회신 메일 자동 발송 및 관리자 공개 대시보드는 현재 미구현이다.

## 5. 배포
GitHub `main`의 업데이트는 Cloudflare Workers Git 연동 빌드에서 `npm test && npm run build` 및 `npx wrangler deploy`를 수행한다. `wrangler.toml`의 D1 바인딩 `DB`, 정적 에셋 `ASSETS`, API 경로 우선 처리 설정을 유지한다. DB 초기 스키마는 `migrations/0001_inquiries_and_site_updates.sql`에 보관한다.
