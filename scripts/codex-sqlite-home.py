#!/usr/bin/env python3
"""Initialize SQLite-only homes using read-only, consistent SQLite backups.

Kept in scripts so the image and the read-only development script mount use the
same implementation. No SQLite journal, session, auth or config is moved.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time

DATABASES = ('logs_2.sqlite', 'goals_1.sqlite', 'memories_1.sqlite',
             'memories_v2_1.sqlite', 'queue_1.sqlite', 'state_5.sqlite',
             'thread_history_1.sqlite')
READY = '.codeinfo-sqlite-ready-v1'
ROOT = Path('/app/codex-sqlite')
SOURCE = Path('/app/codex')


def relative_home(home, source):
    home = Path(home).absolute()
    source = Path(source).absolute()
    # Symlinked homes could route two independent databases onto one target.
    if home.resolve() != home or source.resolve() != source:
        raise RuntimeError('SQLite routing refuses symlinked Codex homes')
    rel = home.relative_to(source)
    if not rel.parts:
        return Path('shared')
    if len(rel.parts) == 2 and rel.parts[0] == '.codeinfo-chat-runtimes' and rel.parts[1] not in ('.', '..'):
        return rel
    raise RuntimeError('SQLite routing accepts only the shared or isolated CodeInfo Codex home')


def metadata(home):
    result = {}
    if not home.exists():
        return result
    for entry in home.iterdir():
        if entry.name.endswith(('.sqlite', '.sqlite-wal', '.sqlite-shm', '.sqlite-journal')):
            if entry.is_symlink() or not entry.is_file():
                raise RuntimeError('SQLite source must contain regular files, not symlinks')
            stat = entry.stat()
            result[entry.name] = (stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    return result


def reject_process_writers(home):
    # Detect native writers in this container. The wrapper also checks other
    # containers sharing the source; metadata checks catch host-side changes.
    proc = Path('/proc')
    if not proc.exists():
        return
    source = str(home) + '/'
    for process in proc.iterdir():
        if not process.name.isdigit() or process.name == str(os.getpid()):
            continue
        try:
            for fd in (process / 'fd').iterdir():
                target = os.readlink(fd)
                if target.startswith(source) and '.sqlite' in Path(target).name:
                    info = (process / 'fdinfo' / fd.name).read_text()
                    flags = next(line.split()[1] for line in info.splitlines() if line.startswith('flags:'))
                    if int(flags, 8) & os.O_ACCMODE in (os.O_WRONLY, os.O_RDWR):
                        raise RuntimeError('stop active Codex SQLite source writers before initialization')
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue


def backup(source, destination):
    # Read-only bind mounts can lack WAL shared-memory files. Stage the whole
    # quiescent SQLite family into writable scratch before opening it; SQLite's
    # backup API then includes committed WAL frames without touching originals.
    with tempfile.TemporaryDirectory(prefix='codeinfo-sqlite-source-') as scratch:
        staged_source = Path(scratch) / source.name
        shutil.copyfile(source, staged_source)
        for suffix in ('-wal', '-shm', '-journal'):
            sibling = Path(str(source) + suffix)
            if sibling.exists():
                shutil.copyfile(sibling, Path(str(staged_source) + suffix))
        with sqlite3.connect(staged_source.as_uri() + '?mode=ro', uri=True, timeout=1) as src:
            if src.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise RuntimeError(f'corrupt SQLite source {source.name}; supply a verified recovery backup')
            with sqlite3.connect(destination) as dest:
                deadline = time.monotonic() + 30
                def progress(status, remaining, total):
                    if time.monotonic() > deadline:
                        raise RuntimeError('SQLite backup timed out; stop source writers before retrying')
                src.backup(dest, pages=256, progress=progress, sleep=0.05)
                if dest.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise RuntimeError(f'backup validation failed for {source.name}')
                dest.execute('PRAGMA journal_mode=DELETE')


def sha256(file):
    # Recovered databases can be multiple gigabytes; never read them into RAM.
    digest = hashlib.sha256()
    with Path(file).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_replacement(file, name):
    with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True) as recovered:
        if name == 'thread_history_1.sqlite':
            tables = {row[0] for row in recovered.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'thread_history_projection_state', 'thread_turns', 'thread_items', 'thread_realtime_items', '_sqlx_migrations'} <= tables:
                raise RuntimeError('recovery input does not have the pinned Codex thread-history schema')
            table = 'thread_history_projection_state'
            required = {'thread_id', 'next_rollout_byte_offset', 'next_rollout_ordinal'}
        else:
            table = 'threads'
            required = {'id', 'rollout_path', 'cwd', 'history_mode', 'archived'}
        columns = {row[1] for row in recovered.execute(f'PRAGMA table_info({table})')}
        if not required <= columns:
            raise RuntimeError(f'recovery input has an invalid {name} schema')


def runtime_replacements():
    result = {}
    for file, arg, env in [
        ('/seed/codex-thread-history.sqlite', 'replacement', 'CODEINFO_CODEX_SQLITE_THREAD_HISTORY_SHA256'),
        ('/seed/codex-state.sqlite', 'state_replacement', 'CODEINFO_CODEX_SQLITE_STATE_SHA256'),
    ]:
        if Path(file).exists():
            if os.environ.get('CODEINFO_RUNTIME_COMPOSE_FILE') != 'docker-compose.local.yml':
                raise RuntimeError('SQLite recovery inputs are supported only for compose:local')
            result[arg] = file
            result[arg + '_hash'] = os.environ.get(env)
    return result


def initialize(home, root=ROOT, source=SOURCE, replacement=None, replacement_hash=None,
               state_replacement=None, state_replacement_hash=None):
    rel = relative_home(home, source)
    root = Path(root).absolute()
    if root.resolve() != root:
        raise RuntimeError('SQLite volume root must not be a symlink')
    target = root / rel
    if target.resolve() != target:
        raise RuntimeError('SQLite destination must not be a symlink')
    ready = target / READY
    if ready.exists():
        if ready.is_symlink() or not ready.is_file():
            raise RuntimeError('invalid SQLite readiness marker')
        manifest = json.loads(ready.read_text())
        if manifest.get('version') != 1 or not isinstance(manifest.get('databases'), list):
            raise RuntimeError('invalid SQLite readiness manifest')
        for name in manifest['databases']:
            if name not in DATABASES or not (target / name).is_file() or (target / name).is_symlink():
                raise RuntimeError('ready SQLite volume is missing a seeded database; refusing overwrite')
        return target
    if target.exists() and any(target.iterdir()):
        # Only our fully staged homes become visible. Unknown data must never be
        # mistaken for an empty volume or overwritten on a retry.
        raise RuntimeError(f'unready SQLite destination contains data: {target}')
    home = Path(home).absolute()
    reject_process_writers(home)
    before = metadata(home)
    unknown = [name for name in before if name.endswith('.sqlite') and name not in DATABASES]
    if unknown:
        raise RuntimeError('unsupported legacy SQLite databases: ' + ', '.join(unknown))
    for name in before:
        base = name.split('.sqlite', 1)[0] + '.sqlite'
        if base not in before:
            raise RuntimeError(f'orphaned SQLite sidecar {name}; recover the source before retrying')
    # Existing rollouts with no state/history database must not silently become a
    # fresh database. Empty/new homes with no legacy sessions remain supported.
    has_sessions = any(any((home / directory).rglob('*.jsonl')) for directory in ('sessions', 'archived_sessions') if (home / directory).exists())
    if has_sessions and 'state_5.sqlite' not in before and not (rel == Path('shared') and state_replacement):
        raise RuntimeError('legacy sessions exist without their SQLite state; recover before enabling the volume')
    root.mkdir(parents=True, exist_ok=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Kernel locks are released on interruption, so a retry never needs to
    # delete stale locks or overwrite an already-ready home.
    lock = target.parent / ('.' + target.name + '.initializing.lock')
    lock_fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lock_fd)
        raise RuntimeError('SQLite initialization is already running; retry when it finishes')
    if ready.exists():
        os.close(lock_fd)
        return initialize(home, root, source, replacement, replacement_hash, state_replacement, state_replacement_hash)
    staged = Path(tempfile.mkdtemp(prefix='.seed-', dir=target.parent))
    try:
        copied = []
        replacements = {
            'thread_history_1.sqlite': (replacement, replacement_hash),
            'state_5.sqlite': (state_replacement, state_replacement_hash),
        } if rel == Path('shared') else {}
        for name in DATABASES:
            candidate = home / name
            recovery_file, recovery_hash = replacements.get(name, (None, None))
            if recovery_file:
                candidate = Path(recovery_file).absolute()
                if candidate.is_symlink() or not candidate.is_file():
                    raise RuntimeError(f'verified {name} recovery input is missing')
                if sha256(candidate) != recovery_hash:
                    raise RuntimeError(f'{name} recovery input hash does not match verification')
                for suffix in ('-wal', '-journal'):
                    if Path(str(candidate) + suffix).exists() and Path(str(candidate) + suffix).stat().st_size:
                        raise RuntimeError('recovery input must be a standalone SQLite backup')
            if candidate.exists():
                try:
                    backup(candidate, staged / name)
                except sqlite3.Error as error:
                    raise sqlite3.DatabaseError(f'{name}: {error}; recover this database before retrying') from error
                if recovery_file:
                    if sha256(candidate) != recovery_hash:
                        raise RuntimeError(f'{name} recovery input changed during initialization')
                    validate_replacement(staged / name, name)
                copied.append(name)
        reject_process_writers(home)
        if metadata(home) != before:
            raise RuntimeError('SQLite source changed during initialization; stop source writers and retry')
        (staged / READY).write_text(json.dumps({'version': 1, 'databases': copied, 'recovery_sha256': {name: pair[1] for name, pair in replacements.items() if pair[0]}}) + '\n')
        if target.exists():
            target.rmdir()
        staged.rename(target)
    finally:
        if staged.exists():
            shutil.rmtree(staged)
        os.close(lock_fd)
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home')
    parser.add_argument('--print-home', action='store_true')
    args = parser.parse_args()
    if os.environ.get('CODEINFO_CODEX_SQLITE_VOLUME_ACTIVE') != '1':
        return
    replacements = runtime_replacements()
    homes = [Path(args.home)] if args.home else [SOURCE]
    isolated = SOURCE / '.codeinfo-chat-runtimes'
    if not args.home and isolated.exists():
        if isolated.is_symlink():
            raise RuntimeError('isolated Codex homes must not be symlinked')
        homes.extend(child for child in isolated.iterdir() if child.is_dir())
    for home in homes:
        target = initialize(home, **replacements)
        if args.print_home:
            print(target)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, sqlite3.Error) as error:
        print(f'CODEINFO SQLite volume initialization failed: {error}', file=sys.stderr)
        sys.exit(1)
