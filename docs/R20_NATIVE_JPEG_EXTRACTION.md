# R20 · USR-17 PDF 내장 JPEG 원본 추출

## 기존 계획과 범위

2026-10-31 확정 v1.2의 USR-17(이미지·텍스트 추출)에서 기존 PDF.js 화소 → PNG 재인코딩 외, **JPEG DCTDecode 이미지의 PDF 내장 원본 바이트를 JPG로 추출**하는 기능을 추가했다. 새 기능은 사용자가 웹 편집기의 기존 "내장 이미지 추출" 모달에서 PNG 또는 원본 JPG 방식을 선택한다.

## 구현 계약

- `src/assets/sunrise-embedded-images.js`에 `extractOriginalJpegs(pdfBytes,{PDFLib,onImage,...})` 추가. 이미 포함된 pdf-lib만 활용하고 새 패키지는 추가하지 않는다.
- PDF 페이지 `/Resources /XObject`에서 직접 참조하는 `/Subtype /Image` 및 단일 `/Filter /DCTDecode`를 검사한다. 유효한 JPEG SOI/EOI와 양수 Width/Height를 확인하고 원본 JPEG 스트림을 **재압축 없이 복사**해 `image/jpeg`로 제공한다.
- 원본의 같은 간접 이미지 자원을 여러 페이지가 공유할 경우 한 번만 내보낸다.
- 기존과 같은 최대 100쪽, 20개 이미지, 각 1,677만 화소, 출력 누적 60MiB 보호 한도를 유지한다. 페이지 범위(현재/전체), 중간 취소, 진행률·제외 건수도 유지한다.
- 마스크(`/SMask`, `/Mask`), 사용자 `/Decode`, `/DecodeParms`, 여러 필터 및 JPEG가 아닌 이미지·특수 객체는 JPG로 위장하지 않고 제외한다.
- 사용자가 PDF 문서를 바꾸면 변경 전 바이트에 대한 다운로드 후보 게시를 중단한다. 원본 PDF는 수정하지 않으며 서버 업로드도 없다.
- PDF 내부의 페이지 **자원**을 열거하므로 화면에 실제로 배치되지 않은 자원 JPEG가 발견될 수 있다. 중첩된 Form XObject 내부 자원은 탐색하지 않는다. 원본 JPEG는 색상 프로파일·PDF 렌더링 효과와 픽셀상 일치하지 않을 수 있다. PDF 구조 전체, 고급 JPX/JBIG2, ICC/CMYK 변환, OCR/민감정보 삭제는 지원 범위가 아니다.
- `tests/native-jpeg-extraction.cjs`는 실제 pdf-lib DCT JPEG 임베딩 PDF를 생성하고 동일 바이트 추출, 중복 참조, 현재 쪽, 취소, JPG 아닌 필터·마스크·PNG 제외, UI 연결을 검증한다.

## 배포·진행률

R19 기반 개발 PR에서만 변경한다. R15 운영 `main`, Cloudflare, D1 미변경. 자동 검사 PASS가 실제 업무 PDF, 타 뷰어·모바일 수용까지 완료했다는 뜻은 아니다. USR-17 원천 진행률은 수용 증빙 없이 임의로 100% 처리하지 않는다.
