import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  codexSqliteCliArgs,
  isCodexSqliteHomeReady,
  resolveCodexSqliteHome,
} from '../../config/codexConfig.js';

test('dotenv opt-in alone leaves Codex SQLite routing unchanged', () => {
  assert.equal(resolveCodexSqliteHome('/app/codex', {}), undefined);
  assert.equal(
    resolveCodexSqliteHome('/app/codex', { CODEINFO_CODEX_SQLITE_VOLUME: '1' }),
    undefined,
  );
});

test('Compose activation keeps shared and isolated SQLite homes distinct', () => {
  const env = { CODEINFO_CODEX_SQLITE_VOLUME_ACTIVE: '1' };
  assert.equal(
    resolveCodexSqliteHome('/app/codex', env),
    '/app/codex-sqlite/shared',
  );
  assert.equal(
    resolveCodexSqliteHome('/app/codex/.codeinfo-chat-runtimes/one', env),
    '/app/codex-sqlite/.codeinfo-chat-runtimes/one',
  );
  for (const home of [
    '/other',
    '/app/codex-other',
    '/app/codex/chat',
    '/app/codex/.codeinfo-chat-runtimes/one/nested',
  ]) {
    assert.throws(() => resolveCodexSqliteHome(home, env));
  }
});

test('native helpers use explicit sqlite_home config, which outranks TOML and env', () => {
  assert.deepEqual(codexSqliteCliArgs(undefined), []);
  assert.deepEqual(
    codexSqliteCliArgs({ config: { sqlite_home: '/app/codex-sqlite/shared' } }),
    ['--config', 'sqlite_home="/app/codex-sqlite/shared"'],
  );
});

test('ready homes avoid initialization while missing or aliased data fails closed', (context) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sqlite-ready-')),
  );
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(home);
  fs.mkdirSync(target);
  assert.equal(isCodexSqliteHomeReady(home, target), false);
  const marker = path.join(target, '.codeinfo-sqlite-ready-v1');
  fs.writeFileSync(
    marker,
    JSON.stringify({ version: 1, databases: ['state_5.sqlite'] }),
  );
  assert.throws(
    () => isCodexSqliteHomeReady(home, target),
    /missing a seeded database/,
  );
  fs.writeFileSync(
    path.join(target, 'state_5.sqlite'),
    'owned by SQLite after seeding',
  );
  assert.equal(isCodexSqliteHomeReady(home, target), true);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(home, alias);
  assert.throws(() => isCodexSqliteHomeReady(alias, target), /symlinked/);
  fs.writeFileSync(
    marker,
    JSON.stringify({ version: 1, databases: ['../escape.sqlite'] }),
  );
  assert.throws(() => isCodexSqliteHomeReady(home, target), /database name/);
});
