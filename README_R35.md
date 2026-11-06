# Sunrise PDF Editor Web — R35-DEV1

**현재 상태: 소스 개발 및 계약 검사 92/93 PASS. 최종 빌드·운영 배포 미완료.**

R34-DEV1의 전체 원본 소스를 기초로 신규 R35 CMap 원문 편집, PDF 마스킹 오류 수정, 과거 테스트 환경 복구를 수행했다. 이전 R34 원본과 검증 증빙은 보존했다. `dist/`는 R34 이후 기능을 포함하지 않는 과거 산출물이며 R35 빌드 전 배포에 사용하지 않는다.

- 신규 혼합 1·2바이트 CMap: `src/assets/sunrise-content-editor.js`, `tests/r35-variable-cmap.cjs`.
- 마스킹 PDF 구조 점검 수정: `src/assets/sunrise-special-pdf.js`.
- R34 검증 이력 보존: 부분 재검사에서는 `docs/R34_VALIDATION.json`을 덮어쓰지 않음.
- 전체 검사 93개 중 92개 PASS, 1개는 `terser@5.51.2` 미설치로 인한 빌드 기반 검사 FAIL. 확인: `docs/R35_VALIDATION.json`.
- 원본 서명/양식/Office 등 R34 기능은 그대로 유지하며 **OCR은 범위 제외**.

## 다음 인수 시 첫 단계

1. 고정 의존성을 설치한다: `npm ci --ignore-scripts` (Node 18+; 인터넷/사내 패키지 미러 필요).
2. `npm test`를 다시 실행해 93/93 확인한다. `npm run progress:check` 실행 후 `npm run build`로 실제 `dist/`를 생성한다.
3. 실제 브라우저 PDF 열기·원문 편집·저장·재열기, 빌드 시 보안/해시/CI/독립 뷰어/Office 실기 확인.
4. 남은 근본 기능: 외부/상속 CMap과 문단 재흐름, XFA/스크립트 양식과 특수 구조, 장기검증 PAdES, 범용 고충실도 Office 변환.
5. GitHub R16~R25 미병합 PR 이력을 재확인하고 R34/R35 변경을 보존하는 통합 브랜치를 만든 후 CI 성공 시에만 릴리스한다.

GitHub, Cloudflare Worker, D1 운영 데이터는 R35에서 변경하지 않았다.
