# 배포 보고 소스 구현

## 구현 경로

- 배포 실행 후 `node scripts/report-deployment.cjs succeeded|failed|rolled_back`로 결과를 보고한다.
- 실행 환경은 GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_SHA, DEPLOYMENT_ENVIRONMENT(production 또는 staging)를 제공한다. DEPLOYED_WORKER_VERSION은 선택 항목이다.
- Worker와 보고 실행 환경에 같은 고엔트로피 DEPLOYMENT_EVENT_SECRET(32자 이상)을 비밀값으로 설정한다. 코드·문서·로그에 실제 값을 기록하지 않는다.
- POST /api/operations/deployments는 본문과 시각을 HMAC-SHA256으로 검증한다. 5분을 벗어난 요청과 잘못된 입력을 거부하고 동일 실행의 오래된 보고가 최신 보고를 덮어쓰지 않게 한다.
- 관리자 세션으로만 GET /api/admin/deployments를 읽는다. 최근 20건과 최근 운영 실패를 화면에 표시한다. 예정된 정리에서 90일 이전 보고를 삭제한다.

## 운영 연결 상태

현재는 마이그레이션 0007과 API·보고 스크립트·관리자 UI 소스를 작성한 상태다. 실제 운영 DB 적용, 비밀값 설정, 실제 배포 워크플로우 연결, 보고 실행은 하지 않았다. 따라서 실제 운영 배포 내역을 확인했다고 주장하지 않는다.

실제 배포 명령의 결과에 따라 보고 스크립트를 호출해야 하며, 일반 코드 검사 성공을 배포 성공으로 보고해서는 안 된다. Worker 버전 생성 시각, 파이프라인 보고 수신 시각, 실제 배포 완료 시각은 서로 구분한다.

전체 기능·브라우저 검증은 관리자 소스 구현 종료 후 진행한다. 서명 오류·오래된 서명·중복 및 역순 보고·권한 없는 조회·DB 장애·실제 배포 결과와의 일치를 검증 대상으로 남긴다.
