# Sunrise PDF Editor(web) — R36-DEV1 (2026-11-06)

R35-DEV1 기능 소스를 보존하면서 **릴리스 막힘 원인 분리, 검증용 통합 자산 생성, 진행률 상시 출력 및 배포 안전장치**를 보강한 개발본이다. **운영 배포본이 아니다.**

## 빠른 명령

```bash
npm run status            # 관리자 14 / 사용자 19 전체 진행률·근거·제약
npm test                  # 94개 Node 계약 호출 (네트워크 없이 실행)
npm run progress:check    # 기존 공식 진행률 데이터 정합성
npm run dist:preview      # 명시적으로 미압축 검증용 dist 생성
npm run dist:verify       # dist 로컬 에셋과 고정 vendor 무결성
npm ci --ignore-scripts   # 운영 릴리스 빌드 전 필수. 현재 격리 환경은 EAI_AGAIN
npm run build             # terser 고정 버전이 설치된 환경에서만 실제 릴리스 빌드
```

**배포 전 절대 조건:** `dist/SUNRISE_PREVIEW_ONLY.json`이 존재하면 GitHub/Cloudflare에 배포하지 않는다. 정식 `npm run build`가 성공하면 마커가 사라진다. CI 검증과 D1 백업·격리 복원, 운영 자격증명이 별도로 필요하다.

자세한 구현 및 검증: `docs/R36_CLOSEOUT.md`, `docs/R36_VALIDATION.json`, `docs/R36_CURRENT_STATUS.md`.
OCR은 제외. 기존 R35 기능 및 소스 무결성 검증 내용 보존. 전체 기능 완료, 브라우저/Office 실기 통과, 운영 배포 완료를 주장하지 않는다.
