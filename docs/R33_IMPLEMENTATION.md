# R33-DEV1 — 추가·보완 소스 인계

전체 기능 완료본이 아닌 코드 작성 후보본. 기능 실행·빌드·CI·운영 반영 미실시.

| ID | 영역 | 작성·포함 범위 | 근거 파일 |
|---|---|---|---|
| R33-001 | USR-05 | Identity-H CID·ToUnicode 한글 원문 해독 | `src/assets/sunrise-content-editor.js` |
| R33-002 | USR-05 | 길이가 다른 문구를 기존 진행 너비에 맞춰 교체 | `src/assets/sunrise-content-editor.js` |
| R33-003 | USR-05 | 원래 글꼴에 없는 문자의 한글 저장 글꼴 대체 | `src/assets/sunrise-content-editor.js` |
| R33-004 | USR-05 | 문자열·주석과 연산자를 구분하는 제한적 내용 파서 | `src/assets/sunrise-content-editor.js` |
| R33-005 | USR-06 | 원본 사각형 좌표·크기 수정 | `src/assets/sunrise-content-editor.js` |
| R33-006 | USR-06 | 원본 선·곡선 경로와 해당 경로의 색·두께 수정 | `src/assets/sunrise-content-editor.js` |
| R33-007 | USR-04 | 단어·문자소 경계를 고려한 텍스트 줄바꿈 | `src/editor/index.html` |
| R33-008 | USR-04 | 회전된 텍스트의 페이지 경계 검사 | `src/editor/index.html` |
| R33-009 | USR-08 | 이름 목적지 북마크 해석 | `src/assets/sunrise-outline-transfer.js` |
| R33-010 | USR-08 | 북마크의 XYZ·FitH 등 보기 좌표 이식 | `src/assets/sunrise-outline-transfer.js` |
| R33-011 | USR-07 | 밑줄·취소선·물결선·사각형·원형 주석 문구 관리 | `src/editor/index.html` |
| R33-012 | USR-07 | 확장 주석 종류의 의견 CSV 포함 | `src/assets/sunrise-comment-report.js` |
| R33-013 | USR-10 | 라디오 그룹 조회·입력·생성 | `src/assets/sunrise-pdf-form-tools.js` |
| R33-014 | USR-10 | 복수 선택 목록 조회·입력·생성 | `src/assets/sunrise-pdf-form-tools.js` |
| R33-015 | USR-10 | 별도 파일 양식 도구에 한글 기본 글꼴 자동 적용 | `src/assets/sunrise-pdf-finishing-ui.js` |
| R33-016 | USR-01/02 | 양식 평탄화 선택 후 병합·분할·추출 경로 | `src/editor/index.html` |
| R33-017 | USR-12 | 내장 글꼴 파일 유무 확인 | `src/assets/sunrise-pdf-quality.js` |
| R33-018 | USR-17 | 중첩 Form XObject 내부 원본 JPEG 탐색 | `src/assets/sunrise-embedded-images.js` |
| R33-019 | USR-13 | 직렬화된 마스킹 PDF를 다시 열어 텍스트·주석·첨부·픽셀 검사 | `src/assets/sunrise-special-pdf.js` |
| R33-020 | USR-14 | 고정 버전 QPDF WASM 실물 포함 | `vendor/pdfstudio/SUNRISE_PROVENANCE.json` |
| R33-021 | USR-14 | 암호화 파일의 틀린 암호 거부 확인 경로 | `src/assets/sunrise-pdf-protect-worker.js` |
| R33-022 | USR-14 | 암호화·해제 전후 페이지 수·첨부 목록 비교 | `src/assets/sunrise-pdf-protect-worker.js` |
| R33-023 | USR-14 | Worker 시간 상한·취소·결과 크기 검사 | `src/assets/sunrise-pdf-protect.js` |
| R33-024 | USR-15 | 별도 Worker에서 P12/PFX MAC·RSA 키 쌍 확인 및 가져오기 | `src/assets/sunrise-pki-worker.js` |
| R33-025 | USR-15 | 사용자 지정 루트 기준 인증서 체인 검사 | `src/assets/sunrise-pki-worker.js` |
| R33-026 | USR-15 | CAdES 형식의 SigningCertificateV2 인증서 결합 속성 | `src/assets/sunrise-pdf-cms.js` |
| R33-027 | USR-15 | 실제 PDF ByteRange·CMS 서명 무결성 재검사 | `src/assets/sunrise-pdf-cms.js` |
| R33-028 | USR-18 | 기존 서명 문서의 읽기 전용 열기·원본 바이트 복사 | `src/assets/sunrise-edit-state.js` |
| R33-029 | USR-16 | 명확한 표 선으로 Word 병합 셀 복원 | `src/assets/sunrise-office-export.js` |
| R33-030 | USR-16 | 명확한 표 선으로 Excel 병합 셀·페이지별 시트 복원 | `src/assets/sunrise-office-export.js` |
| R33-031 | USR-16 | 페이지 이미지를 포함한 원본 모양 Word 출력 | `src/assets/sunrise-office-export.js` |
| R33-032 | USR-16 | 추가 Office 변환의 진행·취소·문서 상태 보호 | `src/editor/index.html` |
| R33-033 | USR-19 | 모바일 직접 저장·공유 버튼과 다운로드 URL 수명 상한 | `src/editor/index.html` |
| R33-034 | USR-09 | QPDF 무손실 스트림 압축 경로 | `src/assets/sunrise-pdf-protect-worker.js` |
| R33-035 | TECH-01 | 의존성 파일 해시와 빌드 전 무결성 확인 경로 | `scripts/build-release.cjs` |

