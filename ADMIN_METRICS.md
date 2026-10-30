# 관리자 인증 방식 변경

최신 관리자 로그인 및 최초 설정 절차는 [ADMIN_PASSWORD_LOGIN.md](ADMIN_PASSWORD_LOGIN.md) 참고. 기존 Access 관련 지침은 더 이상 운영 인증 방법이 아니다.

# Sunrise PDF Editor · 관리자 대시보드 운영 가이드

## 화면 / 인증

- 공개 홈페이지: https://sunrise-pdf-editor.ko-pg.workers.dev/
- 메인 우측 상단 **관리자** 버튼 → 기존 도메인의 `/admin/` 페이지.
- 관리자 인증: 최초 등록한 아이디와 비밀번호. Cloudflare Access와 OTP는 사용하지 않는다.
- 로그인 세션이 없으면 관리자 화면은 `/admin/login/`으로 이동하며 API는 401을 반환한다.
- 세션 쿠키는 Secure, HttpOnly, SameSite=Strict이며, 서버 DB에서 사용자를 확인한다.
- 공개 PDF 편집 및 문의 접수 기능은 인증 없이 계속 사용 가능하다.
- 최초 계정 등록 및 비밀번호 보안 절차는 [ADMIN_PASSWORD_LOGIN.md](ADMIN_PASSWORD_LOGIN.md)에 기록.

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
- 관리자 세션 검증 정보는 Cloudflare D1에서 확인하며, 비밀번호나 파생 키는 GitHub에 기록하지 않는다.

## 현재 활성화 필요
현재 연결 Cloudflare 계정의 Access API 응답은 `access.api.error.not_enabled` (Access 미활성화). Zero Trust 활성화 후 상기 self-hosted 경로 보호 정책을 만들어야 관리 화면을 사용할 수 있다.
공식 문서: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
