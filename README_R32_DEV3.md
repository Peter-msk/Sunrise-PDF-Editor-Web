# Sunrise PDF Editor(Web) — R32-DEV3

R32-DEV2 전체 프로젝트에서 출발한 **실제 소스 변경 개발본**입니다.

- USR-15: 브라우저 WebCrypto 기반 RSA-SHA256/CMS 분리형 PDF 전자서명 **코드 작성**
- 인증서 형식: X.509 PEM + 암호화되지 않은 PKCS#8 RSA PEM 개인키만 허용
- 기존 전자서명·AcroForm·암호화 문서: 서명 변환 거부
- 인증서 신뢰/폐기/PAdES/P12: 미지원
- 사용법(미검증 소스): 승인 빌드 후 편집기 > 편집·주석 > 인증서 전자서명(실험)
- 상세내용: `docs/R32_DEV3_IMPLEMENTATION.md`
- 진행률: `docs/R32_DEV3_FEATURE_PROGRESS.md`
- 원본: R32-DEV2 보존
- 이 패키지의 `dist/`는 이전 배포 파일입니다. DEV3 실행 가능한 빌드로 혼동하면 안 됩니다.
- 빌드·테스트·CI·브라우저 검증·GitHub·Cloudflare 작업은 수행하지 않았습니다.