## 지원 계약

- 원문/벡터 수정: 현재 페이지의 내용 스트림을 새 스트림으로 교체하고 리소스를 복제한다. 서명·양식·선택 레이어·태그·대체 텍스트·외부/세로 CMap·일부 특수 내용은 거부한다. 개인정보 삭제 수단이 아니다.
- 원문 너비 변경: 기존 진행 너비에 맞춰 글자 폭을 조정한다. 0.4~2.5배 범위 밖은 거부한다. 원래 글꼴을 그대로 재작성하는 방식과 구분한다.
- Word/Excel 표: 명확한 직교 표 선과 직사각형 병합 셀만 복원한다. 모호한 경계·모순되는 분리선·분리된 다중 표 등은 거부하며, 표 밖 문구는 별도로 보관한다.
- Word 원본 모양: 최대 30쪽, 페이지별 PNG 포함. 이미지 모드이며 편집 가능한 원래 텍스트/도형 복원으로 표시하지 않는다.
- P12/PFX: MAC이 있는 512KiB 이하 컨테이너, 단일 2048~4096비트 RSA 키 쌍. Worker 30초 제한. 개인키·비밀번호를 저장하거나 서버로 전송하지 않는다.
- 체인 검사: 사용자가 별도로 선택한 루트에만 의존한다. 컨테이너에 들어 있는 인증서를 자동으로 신뢰 루트로 취급하지 않는다. 폐기/타임스탬프는 검사하지 않는다.
- CMS 검사: 단일 RSA PKCS#1 SHA-256 서명이 최종 파일 전체를 덮는 형식. 신뢰/법적 효력/모든 PAdES 규격을 판정하지 않는다.
- 기존 서명 문서: 복원 과정에서 재작성하지 않고 읽기 전용으로 열며, 저장은 원본 바이트 복사로 제한한다.
- 양식 평탄화: 현재 외관 스트림을 확인할 수 있는 서명 없는 일반 AcroForm만 처리한다. 입력 기능을 제거하는 별도 선택이며 원본 파일은 덮어쓰지 않는다.
- 무손실 압축: QPDF 스트림 재압축, 이미지 리샘플링 없음. 20MiB/200쪽 제한. 결과가 더 크면 입력 바이트를 반환한다. 실제 품질/상호운용 실기검증은 미실시.

## 작성한 후속 회귀 시나리오 — 실행하지 않음

`npm run test:r33`에 3개 파일을 연결했다. 마지막 서명 시나리오는 Node 18+와 OpenSSL CLI가 필요하다. 실제 PDF 생성·한글 CID 수정·병합 셀 ZIP/OOXML·CMS 변조 거부·서명 원본 바이트 보존을 확인하도록 작성했다. 이 문서는 통과 보고가 아니다.

## 미구현 및 미수용 범위

`USR01-19_PROGRESS_CURRENT.md`의 다섯 핵심 소스 범위와 각 기능 행을 따른다. 관리자 기능/현재 운영 Worker/GitHub/main/Cloudflare/D1에는 쓰기 작업을 하지 않았다.
