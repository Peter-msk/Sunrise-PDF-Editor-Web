# USR-18 — 일반 PDF 저장 전 페이지 구조 무결성 검사

## 목적과 변경 위치
- 웹 편집기 `src/editor/index.html`의 일반 **다른 이름으로 저장** 및 **이미지 압축 후 저장** 경로에서, 출력 PDF가 생성되었다는 이유만으로 다운로드 링크를 노출하지 않도록 한다.
- 출력 PDF를 PDF-lib로 다시 열고, 현재 편집 문서의 저장 스냅샷과 **페이지 수, 회전, MediaBox/CropBox/BleedBox/TrimBox/ArtBox의 좌표·크기**를 비교한다.
- 페이지 수 변경·페이지 박스 손상·잘못된 PDF 바이트·파일 크기 제한 초과 시 Blob URL 생성 이전에 저장 준비를 실패시킨다. 원본 파일 및 편집 중 상태는 유지한다.
- 기존 일괄 압축 `verifyBatchPdfStructure`와 페이지 구조 비교 코드를 공유하되, 일괄 압축 특유의 양식/문서 루트 검사 계약은 그대로 유지한다.

## 회귀 검사
- `node tests/saved-pdf-preflight.cjs`: 원본과 동일한 출력 허용; 페이지 감소/회전 변경/CropBox·TrimBox 손상/파싱 실패 거부 및 원본 불변 검사
- `node tests/save-safety-contract.cjs`: 출력 무결성 검사가 실패하면 다운로드용 Blob URL을 게시하지 않고 기존 dirty 상태를 유지, 정상 재시도 후 다운로드 확인 검사
- 기존 `tests/batch-compress.cjs`, `tests/batch-compress-disk-roundtrip.cjs`, `tests/batch-watermark-page-number.cjs` 등 회귀를 유지
- GitHub Actions 전체 검증 및 실제 브라우저 시험 결과는 PR에 별도로 기록

## 검사의 경계
- 원본과 출력의 **모든 텍스트, 이미지 픽셀, 주석, 북마크, 양식 필드, 전자서명 유효성까지 완전 동일하다는 의미는 아님**.
- 기존 기능의 의도된 텍스트·페이지 내용 추가, 편집 삽입물 저장, 이미지 압축 효과는 이 단계에서 차단하지 않는다.
- 잘못된 스냅샷이나 변형된 페이지 구조에 대한 제한적 방어이며, 특수 PDF 전체를 지원한다는 뜻이 아니다.
- 운영 Cloudflare/D1과 `main`은 변경하지 않는다. OCR 제외. 새 기능은 Draft PR에서 검사한다.
