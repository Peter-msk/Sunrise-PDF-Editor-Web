# 관리자 인증 방식 변경

최신 관리자 로그인 및 최초 설정 절차는 [ADMIN_PASSWORD_LOGIN.md](ADMIN_PASSWORD_LOGIN.md) 참고. 기존 Access 관련 지침은 더 이상 운영 인증 방법이 아니다.

# Sunrise PDF Editor · 관리자 대시보드 운영 가이드

## 화면 / 인증
- 공개 홈: https://sunrise-pdf-editor.ko-pg.workers.dev/
- **관리자 기능 보류:** 메인 홈페이지에서 관리자 버튼을 의도적으로 숨김. `/admin/` 및 `/api/admin/*`는 Access 인증 없이 403을 반환하도록 기존 보호 코드를 유지함.
- 별도 관리자 사이트나 별도 도메인은 사용하지 않는다.
- **Cloudflare Zero Trust > Access > Applications**에서 *self-hosted application*을 구성해야 로그인 가능.
- 접근 보호 경로: `sunrise-pdf-editor.ko-pg.workers.dev/admin*` 및 `sunrise-pdf-editor.ko-pg.workers.dev/api/admin/*` (정확한 앱 경로 규칙을 Cloudflare UI에서 검증).
- 허용 사용자: 해당 Cloudflare 계정 소유자 이메일만 지정. 이메일 도메인 전체 허용 금지.
- Worker는 `ctx.access.getIdentity()`를 다시 확인하며, `ADMIN_EMAIL` 비밀 환경 변수의 허용 이메일과 같아야 데이터 응답.
- **Access 미설정 또는 인증 실패 시 /admin/과 /api/admin/* 모두 403**, 로그인 우회 없음. 공개 홈페이지에서는 관리자 진입 링크를 표시하지 않음.
- 기존 공개 PDF 편집과 문의 접수는 로그인 없이 유지.
- Cloudflare Access 보호를 **전체 Worker**에 걸면 일반 사용자의 PDF 편집까지 막힐 수 있으므로 경로별 보호만 적용.

## 통계 정의 (Asia/Seoul, KST)
- **일일·금주·누적 방문:** 브라우저 탭의 익명 세션 UUID 기준. 실제 고유 인원 수와 다름.
- **금주:** 월요일 00:00 KST ~ 현재.
- **프로그램 사용시간:** 편집기 탭이 화면에 보이고 포커스를 가진 동안의 15초 간격 측정치; 추정치이며 유휴 시간은 일부 포함 가능.
- **기능별 오류:** 편집기 JavaScript 오류 / 미처리 Promise / 기능 실패 토스트의 범주별 집계. 모든 오류를 보장하지 않음.
- **누적:** 수집 기능 운영 시작 이후 값만 포함. 과거 운영 기록 자동 복원 불가.
- 집계 정보: 날짜별 방문 세션 수·사용 초 및 기능별 오류 건수만 저장. 방문자 IP, 식별 정보, PDF 이름/내용/검색어/오류 전문은 통계 DB에 저장하지 않음.
- `analytics_sessions`에 익명 탭 UUID를 보관해 중복 방문을 방지하며 14일이 지난 세션 정보는 예약 정리. 날짜별 누적 합계는 유지.

## 문의 운영
- 문의 목록에서 검색·상태 변경(미확인/확인/처리 중/답변 완료), 관리자 메모.
- 공개 고객 문의는 기존 `POST /api/inquiries` 이용. 인증된 `GET /api/admin/inquiries`만 문의 내역을 제공.
- 상태 변경 이력은 `inquiry_audit`에 기록.
- `ADMIN_EMAIL`은 Cloudflare Workers encrypted secret, GitHub 또는 브라우저에 기록하지 않는다.

## 현재 활성화 필요
현재 연결 Cloudflare 계정의 Access API 응답은 `access.api.error.not_enabled` (Access 미활성화). Zero Trust 활성화 후 상기 self-hosted 경로 보호 정책을 만들어야 관리 화면을 사용할 수 있다.
공식 문서: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
