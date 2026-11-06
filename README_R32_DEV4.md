# Sunrise PDF Editor(Web) — R32-DEV4 전체 소스

이 프로젝트는 R32(통합본) → DEV1(마스킹·Word) → DEV2(WinAnsi·Word 섹션) → DEV3(CMS 서명) → **DEV4(웹 PDF 암호 보호 소스)**를 모두 포함합니다.

## DEV4에서 실제 작성된 제품 코드

- 새 메뉴: `검토·보안` → `문서 보안` → `PDF 열기 암호 (AES-256 · 실험)`.
- 기능: 브라우저 안에서 QPDF WASM (`pdfstudio` 정확히 `0.4.0`)으로 사용자 열기 암호를 적용한 **별도 PDF 파일** 생성.
- 처리: Web Worker, 원본 상태 확인, 기존 서명·양식 거부, 암호 입력/확인, 취소, 결과 파일 메타정보 검사 후 다운로드.
- 자산: `npm ci` 후 승인된 `npm run build` 과정에서 JS/WASM을 동일 출처 정적 경로로 복사하도록 코드만 수정.

## 실행 및 검증 상태

**이 차수에서 `npm ci`, npm 빌드, Node/브라우저 실행, 테스트, 실제 PDF 암호화, CI, GitHub 푸시, Cloudflare 배포를 실행하지 않았습니다.**

이 ZIP은 **전체 프로젝트 소스**이지만 QPDF WASM npm 패키지와 DEV4 신규 빌드 산출물은 포함하지 않습니다. 따라서 ZIP 속 기존 `dist/`를 실행해서 새 암호 보호 기능을 시험할 수는 없습니다. 먼저 향후 사용자 승인에 따른 `npm ci`와 빌드가 필요합니다.

암호화 결과를 독립 PDF 뷰어에서 실제로 열고 암호 보호 여부를 확인하기 전까지 **USR-14 완료/PASS/안전성 검증 완료로 보고하지 않습니다.**

## 주요 자료

- `docs/R32_DEV4_IMPLEMENTATION.md` — 구현 파일별 범위, 입력 제한, 보안 경계, 남은 검증
- `docs/R32_DEV4_FEATURE_PROGRESS.md` — 19개 기능별 기존 구현률과 DEV4 반영 내역
- `R32_DEV4_SOURCE_MANIFEST.json` — 실제 변경 파일, SHA-256 및 미검증 상태
- `tests/usr14-wasm-aes256-practical.cjs` — 추후 사용자가 승인했을 때 실행하는 암호화 실제 회귀
- `tests/usr14-web-integration-contract.cjs` — 추후 UI/Worker/빌드 의존성 계약 확인

## 제품 품질 주의

- **USR-14 암호 보호는 표준 PDF AES-256 구현체를 연결한 *소스 단계*입니다.** npm 바이너리는 미설치이며 실제 호환 검증 전입니다.
- USR-15 CMS 서명, USR-05 확장, USR-13 마스킹, USR-16 Word 구조 추정도 각각 이전 차수의 코드 반영 상태를 유지하며 최종 수용검증은 미완료입니다.
- 기존 사용자 기능 19개 관리상 평균 68.1%, 관리자 기능 14개 평균 100%, 전체 33개 평균 81.6%는 **R26 기록**이며 DEV1~DEV4 코드 개발을 미검증 상태에서 임의로 더하지 않았습니다.
- 검증·빌드·배포 전에는 새 버전을 운영에 적용하면 안 됩니다.
