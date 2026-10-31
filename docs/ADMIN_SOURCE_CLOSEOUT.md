# 관리자 소스 작성 마감 — 2026-11-01

상태: **ADM-01~14 소스 작성 완료 후보본**. 사용자와 정한 소스 우선 단계의 마감이며, 기능 수용·브라우저 검증·운영 배포 완료 선언이 아니다. 검증에서 결함이 발견되면 해당 소스를 다시 연다.

소스 구현률은 아래 합의 범위에 필요한 코드·API·화면·스키마·운영 도구가 작성됐는지로 판단한다. 실행 검증이나 외부 환경 설정 때문에 소스 점수를 다시 차감하지 않는다. 검증·실사용·운영 반영 점수는 별도로 유지한다.

| ID | 마감한 소스 범위 | 근거 경로 |
|---|---|---|
| ADM-01 | 운영 KPI·일별 차트·기간/직전 기간 비교 | admin-api overview / admin dashboard |
| ADM-02 | KST 방문 중복 방지·일/주/월/누적·같은 탭 재방문 추정 | admin-api telemetry / overview / session-usage |
| ADM-03 | 실제 전경 구간·2분 유휴·자정 경계·편집 세션당 활성시간 | sunrise-telemetry sampleUsage / session-usage |
| ADM-04 | 26개 주요 작업·저장 준비 결과 및 수집 Worker 버전/기간 필터 | operation-metrics / admin operations |
| ADM-05 | 문의 검색·상태·메모·50건 조회·원자적 이력·수정 충돌 차단 | admin-api inquiries / inquiry_audit / revision |
| ADM-06 | 공지 작성/수정·7일 게시 수명·검색·필터·이전 기록 조회·미리보기·충돌 차단 | admin-api site-updates / admin publication form |
| ADM-07 | 업데이트 신규/보완/삭제·공지와 같은 조회/수정 보호 | admin-api site-updates / admin publication form |
| ADM-08 | Worker/D1 시점 상태·버전·기본 스키마/설정 준비 조회 | admin health / admin-readiness |
| ADM-09 | 서명 배포 보고·이력·수동 main 배포 워크플로우 | admin-deployments / report-deployment / manual-production-release |
| ADM-10 | 보존 정리·실행 상태/마지막 성공·실패 단계·백업/격리 복원 도구 | admin-retention / d1_backup / d1_restore_rehearsal |
| ADM-11 | 비밀번호 인증/변경·세션 조회/폐기·보안 이력·로그아웃 실패 표시·입력 크기 제한 | admin-password-auth / admin-security-log / bounded-json |
| ADM-12 | 작업/저장 준비 결과·같은 창 재시도·편집 세션 품질 | operation-metrics / save-quality / quality |
| ADM-13 | 기간별 방문 CSV·기간/버전별 작업 결과 CSV | admin statistics.csv / operations.csv |
| ADM-14 | 미처리·품질·DB·배포·보존 정리 알림·자동 조회 실패 판정 | admin operation alerts / auto refresh |

## 이번 마감에서 보완한 결함

- 최근 100건 안에서만 가능했던 공지/업데이트 검색을 서버 전체 검색과 종류별 50건 키셋 조회로 변경했다.
- 문의·공지·업데이트에 정수 revision을 추가했다. 오래된 화면의 PATCH는 409로 거절하고 기존 내용/이력을 보존한다. PATCH에 revision이 없으면 최신 화면 재조회를 요구한다.
- 포커스 복귀 직후 숨겨진 시간을 활성시간으로 잘못 포함하지 않도록 전경 구간을 분리했다. 2분 유휴, KST 자정 이후 구간, 30초 초과 샘플 공백을 명시적으로 처리한다.
- 관리/인증 JSON은 본문을 스트리밍으로 읽으며 크기를 제한한다. 한글 메모 1,000자와 공지 본문 3,000자는 업무 제한 내에서 허용한다.
- 저장 성공 뒤 목록 갱신 실패를 저장 실패와 구분한다. 로그아웃 요청 실패를 성공으로 표시하지 않는다.
- 자동 조회는 각 영역의 실패 반환값도 확인한다. 일부 조회 실패를 전체 조회 성공으로 표시하지 않는다.

## 다음 검증 단계

1. 기능: `npm run test:admin`과 새 회귀 코드의 실제 실행. 최신 스키마를 적용한 격리 DB에서 정상·오류·권한·동시성·자정 경계를 확인한다.
2. 브라우저: 관리자 문의/공지/업데이트/필터/CSV/보안/자동 조회를 확인한다. 실제 Windows Chrome·Edge 및 운영 도메인에서 확인할 항목을 별도 기록한다.
3. 운영: 실제 백업·격리 복원, 마이그레이션 적용 상태 대조, GitHub production 환경/비밀값 연결, 검토된 main의 수동 배포와 실제 데이터 확인.

이번 회차에는 문법·정적 연결·문서 일치만 확인했으며 기능/브라우저 검사를 실행하지 않았다. 과거 통과 기록은 현재 변경분의 통과 증거가 아니다. 운영 스키마를 변경하지 않았고 배포 워크플로우도 실행하지 않았다.

신규 스키마는 0015까지다. 이미 직접 적용된 0004는 재실행하지 않는다. 운영 적용 전에 실제 DB와 이력을 대조하고 적용할 파일을 결정한다. API와 관리자 화면은 revision 계약을 함께 반영해야 하며, 이전에 열어 둔 관리자 화면은 새로고침이 필요하다.

## 유지되는 측정·제품 범위

방문/재방문은 사람이 아닌 익명 탭 기준이다. 편집 세션은 탭·일자 기준이며 작업 완료 세션이 아니다. Worker 버전은 시작을 접수한 서버 버전이다. PDF 준비/다운로드 요청은 디스크 저장 완료와 다르다. 통계 누락을 성공으로 간주하지 않는다. 백업/복원 도구의 작성은 실제 복구 성공 증거가 아니다.

이 마감은 사용자용 원문 직접 수정·보안삭제·암호 보호·전자서명·Word/Excel 변환 등 전체 PDF 편집기 개발 완료를 포함하지 않는다. OCR 제외와 전체 7단계 계획은 유지한다.
