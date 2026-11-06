# Sunrise PDF Editor Web — R34-DEV1

변경 부분의 문법 8/8, 기능 실행 19개 검사 묶음 통과. 전체 기능 완료 또는 최종 배포물은 아니다.

- 최신 기능/미구현: `docs/USR01-19_PROGRESS_CURRENT.md`
- 구현 인계: `docs/R34_IMPLEMENTATION.md`
- 검사 원문: `docs/R34_VALIDATION.json`
- 소스 차이 및 SHA-256: `docs/R34_SOURCE_MANIFEST.json`
- 표적 검사: `npm run test:r34`

일반 PDF/AcroForm 보완, 중첩 객체·내장 CMap·세로쓰기, 증분 서명, 다중 표 및 편집 가능한 혼합 Word를 추가했다. 외부 이름 CMap·범용 재흐름·XFA·장기 검증 서명·모든 복합 문서 복원은 여전히 남아 있다. 기존 `dist/`는 새 소스로 빌드하지 않았다. 운영 배포·CI·브라우저/모바일 실기를 수행하지 않았다.
