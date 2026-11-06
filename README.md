# Sunrise PDF Editor(Web) — v1.2 소스 기능 마감 후보

이 저장 디렉터리는 R36 전체 소스의 개발 연속본입니다. **GitHub 통합·Cloudflare 운영 배포는 미실행**입니다.

## 소스 단계 상태

- v1.2의 사용자 19 + 관리자 14 = 33개 기능 ID를 모두 소스/계약검사로 연결했습니다: `docs/SOURCE_FEATURE_AUDIT.md`.
- 이번 통합 수정: **AcroForm 날짜 입력/수정**, PDF **페이지 레이블 보존 이식**, **32단 북마크 편집**, **내장 /UseCMap 상속 글꼴 원문 수정**.
- 검증: `npm run source:verify` (97개 Node 테스트 명령 + `progress:check`); `npm run dist:preview`, `npm run dist:verify`는 **검증용 미압축 배포물**만 만듭니다.
- 이 수치(33/33)는 기능 ID별 **소스·검사 경로 완비율**이지 모든 PDF 호환, 모든 세부 구현의 인증 완료율, 또는 실브라우저 배포 완료율이 아닙니다.
- OCR은 제외. 미지원 고급 PDF 구조는 안전하게 오류로 중단하는 정책을 유지하며 기존 v1.2 '연구·안전 범위'와 구분합니다.

## 실행 및 검사

```sh
npm ci --ignore-scripts
npm run source:verify
npm run source:audit
npm run status
npm run build
```

고정 의존성 `terser@5.51.2` 등의 설치가 가능한 환경에서만 정식 빌드가 가능합니다. 이 산출물의 `dist/SUNRISE_PREVIEW_ONLY.json`이 있으면 **절대 운영 배포하지 마세요**. 프리뷰 빌드와 릴리스 배포 차단 테스트는 유지됩니다.

소스 인계와 제한 사항: `docs/SOURCE_COMPLETION_HANDOFF.md`. 이전 자료: `README_R35.md`, `README_R36.md`, `docs/R36_CLOSEOUT.md`.
