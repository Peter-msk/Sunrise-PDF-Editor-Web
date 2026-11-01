# Sunrise PDF Editor — 관리자 Cloudflare 운영 배포 보고

**배포 상태: 성공 (2026-11-01, 한국시간 19:42)**

## 실제 운영 자원

- Cloudflare Worker: `sunrise-pdf-editor`
- 서비스: `https://sunrise-pdf-editor.ko-pg.workers.dev`
- 관리자 로그인: `https://sunrise-pdf-editor.ko-pg.workers.dev/admin/login/`
- 관리자 대시보드: `https://sunrise-pdf-editor.ko-pg.workers.dev/admin/`
- D1: `sunrise-pdf-editor-web-contact`
- 관리자 전용 GitHub 소스: PR #17, 운영 `main` 병합 `0cb4c30e0245abb47b4fd65b4147d29c7a4758e9`.
- Cloudflare 배포 시점: `2026-11-01T10:42:36.75004Z`.
- 새 Worker 버전: `5501290b-554f-44c0-9578-074a486cd340`
- 새 배포 ID: `fada8a52-acd0-4d62-8f9e-de93d504c078`
- 이전 버전(롤백 기준): `ddb5f85e-0e96-4127-a94e-06e0fc6ff80e`

## 데이터베이스 준비 및 변경

1. 운영 D1의 SQL 내보내기 완료 및 Time Travel 변경 전 bookmark 확인. **파일을 외부/별도 저장소에 영구 보관하거나 격리 DB에 실제 복원한 것은 아님.**
2. 일회성 Cloudflare 시험 D1에서 마이그레이션 `0001`~`0015` 모두 성공.
3. 기존 운영 D1에서 이미 반영된 `0001`~`0004`는 재적용하지 않음.
4. 운영 D1에 `0005`~`0015` SQL을 순서대로 적용, 응답 success 확인.
5. 운영 구조 재검사에서 최신 관리자 테이블 및 필수 열 누락 0건. 기존 관리자 계정 1개 유지.
6. 삭제 전 시험 Worker `sunrise-admin-deploy-probe-20261101`를 이용해 Cloudflare Worker 콘텐츠 갱신 방식을 검증. 배포 성공 후 시험 Worker와 시험 D1은 삭제.

## 배포 방식 및 사용자 기능 격리

- GitHub `main`의 최신 관리자 9개 ESM 모듈을 Cloudflare Worker 콘텐츠 API로 업데이트.
- `/admin/`, `/admin/password/`, `/assets/sunrise-admin-password.js` 경로에만 최신 관리자 정적 자산을 Worker 모듈에 포함해 제공.
- 다른 공개 홈페이지·PDF 편집기·기존 정적 자산은 `ASSETS` 바인딩 그대로 유지. 운영 Worker의 `DB`, `ASSETS`, `ADMIN_EMAIL`, `INQUIRY_HASH_SALT` 기존 바인딩 종류·이름 재조회 성공.
- 아직 검토 중인 사용자 PDF 기능 PR #9~#16 및 Word/Excel 변환 PR #18은 배포하지 않음.
- GitHub production의 Cloudflare 자동 배포 비밀값이 없는 것을 확인하여 **자동 Wrangler 워크플로우 대신 연결된 Cloudflare API를 통해 직접 배포**. 실제 Worker 운영 버전과 배포 ID를 확인.

## 운영 도메인 HTTP 실검증

GitHub Actions Linux 러너에서 운영 workers.dev 도메인에 curl 요청. 다음 9개가 모두 기대 HTTP 상태 코드와 일치, 작업 성공:

| 경로 | HTTP | 기대 결과 |
|---|---:|---|
| `/` | 200 | 기존 홈페이지 유지 |
| `/editor/` | 200 | 기존 PDF 편집기 유지 |
| `/admin/` | 302 | 비로그인 사용자를 로그인으로 이동 |
| `/admin/login/` | 200 | 관리자 로그인 화면 |
| `/admin/password/` | 302 | 비로그인 비밀번호 변경 화면 보호 |
| `/api/admin/overview` | 401 | 비인증 관리자 API 차단 |
| `/api/site-updates` | 200 | 기존 공개 공지 API |
| `/assets/sunrise-admin-password.js` | 200 | 최신 비밀번호 변경 JS |
| `/api/unknown-admin-smoke` | 404 | 알려지지 않은 API 차단 |

검증: https://github.com/Peter-msk/Sunrise-PDF-Editor-Web/actions/runs/41298799143

## 남은 운영 수용 확인

- 관리자 실제 계정으로 로그인한 상태에서 대시보드, 문의 수정, 공지/업데이트 수정, CSV 다운로드 및 비밀번호 변경을 수동/브라우저 검증하지 않았다. **실제 로그인 성공까지 검증한 것으로 간주하지 않는다.**
- `DEPLOYMENT_EVENT_SECRET` 바인딩과 GitHub production 환경 비밀값은 아직 준비되지 않아 HMAC 배포 이력 자동 보고는 동작한다고 확인할 수 없다. 이 기능의 준비 경고는 남을 수 있다.
- Cloudflare `CF_VERSION_METADATA` 바인딩이 없으므로 관리자 페이지의 실제 버전 메타데이터가 표시되지 않을 수 있다. 운영 Worker 버전 ID는 API에서 별도 확인됐다.
- 운영 전체 백업의 안전한 별도 보관 및 실제 복구 수용시험을 마치지 않았다. Time Travel bookmark 및 직전 Worker 버전은 확보했다.
- 운영 HTTP 스모크는 비로그인·공개 API 접근성 검증이며 실제 사용자 작업 완료/관리자 기능 전체 수용시험을 대체하지 않는다.

## 구분

**Cloudflare 관리자 소스 배포 완료**와 **모든 ADM-01~14 항목의 실제 운영 수용 완료**는 다른 개념이다. 이번 결과는 코드·스키마 운영 반영 및 HTTP 비로그인 스모크의 성공을 의미한다.
