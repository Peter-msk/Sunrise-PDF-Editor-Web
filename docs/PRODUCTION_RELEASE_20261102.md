# Sunrise PDF Editor Web — 2026-11-02 출시 절차 및 차단 조건

## 목표와 시간 (Asia/Seoul)
- 15:00: 코드 수정 마감, 기능 범위 고정, 실제 CI와 미완료 기능 목록 확정
- 15:30: 출시에 필요한 모든 조건을 만족한 승인본에 한하여 운영 배포
- OCR(USR-20) 제외. 기능 완료·자동 검사·현장 수용·운영 배포는 별도 기록한다.

## 실행 방식
`.github/workflows/production-release.yml`은 **workflow_dispatch 수동 호출 전용**이며 **main** 브랜치에서만 실행된다. 별도 예약 실행이나 PR 자동 배포를 지원하지 않는다.

1. `docs/development-progress.json`의 미완 항목과 안전 경고를 검토하고 실제 출시 범위를 승인한다. 36개 전체가 완성되지 않았다면 전체 기능 출시로 표시하지 않는다.
2. 운영 D1 SQL 백업을 GitHub 저장소 바깥의 접근 통제된 보관소에 확보하고 SHA-256을 확인한다. 원본 개인정보를 이슈·PR·로그에 기록하지 않는다.
3. 해당 백업을 **빈 격리 시험 D1**에 복원하고 무결성·핵심 조회를 확인한 뒤 복원 확인 기록을 보관한다. 백업 성공만으로 복원 검증을 통과 처리하지 않는다.
4. GitHub production 환경에서 `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`를 구성하고 환경 승인 보호 정책을 적용한다. Worker 비밀값/계정 접근도 별도 확인한다.
5. 검증된 릴리스 코드를 main에 병합하고 **해당 main SHA에 대한 push 전체 CI PASS**를 확보한다. PR CI 성공만으로 대체하지 않는다.
6. GitHub Actions에서 `Sunrise PDF Editor production release`의 `Run workflow`를 **main**으로 호출한다. `approved_sha`는 정확한 main SHA, `private_backup_sha256`은 백업 증거, `isolated_restore_receipt`는 격리 복원 기록을 제공한다.
7. Workflow가 Node 전체 계약/프로덕션 빌드, GitHub CI SHA 게이트, 운영 D1 읽기 전용 스키마 사전검사, Wrangler 번들 확인 후에만 Worker+정적 에셋을 배포하도록 한다.
8. 배포 후 공개 편집기 페이지와 D1 기반 `/api/site-updates` 및 비로그인 관리자 API 접근 차단을 자동 확인한다. 실제 관리자 로그인·파일 편집 수용은 추가로 확인한다.
9. 실패 시 배포 성공으로 표시하지 않는다. 이전 정상 Worker 버전과 소스 SHA를 확인하여 **별도 승인된 복구 절차**로 롤백한다. 이 워크플로는 자동 DB 복원을 하지 않는다.

## 출고 차단 조건
- 필수 제품 기능이 구현되지 않았거나 운영상 위험을 숨긴 경우
- 운영 백업/복원 증빙 누락·실패, GitHub production 승인 미비
- 전체 main CI 실패·누락, 승인 SHA 불일치
- 운영 D1 테이블/필드 누락 및 원격 조회 오류
- Cloudflare 인증 정보 누락, 번들 검증 실패
- 운영 배포 후 스모크 실패 (즉시 원인 분석·복구 필요)

## 사실 기준
- 2026-11-02 Cloudflare API로 운영 D1 **테이블/열만 조회**하여 기존 누락 목록의 주요 구조 존재를 확인했다. 개인정보 행 조회 및 운영 변경 없음.
- 이 조회는 D1 백업/격리 복원 증거가 아니며, GitHub Actions production 비밀값 설정 여부도 확인한 것이 아니다.
- 기존 Worker의 배포 보고용 `DEPLOYMENT_EVENT_SECRET` 바인딩은 별도 구성·검증이 필요하다. 실제 배포 보고 수신 여부는 수용 검사에서 확인한다.
- 출시 워크플로는 사전 안전 장치이나, 외부 PDF/모바일/실사용 파일을 종합 검증하는 대체물이 아니다.
