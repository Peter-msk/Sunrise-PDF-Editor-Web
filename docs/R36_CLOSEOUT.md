# R36-DEV1 통합 마감 작업 결과 및 배포 인계

기준: 2026-11-06. 시작: R35-DEV1 전체 소스, 과거 GitHub main/R16~R25 미병합 PR과 별개. GitHub·Cloudflare·D1 운영 데이터 미변경.

## 반영된 소스 개발

1. `scripts/build-release.cjs`: 기본 정식 빌드는 잠긴 `terser@5.51.2`를 계속 필수로 검사한다. **명시적** `--preview-unminified` 모드만 소스 기반 검증용 dist를 만들며, 줄바꿈 정규화·HTML inline script 종결 토큰 검사·기존 고정 vendor SHA-256 검사·정적 자산 복사를 유지한다. 검증용 빌드에는 `dist/SUNRISE_PREVIEW_ONLY.json`을 기록한다. 정식 빌드에 성공하면 이 마커를 삭제한다.
2. `scripts/check-release-ci-gate.cjs`: **preview 마커가 있는 배포 패키지는 운영 승인/CI 결과와 무관하게 차단**한다. 기존 4개 CI 작업 및 정확한 승인 SHA 검사 유지.
3. `tests/build-line-endings.cjs`: 기존 테스트가 격리 fixture에 필수 `vendor/`를 누락한 오류를 보완하고, terser 설치 환경에서는 정식 경로, 없는 환경에서는 미압축 검증 경로로 LF/CRLF/CR의 원본 불변·스크립트 유효성을 테스트한다. preview 성공을 정식 빌드 성공으로 간주하지 않는다.
4. `tests/r36-preview-release-guard.cjs`, `tests/r36-distribution-integrity.cjs`: preview 배포 차단, 41개 로컬 자산 참조 및 핀된 vendor 바이트 검사.
5. `scripts/development-status.cjs`, `npm run status`, `docs/R36_CURRENT_STATUS.md`: 사용자 19/관리자 14개 전체 항목의 **과거 기준선 점수 + 최근 기능 확인 근거 + 미완료**를 단일 원본에서 생성한다. 과거 공식 81.6% 소스 구현률을 R35 완료율로 속여 갱신하지 않는다.

## 검증 결과

- `npm test`: **94개 독립 Node 명령 호출 전체 PASS**, exit=0. 이는 사용자/관리자 기능 94개 완료가 아니다.
- `npm run progress:check`: PASS.
- `npm run test:r36`: preview 릴리스 차단, LF/CRLF/CR, 41개 로컬 에셋 체크 PASS.
- `src/assets/*.js` Node 문법 검사: PASS.
- `npm run dist:preview`: PASS. 출력은 미압축 **검증용**이고 운영 배포 금지.
- `npm run build`: FAIL, `Cannot find module 'terser'` (고정 의존성 설치 실패). `npm ci`는 네트워크 DNS `EAI_AGAIN`으로 실패. **정식 릴리스 빌드·CI·배포는 불가능**.
- Chromium Playwright 실기 시도: `/`, `/editor/`, `/tools/`, `/admin/` 모두 `ERR_BLOCKED_BY_ADMINISTRATOR`. 로컬 서버와 file URL도 정책 차단. 웹 UI/PDF 열기·저장 수용은 NOT_VERIFIED.
- Windows·Android·iOS·Office/Acrobat 실기, 외부 실무 PDF, 원격 Worker/D1/Cloudflare는 미검증.

## 별도 기능 개발이 남은 경계

- 원문 직접 편집: 내장 혼합 길이 CMap(R35)은 검증. 외부 이름/상속 CMap, 임의 문단 재흐름 미구현.
- 양식/페이지: XFA 자동 계산·스크립트와 태그·특수 구조 무손실 재배치 미구현.
- 서명: 기본 CMS 증분 서명은 존재하나 신뢰 CA·OCSP/CRL·TSA·PAdES LT/LTA와 인증형 필드 잠금 미구현.
- Office 변환: 일반 텍스트·다중 표·개별 이미지는 존재하나 모든 복합 PDF의 고충실도 레이아웃·벡터·회전/잘림 이미지 복원 미구현.
- OCR은 명시적으로 제외.

## 정식 배포 필수 절차

1. 잠긴 Node 의존성 `npm ci --ignore-scripts`가 가능한 네트워크 환경 또는 신뢰 가능한 고정 오프라인 캐시에서 설치.
2. `npm test`와 `npm run progress:check` 후 **반드시 `npm run build`** 실행. preview 마커가 없는지 검증하고 새 dist와 실제 웹 브라우저 PDF 저장·재열기 검증.
3. 위 네 범위의 완전 지원을 원한다면 추가 구현과 실문서·독립 검증이 필요함을 제품과 QA 범위에 반영. 근거 없는 100% 발표 금지.
4. GitHub에 최신 R35/R36 전체 소스 정합하게 통합하고 main SHA 기준 필수 CI 4개 작업 성공을 확인.
5. Cloudflare 배포 전 D1 원격 백업·독립 복원 영수증·관리자 보안 비밀키·스키마 read-only 점검, dry-run과 smoke 수행. 실패 시 배포 차단.

**이번 작업 결과:** 실제 소스·검증 체인 및 검사 전용 빌드 생성. 정식 배포 및 전체 기능 완성 판정은 보류. 확인한 문제를 새 작업 회차로 무한 분산하지 않고 위 차단 조건을 우선 해소해야 한다.
