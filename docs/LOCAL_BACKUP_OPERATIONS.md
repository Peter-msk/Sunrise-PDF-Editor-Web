# 관리자 로컬 SQLite 백업 도구

2026-11-01 합성 자료로 실제 Python 백업/격리 복원 명령과 Node 운영 도구의 프로세스 경로를 검사했다. 실제 운영 D1 백업·원격 복원 검증은 별도로 남아 있다.

Cloudflare D1에서 운영자가 별도 절차로 확보한 데이터가 SQLite 파일 형식일 때 사용하는 도구다. SQL 텍스트 덤프는 SQLite 파일로 변환해야 한다. 이 스크립트가 Cloudflare에서 운영 데이터를 내려받거나 운영 DB를 복원하지는 않는다.

Python 3.11 이상에서 실행한다.

```sh
python scripts/admin_sqlite_backup.py backup source.sqlite new-backup.sqlite
python scripts/admin_sqlite_backup.py rehearse new-backup.sqlite
```

- 원본은 읽기 전용으로 연다. SQLite backup API를 통해 일관된 사본을 만든다.
- 결과는 새 파일에만 저장하며 기존 경로를 덮어쓰지 않는다. 생성 파일은 소유자 읽기/쓰기 권한으로 제한한다. Windows는 별도 ACL과 암호화 보관 정책을 적용한다.
- 무결성 결과, SHA-256, 테이블별 건수만 출력한다. 실제 레코드나 비밀값은 출력하지 않는다.
- rehearse는 임시 폴더에 별도 사본을 만들고 무결성과 테이블 조회를 수행한 뒤 제거한다. 운영 복원 명령은 제공하지 않는다.
- 데이터에는 문의 개인정보와 인증 레코드가 포함될 수 있다. 백업 파일을 GitHub, 공개 로그, 공개 배포본에 넣지 않는다.
- 이 도구의 성공은 Cloudflare D1 운영 복원 성공과 다르다. Cloudflare 복원은 권한이 분리된 시험 DB에서 추가 확인한다.

후속 기능 검증: 읽기 전용 원본, 동시 쓰기, 실패 시 파일 정리, 기존 경로 보호, 큰 DB, Windows 임시 파일 정리, 원본·사본의 건수 및 핵심 조회 결과를 확인한다.

## Cloudflare D1 운영 도구 소스

`node scripts/d1_backup.cjs DATABASE /private/new-export.sql`은 인증된 Wrangler로 원격 D1을 SQL 파일로 내보낸다. 저장 위치는 실제 경로 기준으로 소스 저장소 밖이어야 하며 심볼릭 링크로 저장소를 가리키는 상위 경로도 거절한다. 기존 파일을 덮어쓰지 않는다. 결과 파일은 개인정보/인증 레코드를 포함할 수 있다. 실제 내용이나 Wrangler 응답 전문은 출력하지 않는다. 합성 Wrangler 프로세스에서 성공/실패·기존 파일 보호·개인 내용 미출력을 확인했으며 실제 원격 내보내기는 하지 않았다.

`node scripts/d1_restore_rehearsal.cjs /private/new-export.sql sunrise-pdf-restore-test`는 이름이 고정된 전용 시험 DB가 비어 있을 때만 SQL을 가져온다. 빈 DB 응답은 성공한 단일 결과의 정수 0만 허용하며 null·빈 문자열·실패/성공 플래그 누락 응답은 거절한다. 잘못된 JSON 응답도 원문 없이 고정 오류로 표시한다. 운영 DB 이름을 받지 않으며 기존 시험 DB 데이터도 덮어쓰지 않는다. 가져오기 후 핵심 테이블 건수 조회를 수행한다. 실패 시 전용 시험 DB에 일부 데이터가 남을 수 있으므로 운영자에게 보존한다. 실제 실행·전체 무결성/업무 복원 수용은 미검증이다.

Cloudflare 공식 명령 참고: https://developers.cloudflare.com/workers/wrangler/commands/d1/


## 예약 정리 실행 기록

0014_retention_execution.sql 이후 예약 작업은 `admin_maintenance_status` 한 행에 최근 시도와 마지막 확인된 성공을 남긴다. 실행 중·성공·실패를 구분하며, 문의/익명 세션/인증 기록 → 배포 보고 → 보안 이력 순서로 진행한다. 중간 실패는 앞 단계의 정리를 되돌리지 않으며 실패 단계를 고정 코드로 남긴다. 실패했다고 마지막 성공 시각을 지우지 않는다. 로그·화면에는 원본 DB 오류나 개인정보를 표시하지 않는다.

동시 실행은 1시간 임대로 제한한다. 1시간을 넘겨 실행 중으로 남은 기록은 조회 시 결과 미확인으로 표시한다. 최근 실패·결과 미확인·48시간 동안 성공 기록 없음·이력 조회 실패는 운영 알림에 포함한다. 정리 성공 기록은 백업 성공 또는 복원 검증을 의미하지 않는다.

신규 회귀 소스 `tests/admin-version-retention-contract.cjs`는 성공·부분 실패·마지막 성공 유지·중복 실행·결과 미확인을 포함한다. 실제 SQLite에서 실행해 통과했다. 운영자 도구의 추가 검사는 `npm run test:admin:operations`로 실행한다. 합성 프로세스 검사를 실제 D1 원격 복원으로 해석하지 않는다.

운영 테이블·열의 실제 읽기 점검 결과와 적용 전 차이는 `PRODUCTION_SCHEMA_REVIEW.md`에 기록한다.
