# USR-01~03 연속 개발: PDF 병합·분할·추출 및 페이지 상태 안전성

- 브랜치: `dev/v12-continuous-development-20261102`, 2026-11-02 KST.
- `src/assets/sunrise-outline-transfer.js`: 표준 PDF Outlines의 직렬화된 페이지 목적지를 안전하게 읽어 0-based 페이지 매핑으로 변환. 중첩 최대 4레벨, 최대 2000개 북마크, 이름 기반·외부 URI·JavaScript/미지원 GoTo 목적지는 결과에서 조용히 누락하지 않고 오류 처리.
- `src/editor/index.html`: 기존 PDF 병합/분할/추출 경로에 북마크 추출/페이지 매핑/출력 북마크 생성 연결. UI 지원 한계 문구 수정.
- 병합 도중 파일 큐 변경 감지 및 중복 병합 실행 방지. 편집기로 바로 열 결과는 기존 50MB PDF 제한 사전 확인.
- 페이지 복제·삭제·잘라내기·순서 변경은 PDF 저장 성공 전 Undo/원본 바이트/클립보드를 변경하지 않도록 순서 조정.
- `scripts/build-release.cjs`: 새 모듈을 웹 dist에 패키징하도록 목록 추가.
- `tests/outline-transfer.cjs`: 2개 소스 병합 및 추출/분할 북마크 위치·한글·계층·외부 URI 차단 계약 준비.
- `tests/page-atomic-publish.cjs`: PDF 저장 실패 때 편집 상태·Undo·클립보드 불변을 확인하는 계약 준비.
- **현재 모든 신규 기능 코드는 미검증**. 사용자 지시로 해당 기능 묶음의 코드를 완성한 후 일괄 Node/브라우저/Windows 테스트.
- 지원 범위: 원본 AcroForm·서명/외부 링크·이름 기반 북마크 등 미지원 변환은 중단. 스캔 이미지 OCR 불포함.
- 총괄 기존 평가 46%, 단계 1~7 기존 점수 84/62/57/40/31/51/0% 유지(이번 미검증 변경 가점 금지).
