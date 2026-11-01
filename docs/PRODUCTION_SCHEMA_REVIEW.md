# 운영 D1 구조 읽기 점검 — 2026-11-01

대상은 wrangler.toml에 선언된 `sunrise-pdf-editor-web-contact`다. Cloudflare 연결을 통해 sqlite_master의 테이블 이름과 다섯 기존 테이블의 PRAGMA 열 정보만 조회했다. 문의 내용·이메일·인증 레코드·통계 세션 원본은 조회하지 않았다. 응답의 changed_db=false, rows_written=0을 확인했다.

| 구분 | 확인된 상태 |
|---|---|
| 기존 앱 테이블 | 11개 존재 |
| 새 코드가 요구하는 추가 테이블 | analytics_save_operations, analytics_operations, operation_deployments, admin_security_events, admin_maintenance_status 없음 |
| analytics_daily | returning_visits 없음 |
| analytics_sessions | active_seconds 없음 |
| inquiries | revision 없음 |
| site_announcements / site_releases | first_published_at 존재, revision 없음 |
| Wrangler 기본 마이그레이션 이력 테이블 | 이번 테이블 목록에는 d1_migrations가 없음 |

운영 DB는 최신 관리자 소스가 요구하는 구조와 아직 다르다. 테이블 존재만으로 마이그레이션 파일 적용 이력이나 제약/트리거 전체를 확인했다고 보지 않는다. 0004의 최초 게시일 열이 이미 존재하므로 전체 파일을 처음부터 무조건 적용하면 중복 ALTER 오류가 발생할 수 있다.

## 운영 반영 전 순서

1. 인증된 운영 절차로 실제 D1 백업을 확보하고, 전용 빈 시험 DB에서 복원 및 핵심 조회를 검증한다.
2. 운영 구조·트리거·이력을 다시 대조해 실제 적용할 파일을 결정한다. 이번 확인된 누락은 0005~0015의 내용에 해당한다. 0004는 재실행하지 않는다.
3. 백업 이후 검토된 0005~0015 파일을 순서대로 적용한다. 0008→0009→0010은 기존 기록을 보존하는 테이블 재작성이며, 0013은 작업 테이블 이후에 적용한다.
4. 최신 관리자 코드와 0015 수정 버전 계약을 함께 반영한다. 운영 스키마 준비 확인 후 검토된 main에서 수동 배포한다.
5. 실제 운영 로그인·집계·문의·게시물·CSV·예약 정리·배포 보고를 확인한다. 이미 열린 관리자 화면은 새로고침한다.

이번 점검은 구조 조회에 한정한다. 운영 데이터 내보내기, 스키마 변경, 비밀값 설정, 배포, 복원은 실행하지 않았다. 이 문서는 자동 마이그레이션 실행 명령이 아니다.


## 현재 Worker 설정 이름/종류 조회

Worker settings API에서 필요한 바인딩의 이름과 종류만 추려 확인했다. 비밀값 내용은 반환하거나 출력하지 않았다.

| 바인딩 | 조회 결과 |
|---|---|
| DB | D1 바인딩 존재 |
| ASSETS | assets 바인딩 존재 |
| INQUIRY_HASH_SALT | secret_text 바인딩 존재; 값/유효성 미조회 |
| DEPLOYMENT_EVENT_SECRET | 없음; Worker와 GitHub production 환경 연결 필요 |
| CF_VERSION_METADATA | 없음; 배포 시 소스의 version_metadata 설정 반영 필요 |
| ADMIN_BOOTSTRAP_TOKEN | 없음; 기존 계정 등록 후 제거했을 수 있으므로 신규 설정 필요로 단정하지 않음 |

GitHub production 비밀값은 조회하지 않았다. 바인딩 존재 확인을 실제 인증 성공이나 배포 보고 연결 성공으로 해석하지 않는다.
