# Sunrise PDF Editor (Web) — R35-DEV1 개발 인계

기준: 2026-11-06. 시작점은 R34-DEV1 전체 소스 ZIP이다.  `README_R34.md`와 `docs/R34_IMPLEMENTATION.md`에 명시된 선행 기능 및 한계는 유지한다.

## 구현 내용

### 1. USR-05 내장 가변 길이 CID CMap

- 내장 `Encoding` CMap의 코드 공간 선언을 읽어 1~4바이트 원문 코드를 검증하고, 안전하게 혼용된 길이의 코드를 순차 해석한다.
- 범위 겹침·접두부 모호성·중복 CID·코드 공간 밖 매핑·너무 큰 범위를 거부한다. 다른 길이의 ToUnicode 코드 범위 끝점은 같은 길이여야 한다.
- 텍스트 교체 시 코드 공간에 포함되고 CID가 연결된 글리프만 대상으로 허용한다. 역방향 Unicode가 하나로 결정되지 않으면 변경을 중단한다.
- 고정 길이 CMap/Identity-H/Identity-V의 기존 경로 및 구형 숫자 키 매핑을 유지한다.
- 새 테스트 `tests/r35-variable-cmap.cjs`: 실제 pdf-lib PDF를 1·2바이트 혼합 코드/한글로 구성한 뒤 원문 발견, 교체, 저장 후 재열기, 입력 원본 불변을 검증. 모호한 접두부/중복 코드 공간/누락 또는 선언 밖 CID/잘못된 Unicode 원문 코드 방어를 포함한다.

### 2. USR-13 마스킹 결과 구조 검증

- `src/assets/sunrise-special-pdf.js`의 `PDFDict.size()`는 실제 pdf-lib PDFDict API가 아니므로 오류가 발생했다.
- `PDFDict.keys().length`로 객체 수를 검증하도록 수정. 기존 기대 이미지 객체가 1개인지 검사하는 보안 계약은 유지했다.
- `tests/special-pdf-guard.cjs`, `tests/multipage-mask-audit.cjs`를 재실행해 PASS.

### 3. 검사 계약과 이력 보존

- 북마크·페이지 작업 테스트의 VM 격리 환경에 필요한 페이지 문맥·outline API·`console.error` 스텁을 추가.
- 예외를 UI에서 잡아 표시하는 작업은 `rejects`가 아니라 알림 발생·원본 불변을 검증하도록 계약을 변경.
- `scripts/verify-r34.cjs --new-only`가 과거 `docs/R34_VALIDATION.json`을 덮어쓰던 동작을 중단하고 **원본 R34 기록을 ZIP과 바이트 단위 동일하게 복원**. 전체 재실행 모드는 기존처럼 R34 기록을 갱신한다.

## 검증 결과

- `docs/R35_VALIDATION.json`: `package.json`의 `npm test` 체인을 93개 독립 호출해 전부 시도. **92 PASS, 1 FAIL** (빌드 기반 `tests/build-line-endings.cjs`만 `Cannot find module 'terser'`). 수행 26.7초.
- R34 `--new-only` 재검사 13/13, 문법 8/8 PASS. 별도 `npm run progress:check` PASS.
- `npm run build`는 `terser@5.51.2` 부재로 실패. `npm ci --ignore-scripts --offline`은 캐시가 없어 실패했고 온라인 시도도 성공하지 못함. **R35 dist 새로 생성하지 못함**.
- 독립 외부 PDF/Word/Excel 실기, Linux/Windows 실브라우저, Android/iOS, 서버/Workers 실기, CI, D1 복구 검증, Cloudflare 운영 배포는 수행하지 않았다.
- `dist/`는 과거 배포물. R35 소스 ZIP에 포함되지만 **R35 기능을 담은 신규 빌드가 아니다.**

## 남은 개발/릴리스 경계

1. USR-05: 외부 이름/상속된 CMap, Type3/다양한 글꼴, 복잡 문단 재흐름은 아직 미구현.
2. USR-01/02/10: XFA와 PDF 스크립트/자동 계산 양식, 태그·특수 구조를 보존하는 모든 페이지 조작은 미구현.
3. USR-15: OCSP/CRL, 신뢰 TSA, PAdES LT/LTA, 인증 서명 및 필드 잠금 완성은 미구현.
4. USR-16: 임의 복합 문서의 글꼴·벡터·회전/잘림 이미지·레이아웃을 완전 복원하는 Office 변환은 미구현.

실제 코드 작업 이외의 기능 완료율 또는 실서비스 배포율은 증빙 없이 상향하지 않았다. OCR 개발은 하지 않았다. GitHub/Cloudflare/D1에는 쓰지 않았다.
