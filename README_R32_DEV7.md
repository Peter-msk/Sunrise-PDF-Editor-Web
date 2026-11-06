# Sunrise PDF Editor(Web) R32-DEV7

R32-DEV6 전체 프로젝트를 기준으로 USR-13 인접 PDF 텍스트 조각 개인정보 형식 탐색, USR-16 3단 Word 변환, USR-18 Office 출력 변경 감지를 실제 코드에 반영한 개발 소스입니다.

- 개발 산출물: `src/` 내부 실제 수정, 기존 코드 유지.
- 변경 기록: `docs/R32_DEV7_IMPLEMENTATION.md`, `R32_DEV7_SOURCE_MANIFEST.json`.
- **매 차수 고정 진행률표**: `docs/USR01-19_PROGRESS_CURRENT.md` 및 JSON.
- **미실시**: 빌드, 테스트 실행, PDF 실기검증, CI, GitHub push, Cloudflare 배포.
- `dist/`는 새 코드가 반영되지 않은 구형 빌드입니다.
- OCR 기능은 제외이며 마스킹 후보 검색은 민감정보 완전 삭제를 증명하지 않습니다.
