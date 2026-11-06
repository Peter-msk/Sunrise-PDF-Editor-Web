# Sunrise PDF Editor(web) — 소스 개발 통합 마감 보고

- 기준일: 2026-11-07 (KST)
- 인수 기준선: R36-DEV1 전체 소스 ZIP
- 진행 방식: 기능군 통합 개발, GitHub/Cloudflare/D1 미변경

## 요구사항의 정확한 수용 범위

v1.2 요구사항은 관리자 14개 및 사용자 19개(33개), OCR 제외입니다.
**소스·회귀검사 경로 대응 33/33 = 100%**. 100%는 제품의 모든 문서 형식에서 완벽한 구현/수용을 뜻하지 않습니다.
전문 항목 USR-05/13/14/15/16은 원래 계획에서 기술 가능성 검토와 안전한 지원 범위를 정하도록 한 항목이므로, 고급 구조를 무조건 허용하는 대신 지원 범위를 코드가 검사하고 거부합니다.

## 이번 변경·추가 소스

1. `src/assets/sunrise-pdf-form-tools.js`, `src/assets/sunrise-pdf-finishing-ui.js`: 별도 PDF 양식 도구에 유효한 달력 날짜 ISO 8601 입력·편집·재열기 및 원본 불변 검증. 저장 후에도 날짜 메타데이터를 유지. 잘못된 2월 29일·월/일 범위와 여러 줄을 거부.
2. `src/assets/sunrise-pdf-form-tools.js`: 복수 PDF 병합, 분할, 재정렬 시 `/PageLabels` 번호 트리/접두사/스타일/시작 번호를 문서별 정확히 재계산. 원본 트리를 불변으로 유지하고 잘못된 트리는 오류로 중단.
3. `src/assets/sunrise-auto-bookmarks.js`, `src/editor/index.html`: 기존 저장 엔진의 32단 구조와 새 북마크 생성·정렬/들여쓰기/내어쓰기 UI의 제한을 통일. 시각적 들여쓰기는 8단까지만 증가해 좁은 화면에서도 조작할 수 있게 함.
4. `src/assets/sunrise-content-editor.js`: 내장 Encoding/ToUnicode 스트림의 `/UseCMap` 상속 및 부모 매핑의 안전한 로컬 override. 순환/중첩/중복 매핑·불완전 코드·외부 이름 CMap은 원문 편집에서 거부.
5. `tests/source-closeout-functionality.cjs`, `tests/source-closeout-inherited-cmap.cjs`: 실제 PDF 생성·소스 바이트 보존·저장·재열기·실패 경계 테스트.
6. `scripts/source-feature-audit.cjs`, `docs/SOURCE_FEATURE_SCOPE.json`, `docs/SOURCE_FEATURE_AUDIT.md`, `docs/SOURCE_CURRENT_STATUS.md`, `package.json`: 33개 기능 ID·실제 소스·검증 스크립트 대응 및 자동 현황 출력. `npm test` 끝에 신규 테스트 추가.

## 이번 검증 결과

- `npm run source:verify`: PASS (97개 독립 Node 검사 호출 + 진행률 정합성 확인).
- 추가 실제 PDF 엔진 테스트: 날짜 생성/변경/날짜 오류 차단, 페이지 레이블 이식·재열기, 32단 목차, 상속 CMap 재편집 및 원본 불변 PASS.
- `npm run dist:preview` / `npm run dist:verify`: PASS. 41개 로컬 자산 참조 검사 PASS. **운영 배포 금지 미압축 프리뷰만 생성.**
- 소스·회귀검증 100% 통과 판정은 **현재 환경에서 실행한 Node 테스트에 한정**. CI·실브라우저·정식 빌드는 이번 단계 대상이 아닙니다.
- 기존 `docs/development-progress.json`의 과거 구현률 81.6%를 임의로 100%로 수정하지 않았습니다. 소스-테스트 연결률과 과거 추정 구현률은 서로 다른 지표입니다.

## 다음 단계로 이관 (현재 요청에 따라 미실행)

1. 소스 마감본을 GitHub 기준선에 정합 통합하고 공식 4개 CI를 확인합니다.
2. Windows Chrome/Edge, Android/iOS, 외부 실무 PDF 및 Office 프로그램에서 실제 저장/재열기·복원/표시를 검증합니다.
3. 발견 결함에 한해 수정합니다. 검증 없이 완료로 처리하지 않습니다.
4. 실기검증 후 Cloudflare 정식 빌드·D1 백업·격리 복원·배포승인/롤백 검증을 수행합니다.

## 기술적으로 불가능하거나 범용 검증이 없는 지원 경계

- 원문: 외부 이름 CMap/모든 Type3·기형 글꼴, 자동 문단 재흐름 일반화는 지원하지 않습니다.
- 양식: XFA 자동 실행 및 PDF JavaScript 자동 계산은 임의의 외부 문서에서 안전한 동작을 보장할 수 없어 거부합니다.
- 서명: 일반 CMS 승인 서명과 PAdES LT/LTA 및 신뢰된 TSA/OCSP/CRL을 동일한 기능이라고 주장하지 않습니다.
- 변환: Word·Excel은 편집 가능한 텍스트/표/개별 이미지 중심이며 복잡한 벡터 PDF 100% 동일 복원을 보장하지 않습니다.
- 마스킹: 지정 영역을 새 PDF의 래스터 픽셀로 출력하고 원문 PDF 데이터는 이식하지 않습니다. 지정되지 않은 PII 자동 탐지는 OCR 제외 조건 및 검증 범위 밖입니다.

**판정:** v1.2의 사용자·관리자 기능 ID 전부가 구현 소스와 회귀검사에 연결됐으며, 소스 마감 후보로 인계합니다. 외부 호환성·정식 빌드·실기·운영 배포 및 전문 PDF의 무제한 호환은 완료 판정에 포함하지 않습니다.
