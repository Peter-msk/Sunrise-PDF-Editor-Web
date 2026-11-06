# Sunrise PDF Editor(Web) — R32-DEV4 제품 소스 개발

## 이번 기능: USR-14 브라우저 PDF 열기 암호 AES-256

- **실제 변경**: 새 JS 보호 엔진과 Worker, 기존 편집기의 `protectPdfAes256` 명령·입력창, 도구 검색 카드, 별도 파일 다운로드, 향후 빌드에 QPDF WASM 자산 포함 규칙을 연결했습니다.
- **재사용 구현체**: `pdfstudio` npm **0.4.0**의 QPDF WebAssembly. 프로젝트의 `pdf-lib`는 암호화 출력을 지원하지 않으므로 암호 알고리즘을 독자 제작하지 않았습니다.
- **데이터 경계**: HTTPS/localhost 같은 보안 컨텍스트, 동일 출처 자산(`/assets/pdfstudio/`), 브라우저 전용 Worker; PDF와 암호를 API에 업로드하지 않음. 서버에 암호 저장·동기화 없음.
- **입력 제한**: PDF 20MiB 이하, 200쪽 이하, 미암호화 PDF, 서명·기존 AcroForm·Perms 없는 문서. 암호 12자 이상, UTF-8 127바이트 이하, NUL 금지.
- **실행 경로**: 편집 문서 상태 캡처 → 새 바이트 생성 → 서명·양식·암호 유무 확인 → Worker로 PDF 사본 전달 → `pdfstudio.lock({keyLength:256})` → 암호화 플래그·열기 암호 필요 여부·AESv3/256비트·페이지 수 비교 → **새 파일 다운로드**.
- **보존 정책**: 기존 편집기 문서·원본 PDF 불변. 취소 시 Worker 종료. 오류·검증 불일치 시 출력 게시 거부. 비밀번호는 DOM에서 즉시 지우며 파일·스토리지·로그에 기록하지 않음. JS 문자열은 GC 전 즉시 메모리 소거를 보증할 수 없음.
- **별도 비밀번호**: 사용자 열기 암호와 소유자 암호를 동일하게 설정하고, **인쇄·복사·편집 제한을 기능으로 제공하지 않음**. 제한 옵션은 PDF 뷰어마다 강제 여부가 다르기 때문.

### 변경 파일

| 파일 | 목적 |
|---|---|
| `src/assets/sunrise-pdf-protect.js` | 브라우저 비밀번호 입력 검증, 복사, Worker, 취소, 출력 메타데이터 검증 |
| `src/assets/sunrise-pdf-protect-worker.js` | QPDF WASM AES-256 처리, 암호 필수 및 페이지 수 검사 |
| `src/editor/index.html` | 보안 메뉴·명령·암호 설정 창·원본 보존·저장 연결 |
| `src/assets/sunrise-tool-hub.js` | PDF 암호 보호 기능 검색 카드 |
| `scripts/build-release.cjs` | 설치된 pdfstudio 0.4.0의 JS·WASM을 동일 출처 정적 자산으로 복사 |
| `package.json`, `package-lock.json` | 정확한 런타임 의존성 버전 0.4.0 선언 |
| `tests/usr14-wasm-aes256-practical.cjs` | 향후 독립 실제 PDF 암호화·오류 암호·원본 보존 확인 |
| `tests/usr14-web-integration-contract.cjs` | 향후 UI·자산·Worker 연결 계약 확인 |

### 중요: 미완료 항목 및 실행 정책

- 이번 **코드 작성과 복사된 전체 소스**만 완료. **`npm ci`, 빌드, Node 테스트, 브라우저 실기검증, QPDF 실제 파일 출력, GitHub/Cloudflare 반영은 실행하지 않았습니다.**
- **WASM 파일은 이 ZIP에 포함되지 않습니다**. 외부 npm 패키지 설치 권한이 필요한 별도의 검증/빌드 단계입니다. 소스에는 설치 의존성과 복사 규칙을 작성했습니다. 설치·빌드 전의 기존 `dist/`에는 DEV4 기능이 없고, 실행 시 사용할 수 없습니다.
- 정확한 PDF 암호화 완료 여부는 **pdfstudio/qpdf WebAssembly 설치 후 실제 암호화 PDF를 만들고, `qpdf --check`, `--show-encryption`, 올바른 비밀번호 열기, 잘못된 비밀번호 차단, 독립 뷰어에서 페이지 내용·첨부·북마크 보존**을 확인한 뒤 판정합니다.
- 해당 기술의 라이선스: Apache-2.0 (기반 QPDF 포함). 공개 서비스용 의존성 검증·라이선스 공지·공급망 검증 필요. `package-lock.json`에 등록한 의존성의 registry integrity는 현재 환경에서 별도 조회하지 못했으므로 승인된 설치 과정에서 확인해야 합니다.
- 실사용 인증을 받기 전까지 보안 메뉴에 **실험 기능** 안내를 유지해야 합니다.

### 향후 승인된 검증 절차 (이번에는 실행하지 않음)

```bash
npm ci
node tests/usr14-web-integration-contract.cjs
node tests/usr14-wasm-aes256-practical.cjs
npm run build
```

브라우저에서 독립 PDF 뷰어(Adobe Acrobat 등)를 통한 암호 필요·페이지 수·내용 보존 검증이 추가로 필요합니다.

### 다음 개발 대상

- **USR-15** PEM RSA CMS 경로의 실제 독립 검증, P12·공동인증서 지원, 인증서 체인·유효성 검증·PAdES.
- **USR-05** CID 및 한글 글꼴 직접 수정은 PDF 객체·폰트 재인코딩 처리 없이는 안전한 일반화 불가.
- **USR-16** 복합 표와 이미지/도형 레이아웃 복원.
- **USR-13** 민감정보 사전 탐지·누락 경고 및 완전삭제 독립 검증.
