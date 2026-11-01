# 관리자 전용 Cloudflare 배포 현황 — 2026-11-01 (KST)

## 범위

- GitHub 운영 main에는 관리자 전용 릴리스 PR #17이 병합됐다. 병합 SHA: `0cb4c30e0245abb47b4fd65b4147d29c7a4758e9`.
- 별도 사용자 PDF 편집 기능 PR #9~#16과 새 Office 변환 PR #18은 본 운영 병합에 포함하지 않았다.
- Cloudflare 기존 운영 Worker `sunrise-pdf-editor`와 D1 `sunrise-pdf-editor-web-contact`는 배포 전 점검에서 **변경하지 않았다**.

## Cloudflare 운영 점검

2026-11-01 Cloudflare 연결을 통한 **읽기 전용** 점검에서 다음 사항을 확인했다.

- D1 기존 관리자/문의/통계 테이블 일부는 있지만 최신 소스 요구 테이블
  `analytics_save_operations`, `analytics_operations`, `operation_deployments`,
  `admin_security_events`, `admin_maintenance_status`가 없다.
- `inquiries`, `site_announcements`, `site_releases`에 최신 편집 충돌 방지 `revision` 열이 없다.
- `analytics_daily.returning_visits`, `analytics_sessions.active_seconds`도 누락됐다.
- 운영 Worker 비밀값 `INQUIRY_HASH_SALT`는 종류만 확인했다. 비밀값의 내용·유효성은 열람하지 않았다.
- 운영 Worker에 `DEPLOYMENT_EVENT_SECRET` 비밀값이 설정되어 있지 않다.
- D1 Time Travel 복원 기준점을 조회했지만, 별도 SQL 전체 백업·격리 복원 검증은 수행하지 않았다.
- Worker 재배포, D1 스키마 변경, 배포 보고 비밀값 생성은 실행하지 않았다.

## 현재 배포 판정

**운영 Cloudflare 배포: BLOCKED (안전 사전검사 불충족)**

최신 관리자 코드를 운영 Worker에 덮어쓰면 관리자 API가 누락 스키마를 조회하면서 오류가 발생할 수 있다. 사용자의 기존 PDF 편집/문의 서비스 보호를 위해 라이브 배포는 하지 않았다.

## 해제 조건

1. 실제 운영 D1 전체 SQL 백업을 확보하고, 복원용 격리 D1/SQLite에서 데이터 무결성 및 핵심 조회를 검증한다.
2. 기존 SQL 테이블·열·인덱스와 파일별 변경 내용을 다시 대조한 후, 이미 반영된 0004를 재적용하지 않고 필요한 0005~0015 SQL을 안전 순서대로 적용한다. 0008~0010의 테이블 재작성 과정에서 원본을 잃지 않는지 검증한다.
3. Cloudflare Worker의 `DEPLOYMENT_EVENT_SECRET`을 32자 이상으로 안전하게 저장하고, GitHub production 환경에도 **동일한 값** 및 필요한 Cloudflare 배포 자격 증명을 비밀값으로 연결한다.
4. 수동 `Manual production release` 워크플로우를 GitHub main에서 실행한다. `scripts/admin-production-gate.cjs`는 실제 운영 스키마·배포 비밀값을 읽기 전용으로 확인하고 조건이 맞지 않으면 업로드 전에 실패한다.
5. 배포 직후 관리자의 실제 로그인, 문의/공지/업데이트, 통계 CSV, 운영 상태·보존·배포 기록을 실사용 도메인에서 확인한다. 문제 발생 시 직전 Cloudflare Worker 버전으로 롤백하고 D1 구조 변경은 검증된 복구 절차로 별도 처리한다.

> 소스 구현 완료와 실제 운영 배포·수용 완료는 서로 다르다. 본 문서는 Cloudflare 배포 성공을 주장하지 않는다.
