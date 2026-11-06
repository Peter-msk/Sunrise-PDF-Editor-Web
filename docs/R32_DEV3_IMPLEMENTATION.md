# Sunrise PDF Editor(Web) — R32-DEV3 구현 인수

## 실제 제품 소스 변경

- `src/assets/sunrise-pdf-cms.js` **신규**: X.509 DER 판독, PKCS#8 RSA 공개키 대조, CMS `SignedData` DER 생성, PDF `/Sig` 양식 필드, `/Contents` 예약 및 `/ByteRange` 고정 길이 수정, 로컬 WebCrypto RSA-SHA256 서명, 원문 범위 무결성 자체확인.
- `src/editor/index.html` **수정**: `signWithCertificatePem` 명령, 서명 화면, PEM 파일 선택, 상태 변경 감지, 원본 보존, 새 PDF 다운로드. 인증서·개인키를 서버로 보내지 않고 개인키 값을 저장소에 기록하지 않음.
- `src/assets/sunrise-tool-hub.js` **수정**: 도구 검색에서 인증서 서명 발견 가능.
- `scripts/build-release.cjs` **수정**: 향후 승인된 빌드시 CMS 모듈을 `dist/assets/`로 포함하도록 복사 목록 보강. **이 차수에서 빌드 실행 안 함.**
- `tests/cms-signature-practical.cjs` **신규**: 향후 승인된 실기검증 시 OpenSSL CMS 분리 서명 검증 예제. **미실행**.

## 지원 범위 (Source authored, NOT practically verified)

| 기능 | DEV3 구현 | 미지원 또는 남은 검증 |
|---|---|---|
| USR-15 서명 구조 | PDF `/Sig`, `/FT /Sig`, `/ByteRange`, `/Contents`, `adbe.pkcs7.detached` | PDF 뷰어 간 인증서 서명 표시·호환성 실기검증 |
| CMS 서명 | ASN.1 DER CMS SignedData, RSA PKCS#1 v1.5 / SHA-256 | 공개 CA 신뢰·인증서 폐기 상태, 타임스탬프, PAdES 규격 완성 |
| 인증서·키 입력 | PEM X.509, PKCS#8 RSA 2048~4096비트, 브라우저 메모리만 사용 | PKCS#12(PFX/P12), 공동인증서 저장소, 비밀번호로 암호화된 개인키, 스마트카드 |
| 원본 PDF | 25MiB 이하, 1~200쪽, 미암호화·미서명·AcroForm 없는 문서 | 기존 서명 유지 증분서명, 기존 양식·암호화 PDF 서명, 대용량 PDF |
| 보안정책 | 키 일치 확인, 인증서 유효기간 확인, 기존 서명 우회 금지, 새 파일 다운로드 | 인증서 체인 검증·OCSP/CRL, 정책상 법적 효력 판단 |
| USR-14 | 기존 로컬 QPDF AES-256 경로 보존 | **브라우저 AES-256 PDF 암호화 엔진 미개발. DEV3 구현 아님.** |

## 상태 및 위험

- 편집기 `dist/`는 기존 DEV2 이전 배포 파일 그대로입니다. 새 서명 기능을 사용하려면 승인된 빌드가 필요합니다.
- 사용자 요청에 따라 소스 작성만 수행했습니다. **Node.js 실행, 테스트 실행, 서명 PDF 생성 및 OpenSSL 검증, 빌드, CI, GitHub, Cloudflare 배포를 하지 않았습니다.**
- CMS/ASN.1 및 PDF 형식은 상호운용성 민감 영역입니다. 제품에서 사용하려면 실제 공개키 검증 도구와 복수 PDF 뷰어를 통한 독립 검증이 필수입니다.
- 개인키 PEM은 브라우저의 선택 파일에서만 읽습니다. 테스트용 키나 실사용 인증서·비밀번호를 GitHub에 저장하거나 이 대화에 업로드하지 마세요.

## 향후 우선 개발

1. USR-15 PEM 기준 실제 OpenSSL/Acrobat/PDF.js 호환 확인, P12/공동인증서 처리 검토, 서명 신뢰·타임스탬프·폐기 상태 검증.
2. USR-14는 암호화 PDF 표준 적합성이 필요한 보안 기능. 기존 로컬 QPDF를 재사용하거나 보안 검증된 WASM/표준 라이브러리 채택 후 웹에 통합하고, 올바른 비밀번호·틀린 비밀번호·원본 동일성의 독립 교차 검증을 통과해야 완료.
3. USR-05 한글 CID/임베디드 원문 수정, USR-13 누락 민감정보 감지, USR-16 이미지/도형/복합 표 복원.
