# R10 통합 소스 안내

R09 누적본에 R10 UI 중복 실행 차단 및 PDF 겹치기 이중 정규화 오류 수정, 독립 Chromium 실기 검증 스크립트와 결과 기록을 추가한 **전체 소스본**입니다.

- 이 ZIP은 정식 배포용 빌드가 완료된 패키지가 아닙니다. `src/` 수정본이며 `dist/`는 npm 릴리스 빌드 전에 재생성되지 않았습니다.
- G03 대표 기능 12종 UI 파일 입력 → 처리 → 결과물 확인 PASS. 새 스크립트 검증은 `docs/R10_STAGE2_VALIDATION.md` 참조.
- `npm ci` 및 `npm run build`는 외부 npm 접근 제한으로 미완료. 운영 D1/Worker 및 GitHub 미변경.
- Python 브라우저 테스트는 설치된 Chromium/Playwright/PyMuPDF/Pillow를 사용합니다.

진행률: 1단계 100% · 2단계 67%(6개 영역 중 4개 완료) · 3단계 0%.
