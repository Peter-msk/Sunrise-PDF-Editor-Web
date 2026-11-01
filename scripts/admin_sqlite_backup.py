"""Local SQLite backup/rehearsal. Never restores over a live database.

Usage: python scripts/admin_sqlite_backup.py backup SOURCE.sqlite NEW.sqlite
       python scripts/admin_sqlite_backup.py rehearse SOURCE.sqlite
Only use an operator-controlled SQLite export; this does not fetch Cloudflare D1.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile


def snapshot(source, target):
    source = Path(source).resolve(strict=True)
    target = Path(target).absolute()
    # Reserve a private, new file. Existing backup/live files cannot be replaced.
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    complete = False
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as src:
            with closing(sqlite3.connect(target)) as dst:
                src.backup(dst)
                check = dst.execute('PRAGMA integrity_check').fetchall()
                if check != [('ok',)]:
                    raise RuntimeError('Snapshot integrity check failed')
                tables = dst.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
                counts = {}
                for (name,) in tables:
                    quoted = '"' + name.replace('"', '""') + '"'
                    counts[name] = dst.execute('SELECT COUNT(*) FROM ' + quoted).fetchone()[0]
        with open(target, 'rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        complete = True
        return {'integrity': 'ok', 'sha256': digest, 'tables': counts}
    finally:
        if not complete:
            target.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['backup', 'rehearse'])
    parser.add_argument('source')
    parser.add_argument('output', nargs='?')
    args = parser.parse_args()
    if args.command == 'backup':
        if not args.output:
            parser.error('backup requires a new output path')
        result = snapshot(args.source, args.output)
        result['operation'] = 'local-backup'
    else:
        if args.output:
            parser.error('rehearse does not accept an output or live restore path')
        with tempfile.TemporaryDirectory(prefix='sunrise-restore-rehearsal-') as directory:
            result = snapshot(args.source, Path(directory) / 'isolated.sqlite')
            result['operation'] = 'isolated-restore-rehearsal'
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
