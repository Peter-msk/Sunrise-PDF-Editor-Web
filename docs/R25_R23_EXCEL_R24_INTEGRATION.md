# R25 — R23-A Excel 표 열 추정 + R23-B 보안 마스킹 + R24 원문 수정 통합

- 날짜: 2026-11-04 (KST)
- 기반: R24 PR #56 `fd6518df11a555dbe567500978e2223a57f14541`
- 통합 출처: R23-A PR #54 `47b77d70c85a48e452f95d53fae2f1210116b76a`
- 병합 방식: R24 최종 tree를 기준으로 R23-A의 Excel 관련 변경만 이식하고, R23-A를 두 번째 부모 커밋으로 명시하여 분기 계보 보존.

## 통합 변경 및 이유

1. `src/assets/sunrise-office-export.js`: 원래 페이지/텍스트 Excel 출력 유지 + 정렬된 PDF.js 텍스트의 제한된 다열 추정(`xlsxColumns`) 기능 도입.
2. `src/editor/index.html`: Excel 기존 명령을 유지하고 별도 표 열 추정 명령을 추가. R24의 원문 Tj/ASCII 직접 수정 명령 보존.
3. `tests/office-text-export.cjs`, `tests/browser-save-reopen.cjs`: 실제 다열 PDF→XLSX 파일 다운로드·셀 내용, 특수 수식 문자열 비실행, 회전·불규칙 텍스트 거부 테스트 추가.
4. R23-A의 마스크 변경을 그대로 다시 덮어쓰지 않음: R23-B→R24의 `sunrise-special-pdf.js`에는 동일 경계 수정과 5픽셀 불투명 확인이 이미 존재함.
5. `docs/development-progress.json`의 USR-16 Excel 범위 기록과 파생 진행률 문서·계약 갱신. USR-13 47%, USR-05 32% 등 R24의 더 최신 구현 증거를 덮어쓰지 않음.

## 안전 경계

- 스캔 OCR/문서 자동 업로드 없음.
- XLSX 열 추정은 PDF 원문 표·병합 셀·테두리·의미론적 셀 구조 전체 복원 아님.
- 마스킹은 사용자 지정 영역만 래스터로 가리며 문서 전체 개인정보 완전 삭제 인증 아님.
- R24 직접 원문 수정은 Type1/ASCII/동길이 Tj에 한정되며 서명·한글·복합 텍스트에는 적용하지 않음.
- 사용자 PDF 원본 불변; 기존 D1/Worker 운영 데이터 변경 없음.

## 출고 판정

- 통합 HEAD의 Node/빌드, Linux Chromium, Windows Chrome·Edge 4/4와 QPDF 회귀가 새로 PASS해야 함.
- PR 대상은 R24 개발 브랜치이며 main/운영 배포와 분리. 실무 고객 PDF·Android/iOS 실기·Office 앱 수용 및 D1 원격 격리 복원 미완.
- CI/실기 수용/운영 배포 각 단계의 상태를 서로 혼합하지 않음.
