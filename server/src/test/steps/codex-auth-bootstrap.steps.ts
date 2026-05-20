import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import pino from 'pino';

import { ensureCodexAuthFromHost } from '../../utils/codexAuthCopy.js';

const logger = pino({ level: 'silent' });

let containerHome = '';
let hostHome = '';
const tempDirs: string[] = [];
const cleanupCalls = {
  unlink: [] as string[],
  rm: [] as string[],
  rename: [] as Array<{ from: string; to: string }>,
};

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

Before(async () => {
  containerHome = '';
  hostHome = '';
  cleanupCalls.unlink = [];
  cleanupCalls.rm = [];
  cleanupCalls.rename = [];

  mock.method(fs, 'unlinkSync', (targetPath: fs.PathLike) => {
    cleanupCalls.unlink.push(String(targetPath));
  });
  mock.method(fs, 'rmSync', (targetPath: fs.PathLike) => {
    cleanupCalls.rm.push(String(targetPath));
  });
  mock.method(
    fs,
    'renameSync',
    (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      cleanupCalls.rename.push({
        from: String(oldPath),
        to: String(newPath),
      });
    },
  );
});

After(async () => {
  mock.restoreAll();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }

    try {
      await fsp.chmod(dir, 0o755);
    } catch {
      // ignore cleanup chmod failures
    }

    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

Given('a Codex bootstrap container home', async () => {
  containerHome = await makeTempDir('codex-bootstrap-container-');
});

Given('a distinct Codex bootstrap host home', async () => {
  hostHome = await makeTempDir('codex-bootstrap-host-');
});

Given(
  'the host bootstrap auth file contains token {string}',
  async (token: string) => {
    assert(hostHome, 'expected host home');
    await fsp.writeFile(
      path.join(hostHome, 'auth.json'),
      JSON.stringify({ token }),
    );
  },
);

Given('the host bootstrap home is read-only', async () => {
  assert(hostHome, 'expected host home');
  await fsp.chmod(hostHome, 0o555);
});

Given(
  'the Codex bootstrap runtime auth file starts with token {string}',
  async (token: string) => {
    assert(containerHome, 'expected container home');
    await fsp.writeFile(
      path.join(containerHome, 'auth.json'),
      JSON.stringify({ token }),
    );
  },
);

When('I run Codex auth bootstrap', async () => {
  assert(containerHome, 'expected container home');
  assert(hostHome, 'expected host home');

  ensureCodexAuthFromHost({
    containerHome,
    hostHome,
    logger,
  });
});

When('I run Codex auth bootstrap twice', async () => {
  assert(containerHome, 'expected container home');
  assert(hostHome, 'expected host home');

  ensureCodexAuthFromHost({
    containerHome,
    hostHome,
    logger,
  });
  ensureCodexAuthFromHost({
    containerHome,
    hostHome,
    logger,
  });
});

Then(
  'the Codex bootstrap runtime auth file contains token {string}',
  async (token: string) => {
    assert(containerHome, 'expected container home');
    const authPath = path.join(containerHome, 'auth.json');
    assert.equal(
      await fsp.readFile(authPath, 'utf8'),
      JSON.stringify({ token }),
    );
  },
);

Then('the Codex bootstrap runtime auth file is absent', async () => {
  assert(containerHome, 'expected container home');
  assert.equal(
    await fsp
      .access(path.join(containerHome, 'auth.json'))
      .then(() => true)
      .catch(() => false),
    false,
  );
});

Then('no auth cleanup operations were attempted', () => {
  assert.equal(cleanupCalls.unlink.length, 0);
  assert.equal(cleanupCalls.rm.length, 0);
  assert.equal(cleanupCalls.rename.length, 0);
});
