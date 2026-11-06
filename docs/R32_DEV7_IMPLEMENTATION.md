# R32-DEV7 — 실제 제품 소스 3개 기능 묶음 개발

## 변경 경로
- `src/assets/sunrise-special-pdf.js` (USR-13): 한 줄의 서로 인접한 PDF.js 텍스트 조각을 제한적으로 재조합하여 주민번호/휴대전화/이메일/사업자번호 **형식** 후보를 탐색. 복합 후보의 보수적 위치 포함 여부 판단, 대용량 스캔 상한, 이전 조각에 걸친 경계 문자로 인한 중복 집계 방지, 검토 건수에 원문 개인정보 미포함.
- `src/assets/sunrise-office-export.js` (USR-16): 기존 2단 경계 판정/문단 렌더를 2단·3단 공통 로직으로 확장. 3단 각각 최소 3줄, 겹치는 단 경계는 거부, 별도 Word 3열 편집 가능한 표로 출력.
- `src/editor/index.html` (USR-13·USR-16·USR-18): 후보 수 및 분절 검색 개수 표시, Word 3단 메뉴·디스패처·별도 파일명, Office 비동기 출력에 `captureSaveState`/`saveStateIsCurrent` 재사용.
- `tests/r32-dev7-fragments-three-columns.cjs`: 새 변경 범위에 대한 회귀검사 **코드만 작성**, 실행하지 않음.

## 유지되는 제한
1. OCR/이미지 개인정보 자동 탐지는 전혀 하지 않음. 후보 누락 가능성을 고지하고 결과 원문과 좌표는 스캔 요약에 남기지 않음. 검출기는 **보안 인증/완전 삭제 보증이 아님**.
2. 3단 Word는 좌표가 규칙적인 가로 3단 텍스트에 한정. 큰 제목·페이지 상단 통합 헤더·원본 도형/이미지/표 스타일·복잡한 문단은 지원하지 않음.
3. Office 변환 도중 북마크/오버레이/메타데이터/첨부 등이 변경되면 다운로드 중단. 원본 PDF/DEV6 기존 소스는 건드리지 않음.
4. QPDF WebAssembly 실물/서명 검증은 이전 DEV4~5 이후 그대로 미완료.
5. 빌드·JavaScript·PDF 렌더링·테스트 실행·CI·GitHub·Cloudflare 작업 없음. 현재 `dist/`는 개발 변경을 포함하지 않음.

## 차수별 진행률
`docs/USR01-19_PROGRESS_CURRENT.md` (전체 19개 행)와 동일 이름 JSON이 단일 최신 기록.
