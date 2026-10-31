# 관리자 로컬 SQLite 백업 도구

소스 구현 단계이며 기능·복원 검증은 아직 실행하지 않았다.

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
