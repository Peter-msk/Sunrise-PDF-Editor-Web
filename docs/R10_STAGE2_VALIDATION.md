# Sunrise PDF Editor (Web) — R10 검증·보완 보고

## 기준 및 변경

- 기준: R09 전체 통합 소스. GitHub 원격 저장소와 Cloudflare 운영 서비스에는 변경하지 않음.
- 실제 수정한 기능 소스 5개: `src/assets/sunrise-images-to-pdf-ui.js`, `sunrise-pdf-to-images-ui.js`, `sunrise-pdf-page-geometry-ui.js`, `sunrise-pdf-visual-compare-ui.js`, `sunrise-pdf-overlay-ui.js`.
- 도구모음이 있을 때 기능별 모듈이 `sunriseTool` query를 중복 자동 처리하지 않도록 단일 소유권 추가(4개 모듈). 단독 모듈 시 기존 URL 진입 허용.
- 오버레이 UI에서 `normalizeOptions(raw)`로 사전 검증한 뒤 **raw 퍼센트값**을 엔진에 전달. 엔진은 내부에서 정규화를 1회 수행. `opacity=100`이 이중 정규화되어 `1<5` 오류가 발생하던 문제 해결.

## 실제 검사 결과 (격리된 Chromium)

- 24개 PDF 도구 목록 노출, 13개 신규 도구 진입 경로의 모달/파일입력 연결 확인.
- 실제 UI 파일선택 → 실행 → 결과 다운로드 및 내용 검사 **12개 대표 경로**:
  1) 페이지 자유 구성, 2) 양식 필드 추가·재열기, 3) 워터마크, 4) 문서 메타데이터, 5) PDF 일괄 품질검사 CSV, 6) 이미지→PDF, 7) PDF→이미지(4개 PNG ZIP), 8) 페이지 자르기, 9) 크기 변경, 10) 모아찍기 4→1쪽, 11) 겹치기, 12) 시각 비교 JSON/CSV ZIP.
- 주요 결과물은 PyMuPDF에서 페이지 수, 필드, 메타데이터, 내용 또는 ZIP 항목과 CRC를 확인. 전체 페이지 오류 0개.
- 모바일 390px 뷰포트에서 모아찍기 모달 폭 약 374px, 내부 스크롤 활성화 확인.
- PDF.js 5.6.205 모듈과 worker를 네트워크 접속 대신 메모리 Blob URL에서 로드하여 실제 PDF 렌더링 검증.
- 관리자 스크롤 R09 독립 Chromium 검사 재통과: 목록 50→80개, 스크롤 위치 유지, 모바일 높이 검사. API는 모의 응답.
- R08 엔진/복원·R09 엔진 회귀 검사 재실행 통과.
- `tests/r10-release-assets-contract.cjs`로 LOCAL 24개 JS의 편집기·빌드 순서, 신규 도구 페이지, URL 중복 방지 및 겹치기 옵션 계약 확인.

## 정식 빌드 및 계약 테스트의 미완료

- `npm test`는 정식 릴리스 빌드를 실행하는 `tests/build-line-endings.cjs`에서 중단. 원인: `terser` 패키지가 설치되어 있지 않음 (`MODULE_NOT_FOUND`). 이전까지 다수 테스트 PASS; 마지막 3개 릴리스 계약은 별도 명령으로 PASS. **전체 npm test PASS 아님.**
- `npm view terser@5.51.2`는 npm registry DNS 오류 `EAI_AGAIN`. `npm ci` 설치가 정상 완료된 환경에서 `npm test`와 `npm run build`를 다시 실행해야 함.
- `dist/`는 **릴리스 빌드 산출물로 새로 생성한 디렉터리가 아님**. R10 수정 코드는 `src/assets/`에만 포함되며, 정식 빌드 시 dist에 반영되어야 함.
- 독립 Chromium DOM 테스트는 서버 인증, 실제 Worker API, Cloudflare D1, 정식 배포 라우팅과 별개. 관리자 복원은 인메모리 SQLite 시험만 통과.
- PDF 기능별 모든 실패·취소·성능·브라우저 조합까지 완전 검증한 것은 아님.

## 진행률

- 1단계 소스 통합: **100%** (기준 프로젝트 통합 ZIP 존재).
- 2단계 검증: **67% (6개 영역 중 4개 PASS)**. G01/G03 대표 UI 정상경로/G04 SQLite 복원/G05 독립 관리자 DOM PASS. G02 전체 자동화 계약, G06 정식 릴리스 빌드·통합 운영 미완료.
- 3단계 GitHub·Cloudflare 배포: **0%** (미시작).

## 재현 환경

- Node.js v22, Python 3.13, Chromium (`/usr/bin/chromium`), Python Playwright·PyMuPDF·Pillow; test dependencies are not production dependencies.
- `node tests/r10-release-assets-contract.cjs`
- `python tests/r10-editor-ui-browser.py`
- `python tests/r10-geometry-metadata-stamp-browser.py`
- `python tests/r10-pdfjs-ui-browser.py`
- `python tests/r10-composer-form-overlay-preflight-browser.py`
- `python tests/r09-admin-scroll-browser.py`
- `node tests/r08-new-engines.cjs && node tests/r08-publication-restore.mjs && node tests/r09-remaining-engines.cjs`

## 이후 차단 해제 순서

1. 고정 `package-lock.json` 기준 `npm ci` (외부 설치 가능한 환경), 정식 `npm run build` 수행.
2. `npm test` 전체 실행 및 실패 여부 기록; 기존에 PASS한 항목을 중복 검증하지 않도록 CI와 분리 가능 여부 검토.
3. 실제 빌드된 `dist/`에서 전체 편집기 UI 및 관리자 로그인/라우팅, 공지 목록, 백업 복원 미리보기(시험 DB) 검사.
4. 별도 승인 후 GitHub 커밋/PR 및 Cloudflare 배포 진행.
