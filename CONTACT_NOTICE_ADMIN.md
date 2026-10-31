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
공지는 공개 API `GET /api/site-updates`로 전달되며 메인 화면에 표시된다. 최초 게시일을 포함해 한국시간 기준 7일 동안만 표시하며, 8일째 00:00부터 숨긴다. 예를 들어 10월 31일 최초 게시 시 11월 6일까지 표시하고 11월 7일부터 숨긴다. 숨겨진 기록은 삭제하지 않는다. `sort_order`가 높을수록 먼저 나온다.

기존 게시물은 과거 최초 게시 시각이 별도로 기록되지 않아 기존 `published_at`/`released_at`을 최초 게시일로 사용한다. 새 항목은 처음 활성화되는 날을 기록하고, 수정하거나 비활성화 후 다시 활성화해도 최초 게시일을 바꾸지 않는다. 게시일이 미래로 지정된 항목은 그 날짜부터 게시된다.

운영 D1에는 2026-10-31에 `migrations/0004_publication_lifetime.sql`을 SQL 직접 실행으로 적용했다. 기존 공지 2건·업데이트 4건과 트리거 6개를 확인했다. Wrangler 마이그레이션 이력에 자동 기록된 것은 아니므로 재실행 전 스키마와 이력을 확인한다. 빈 신규 환경에만 0004를 한 번 적용한다. 데이터 삭제 쿼리는 포함하지 않는다.

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
배포 전 연결과 실제 배포 이력을 확인하고 `npm test && npm run build` 및 `npx wrangler deploy`를 수행한다. 2026-10-31 조회에서 Workers Git 빌드 트리거는 확인되지 않아 main 병합만으로 운영 반영된다고 가정하지 않는다. `wrangler.toml`의 D1 바인딩 `DB`, 정적 에셋 `ASSETS`, API 경로 우선 처리 설정을 유지한다. DB 초기 스키마는 `migrations/0001_inquiries_and_site_updates.sql`에 보관한다.
