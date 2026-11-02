# Sunrise PDF Editor (Web) R09 — 통합 검증 및 관리자 스크롤 수정

- 검증 기준: R07 전체 통합 소스 + R08 수정 2종 적용 프로젝트.
- R09 코드 수정: `dist/admin/index.html` 1개. 목록 선택 시 `renderPublications()`로 목록 노드를 모두 재생성하며 스크롤 위치가 초기화되는 문제를 해결. 선택 시 기존 DOM을 유지하고 `aria-pressed` 속성만 변경.
- 신규 검증 파일: `tests/r09-admin-scroll-browser.py`, `tests/r09-pdf-browser.py`, `tests/r09-remaining-engines.cjs`. 시험 결과 JSON 2개 추가.

## 실제 실행 확인
1. Chromium 독립 관리자 HTML: 공지 50개 표시, 50→80개 자동 페이지 추가 조회, 세로 스크롤, 항목 선택 후 scrollTop 유지(2633px), 모바일 내부 스크롤 높이 213px, JS pageerror 0개. 서버 API는 **모의 응답**, 관리자 로그인/운영 사이트는 테스트하지 않음.
2. 브라우저 내 PDF.js 5.6.205: 2쪽 PDF→PNG/JPG 각각 2개 ZIP 항목 생성 및 CRC 검증; 시각 비교에서 동일한 1쪽은 same, 변경 문서의 2개 페이지는 different, 페이지 누락을 missing으로 판별; 차이 PNG 및 CSV/JSON의 ZIP 항목 확인; AbortError 취소 확인.
3. 실제 PDF + pdf-lib: 페이지 구성, 양식 필드 작성과 값 수정 후 재열기, 워터마크+쪽번호, PDF 메타데이터 저장 후 재열기, 일괄 품질검사의 정상/손상 PDF 혼합 처리 및 CSV 내보내기, 페이지 구성 취소.
4. R08 재검증: 이미지→PDF, 자르기, N-up(2/4/6/9/16), 오버레이; 관리자 백업 복원 인메모리 SQLite 승인·복원·감사·재사용 차단·동시 수정 차단.

## 미확인 사항
- 정식 npm ci / npm run build: 환경에 필수 `terser` 의존성이 없고 npm 외부 다운로드 불가. 릴리스 빌드 PASS 아님.
- 전체 편집기 UI에서 LOCAL-01~12 모달·다운로드·예외·취소 E2E는 미검증. 현재 엔진/DOM 단위 검증임.
- 관리자 UI 테스트는 Chromium에 실제 HTML을 로드하고 **가짜 API 응답**을 사용한 독립 DOM 테스트. 실제 Cloudflare 인증·라우팅·D1은 미검증.
- 관리자 백업/복원은 SQLite 시험 DB만 확인. Cloudflare D1, 0016 마이그레이션의 운영 적용은 미실시.
- GitHub 파일 수정·커밋·PR, Cloudflare 배포는 미실시.

## 1/2/3단계 상태
- 1단계 통합: 100%, 전체 통합 코드 생성 완료.
- 2단계 검증: 3/6 영역 완료로 50% (G01 소스 구조·구문 PASS, G04 관리자 복원 시험용 SQLite PASS, G05 관리자 스크롤 Chromium 독립 DOM PASS). G02 기존 전체 계약/빌드 관련 부분 완료, G03 기능 엔진 다수 PASS지만 UI E2E 미완료, G06 정식 릴리스 빌드 환경 차단.
- 3단계 GitHub·Cloudflare: 0%.

## 재현 명령
```bash
node tests/r08-new-engines.cjs
node tests/r08-publication-restore.mjs
node tests/r09-remaining-engines.cjs
python tests/r09-admin-scroll-browser.py
python tests/r09-pdf-browser.py
```
Python 환경은 Chromium(`/usr/bin/chromium`) 및 playwright, reportlab 설치가 필요하다.
