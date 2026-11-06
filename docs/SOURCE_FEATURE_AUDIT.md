# Sunrise PDF Editor — 소스 기능 추적·수용 현황

**기준:** v1.2 (OCR 제외). GitHub·Cloudflare·실브라우저 수용 전 소스 인계용.

**필수 기능 ID별 소스·회귀검사 연결: 33/33 (100.0%).** 이는 전체 기능이 실무의 모든 PDF에서 검증됐다는 뜻이 아닙니다.

과거 관리 점수 81.6%는 이전 작성일의 추정치이며, 이 파일의 33/33은 그 점수의 단순 상향이나 배포 준비율이 아닙니다.

| ID | 기능 | 소스 | 계약검사 | 구현 계약 |
|---|---|---|---|---|
| ADM-01 | 운영 홈·KPI | `src/admin-api.mjs` | `tests/admin-metrics-contract.cjs` | 기본 기능 |
| ADM-02 | 방문 통계 | `src/admin-api.mjs` | `tests/telemetry-day-boundary.cjs` | 기본 기능 |
| ADM-03 | 활성 사용시간 | `src/admin-api.mjs` | `tests/telemetry-foreground-idle.cjs` | 기본 기능 |
| ADM-04 | 기능 실패율 | `src/admin-api.mjs` | `tests/admin-quality-sessions.cjs` | 기본 기능 |
| ADM-05 | 문의 처리 | `src/admin-api.mjs` | `tests/admin-inquiry-atomic.cjs` | 기본 기능 |
| ADM-06 | 공지 운영 | `src/admin-api.mjs` | `tests/admin-publications.cjs` | 기본 기능 |
| ADM-07 | 업데이트 운영 | `src/admin-api.mjs` | `tests/admin-publication-csv-lifecycle.cjs` | 기본 기능 |
| ADM-08 | 서비스 상태 | `src/worker.mjs` | `tests/admin-operational-health.cjs` | 기본 기능 |
| ADM-09 | 버전·배포 보고 | `src/admin-api.mjs` | `tests/admin-version-metadata.cjs` | 기본 기능 |
| ADM-10 | 보존·백업 | `scripts/d1_backup.cjs` | `tests/admin-retention-restore.cjs` | 기본 기능 |
| ADM-11 | 관리자 인증 | `src/admin-password-auth.mjs` | `tests/admin-password-auth-contract.cjs` | 기본 기능 |
| ADM-12 | 이용 품질 | `src/admin-api.mjs` | `tests/admin-save-quality.cjs` | 기본 기능 |
| ADM-13 | 통계 CSV | `src/admin-api.mjs` | `tests/admin-statistics-export.cjs` | 기본 기능 |
| ADM-14 | 운영 알림 | `src/admin-api.mjs` | `tests/admin-operational-health.cjs` | 기본 기능 |
| USR-01 | 병합 | `src/assets/sunrise-pdf-form-tools.js` | `tests/source-closeout-functionality.cjs` | 기본 기능 |
| USR-02 | 분할·추출 | `src/assets/sunrise-batch-pages.js` | `tests/batch-split-merge.cjs` | 기본 기능 |
| USR-03 | 페이지 관리 | `src/assets/sunrise-page-composer.js` | `tests/page-atomic-publish.cjs` | 기본 기능 |
| USR-04 | 텍스트 삽입 | `src/assets/sunrise-pdf-overlay.js` | `tests/overlay-table-shape-annotation.cjs` | 기본 기능 |
| USR-05 | 기존 PDF 원문 수정 | `src/assets/sunrise-content-editor.js` | `tests/source-closeout-inherited-cmap.cjs` | 검증된 안전 범위 |
| USR-06 | 표·도형 편집 | `src/assets/sunrise-pdf-overlay.js` | `tests/overlay-table-shape-annotation.cjs` | 기본 기능 |
| USR-07 | 주석·형광펜 | `src/editor/index.html` | `tests/native-annotation-edit.cjs` | 기본 기능 |
| USR-08 | 목차·북마크 | `src/assets/sunrise-auto-bookmarks.js` | `tests/source-closeout-functionality.cjs` | 기본 기능 |
| USR-09 | 압축 | `src/editor/index.html` | `tests/pdf-compression-contract.cjs` | 기본 기능 |
| USR-10 | AcroForm 양식 | `src/assets/sunrise-pdf-form-tools.js` | `tests/source-closeout-functionality.cjs` | 기본 기능 |
| USR-11 | 다중 일괄 작업 | `src/assets/sunrise-batch-pages.js` | `tests/batch-stress-cancel.cjs` | 기본 기능 |
| USR-12 | 제출 전 품질 점검 | `src/assets/sunrise-pdf-quality.js` | `tests/pdf-submission-quality.cjs` | 기본 기능 |
| USR-13 | 민감정보 마스킹 | `src/assets/sunrise-special-pdf.js` | `tests/multipage-mask-audit.cjs` | 검증된 안전 범위 |
| USR-14 | PDF 암호화 | `src/assets/sunrise-pdf-protect.js` | `tests/pdf-encrypt-local-contract.cjs` | 검증된 안전 범위 |
| USR-15 | 인증서 CMS 서명 | `src/assets/sunrise-pdf-cms.js` | `tests/r33-signature-integrity.cjs` | 검증된 안전 범위 |
| USR-16 | Word·Excel 변환 | `src/assets/sunrise-office-export.js` | `tests/r34-mixed-word.cjs` | 검증된 안전 범위 |
| USR-17 | 텍스트·이미지 추출 | `src/assets/sunrise-embedded-images.js` | `tests/embedded-image-extraction.cjs` | 기본 기능 |
| USR-18 | 안전한 저장·재열기 | `src/assets/sunrise-edit-state.js` | `tests/save-safety-contract.cjs` | 기본 기능 |
| USR-19 | 모바일 UI | `src/editor/index.html` | `tests/page-jump-race-contract.cjs` | 기본 기능 |

## 전문 PDF 지원 경계 — 소스 단계 결정

- **USR-05:** 지원 글꼴·내장 CMap·상속 스트림 한정. 미등록 외부 이름 CMap 및 임의 문단 재흐름 불가.
- **USR-13:** 사용자 지정 영역의 래스터 재작성; 누락된 민감정보 자동 검출이나 인증된 완전 삭제를 주장하지 않음.
- **USR-14:** 지원 가능한 QPDF WASM AES 범위. 실제 브라우저·외부 뷰어 수용은 다음 단계.
- **USR-15:** 기본 CMS 승인서명 지원, PAdES LT/LTA·외부 신뢰증명은 별도 검증 기능이며 완료 주장 금지.
- **USR-16:** 텍스트·표·이미지 및 제한된 레이아웃 변환. 모든 PDF의 원본 모양 완전 복원 불가.

## 다음 단계로 이관할 검증 (이번 소스 개발 범위 제외)

정식 고정 의존성 빌드, 독립 PDF 뷰어·Office 프로그램·Windows/Android/iOS 실기, Github CI와 Cloudflare 운영 배포, 원격 D1 안전검증.

**확인 방법:** `npm test`로 회귀 실행, `npm run source:audit`로 33개 경로·증빙 연결 정합성 확인. 실제 통과 결과는 별도 검증 기록 참조.
