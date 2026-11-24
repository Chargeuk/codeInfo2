"""Focused safety coverage; all homes and databases belong to this test."""
import hashlib
from pathlib import Path
import runpy
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

module = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'codex-sqlite-home.py'))
initialize = module['initialize']
relative_home = module['relative_home']
READY = module['READY']


def database(path, value='retained'):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE sample(value TEXT)')
        conn.execute('INSERT INTO sample VALUES (?)', (value,))


def history(path):
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE thread_history_projection_state(thread_id TEXT,next_rollout_byte_offset INTEGER,next_rollout_ordinal INTEGER)')
        for name in ['thread_turns', 'thread_items', 'thread_realtime_items', '_sqlx_migrations']:
            conn.execute(f'CREATE TABLE {name}(id TEXT)')
        conn.execute("INSERT INTO thread_history_projection_state VALUES ('known-thread',123,4)")


class SQLiteHomeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.source = self.base / 'source'
        self.source.mkdir()
        self.root = self.base / 'volume'

    def init(self, home=None, **kwargs):
        return initialize(home or self.source, self.root, self.source, **kwargs)

    def test_consistent_backup_preserves_original_and_ready_is_not_overwritten(self):
        original = self.source / 'state_5.sqlite'
        database(original)
        before = original.read_bytes()
        (self.source / 'auth.json').write_text('private')
        target = self.init()
        self.assertEqual(original.read_bytes(), before)
        self.assertFalse((target / 'auth.json').exists())
        self.assertTrue((target / READY).exists())
        with sqlite3.connect(target / original.name) as conn:
            self.assertEqual(conn.execute('SELECT value FROM sample').fetchone()[0], 'retained')
        original.write_bytes(b'now corrupted')
        self.assertEqual(self.init(), target)

    def test_wal_frames_are_preserved_without_writing_source(self):
        original = self.source / 'state_5.sqlite'
        conn = sqlite3.connect(original)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA wal_autocheckpoint=0')
        conn.execute('CREATE TABLE sample(value TEXT)')
        conn.execute("INSERT INTO sample VALUES ('wal-only')")
        conn.commit()
        self.addCleanup(conn.close)
        # Simulate a quiescent external owner; /proc detection is tested separately.
        before = module['metadata'](self.source)
        with patch.dict(initialize.__globals__, {'reject_process_writers': lambda _: None}):
            target = self.init()
        self.assertEqual(module['metadata'](self.source), before)
        with sqlite3.connect(target / original.name) as result:
            self.assertEqual(result.execute('SELECT value FROM sample').fetchone()[0], 'wal-only')

    def test_corruption_stops_and_verified_recovery_retries(self):
        (self.source / 'thread_history_1.sqlite').write_bytes(b'corrupt')
        with self.assertRaises(sqlite3.DatabaseError):
            self.init()
        self.assertFalse((self.root / 'shared' / READY).exists())
        replacement = self.base / 'thread_history_1.sqlite'
        history(replacement)
        digest = hashlib.sha256(replacement.read_bytes()).hexdigest()
        target = self.init(replacement=replacement, replacement_hash=digest)
        self.assertEqual((self.source / 'thread_history_1.sqlite').read_bytes(), b'corrupt')
        with sqlite3.connect(target / 'thread_history_1.sqlite') as conn:
            self.assertEqual(conn.execute('SELECT thread_id FROM thread_history_projection_state').fetchone()[0], 'known-thread')

    def test_recovery_rejects_wrong_hash_and_unrelated_schema(self):
        replacement = self.base / 'thread_history_1.sqlite'
        database(replacement)
        with self.assertRaisesRegex(RuntimeError, 'hash'):
            self.init(replacement=replacement, replacement_hash='0' * 64)
        with self.assertRaisesRegex(RuntimeError, 'schema'):
            self.init(replacement=replacement, replacement_hash=hashlib.sha256(replacement.read_bytes()).hexdigest())

    def test_isolated_homes_stay_distinct(self):
        isolated = self.source / '.codeinfo-chat-runtimes' / 'encoded-conversation'
        database(isolated / 'state_5.sqlite', 'isolated')
        database(self.source / 'state_5.sqlite', 'shared')
        shared_target = self.init()
        isolated_target = self.init(isolated)
        self.assertNotEqual(shared_target, isolated_target)
        self.assertEqual(isolated_target.relative_to(self.root).parts, ('.codeinfo-chat-runtimes', 'encoded-conversation'))

    def test_recovery_applies_only_to_shared_home(self):
        isolated = self.source / '.codeinfo-chat-runtimes' / 'one'
        database(isolated / 'state_5.sqlite')
        target = self.init(isolated, replacement=self.base / 'missing', replacement_hash='bad')
        self.assertFalse((target / 'thread_history_1.sqlite').exists())

    def test_path_escape_and_symlinks_are_rejected(self):
        for home in [self.base / 'other', self.source / '.codeinfo-chat-runtimes' / 'one' / 'nested', self.source / '..' / 'source']:
            with self.assertRaises((RuntimeError, ValueError)):
                self.init(home)
        (self.source / '.codeinfo-chat-runtimes').symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            self.init(self.source / '.codeinfo-chat-runtimes' / 'one')

    def test_unready_data_and_missing_ready_database_are_not_overwritten(self):
        target = self.root / 'shared'
        target.mkdir(parents=True)
        (target / 'state_5.sqlite').write_bytes(b'unready')
        with self.assertRaisesRegex(RuntimeError, 'unready'):
            self.init()
        self.assertEqual((target / 'state_5.sqlite').read_bytes(), b'unready')
        (target / READY).write_text('{"version":1,"databases":["logs_2.sqlite"]}')
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            self.init()

    def test_changed_source_aborts_then_clean_retry_succeeds(self):
        database(self.source / 'state_5.sqlite')
        original_backup = module['backup']
        def changing_backup(source, destination):
            original_backup(source, destination)
            (self.source / 'state_5.sqlite-wal').write_bytes(b'changed')
        with patch.dict(initialize.__globals__, {'backup': changing_backup}):
            with self.assertRaisesRegex(RuntimeError, 'changed'):
                self.init()
        (self.source / 'state_5.sqlite-wal').unlink()
        self.assertTrue((self.init() / READY).exists())

    def test_legacy_sessions_without_state_and_orphaned_wal_stop(self):
        sessions = self.source / 'sessions'
        sessions.mkdir()
        (sessions / 'existing.jsonl').write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'legacy sessions'):
            self.init()
        (sessions / 'existing.jsonl').unlink()
        (self.source / 'state_5.sqlite-wal').write_bytes(b'orphan')
        with self.assertRaisesRegex(RuntimeError, 'orphaned'):
            self.init()

    def test_unknown_sqlite_is_not_silently_omitted_but_unrelated_nss_db_stays(self):
        database(self.source / 'future.sqlite')
        with self.assertRaisesRegex(RuntimeError, 'unsupported legacy'):
            self.init()
        (self.source / 'future.sqlite').unlink()
        (self.source / 'cert9.db').write_bytes(b'NSS')
        self.assertTrue((self.init() / READY).exists())
        self.assertEqual((self.source / 'cert9.db').read_bytes(), b'NSS')

    def test_verified_state_and_history_recovery_remain_separate(self):
        (self.source / 'state_5.sqlite').write_bytes(b'corrupt-state')
        (self.source / 'thread_history_1.sqlite').write_bytes(b'corrupt-history')
        recovered_state = self.base / 'state_5.sqlite'
        with sqlite3.connect(recovered_state) as conn:
            conn.execute('CREATE TABLE threads(id TEXT,rollout_path TEXT,cwd TEXT,history_mode TEXT,archived INTEGER)')
            conn.execute("INSERT INTO threads VALUES ('known','/app/codex/sessions/known.jsonl','/data','full',0)")
        recovered_history = self.base / 'thread_history_1.sqlite'
        history(recovered_history)
        target = self.init(replacement=recovered_history, replacement_hash=module['sha256'](recovered_history),
                           state_replacement=recovered_state, state_replacement_hash=module['sha256'](recovered_state))
        with sqlite3.connect(target / 'state_5.sqlite') as conn:
            self.assertEqual(conn.execute('SELECT id FROM threads').fetchone()[0], 'known')
        self.assertEqual((self.source / 'state_5.sqlite').read_bytes(), b'corrupt-state')
        self.assertEqual((self.source / 'thread_history_1.sqlite').read_bytes(), b'corrupt-history')
        self.assertEqual(set(__import__('json').loads((target / READY).read_text())['recovery_sha256']), {'state_5.sqlite', 'thread_history_1.sqlite'})

    def test_state_recovery_rejects_unrelated_schema(self):
        recovered = self.base / 'state_5.sqlite'
        database(recovered)
        with self.assertRaisesRegex(RuntimeError, 'schema'):
            self.init(state_replacement=recovered, state_replacement_hash=module['sha256'](recovered))

    def test_streamed_seed_hash_does_not_use_read_bytes(self):
        recovered = self.base / 'thread_history_1.sqlite'
        history(recovered)
        digest = module['sha256'](recovered)
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('whole-file read')):
            self.init(replacement=recovered, replacement_hash=digest)


class DirectCliTest(unittest.TestCase):
    def test_direct_cli_enforces_global_route_and_keeps_other_config(self):
        cli = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'codex-sqlite-cli.py'))
        args = ['exec', '--config', 'sqlite_home="/wrong"', '-c', 'model="test"',
                '--config=sqlite_home="/wrong-again"', '-csqlite_home="/wrong-third"', '--', 'prompt']
        self.assertEqual(cli['route_arguments'](args, '/app/codex-sqlite/shared'), [
            '--config', 'sqlite_home="/app/codex-sqlite/shared"',
            'exec', '-c', 'model="test"', '--', 'prompt'])


if __name__ == '__main__':
    unittest.main()
