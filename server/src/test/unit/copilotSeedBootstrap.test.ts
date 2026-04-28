import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importCopilotSeedIntoRuntimeHome } from '../../config/copilotSeedBootstrap.js';

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSeedArtifacts(seedHome: string) {
  await fs.mkdir(path.join(seedHome, 'session-state'), { recursive: true });
  await fs.writeFile(
    path.join(seedHome, 'config.json'),
    '{"store_token_plaintext":true}\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(seedHome, 'settings.json'),
    '{"storeTokenPlaintext":true}\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(seedHome, 'session-state', 'session.json'),
    '{"session":"ok"}\n',
    'utf8',
  );
  await fs.mkdir(path.join(seedHome, 'logs'), { recursive: true });
  await fs.writeFile(
    path.join(seedHome, 'logs', 'ignored.txt'),
    'ignore',
    'utf8',
  );
}

test('copies config.json, settings.json, and session-state into an empty runtime home', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
    });

    assert.equal(result.status, 'seed_applied');
    assert.deepEqual(result.copiedArtifacts.sort(), [
      'config.json',
      'session-state',
      'settings.json',
    ]);
    await fs.access(path.join(runtimeHome, 'config.json'));
    await fs.access(path.join(runtimeHome, 'settings.json'));
    await fs.access(path.join(runtimeHome, 'session-state', 'session.json'));
    await assert.rejects(fs.access(path.join(runtimeHome, 'logs')), {
      code: 'ENOENT',
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('skips copying when runtime auth-bearing artifacts already exist and never overwrites them', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);
    await fs.mkdir(path.join(runtimeHome, 'session-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(runtimeHome, 'config.json'),
      '{"runtime":"wins"}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(runtimeHome, 'settings.json'),
      '{"runtimeSettings":"wins"}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(runtimeHome, 'session-state', 'session.json'),
      '{"runtime":"session"}\n',
      'utf8',
    );

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
    });

    assert.equal(result.status, 'seed_skipped_runtime_already_initialized');
    assert.deepEqual(result.copiedArtifacts, []);
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'config.json'), 'utf8'),
      '{"runtime":"wins"}\n',
    );
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'settings.json'), 'utf8'),
      '{"runtimeSettings":"wins"}\n',
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('reports seed_missing when the seed home is absent', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');

  try {
    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome: path.join(tempRoot, 'runtime'),
      seedHome: path.join(tempRoot, 'missing-seed'),
    });

    assert.equal(result.status, 'seed_missing');
    assert.deepEqual(result.copiedArtifacts, []);
    assert.deepEqual(result.skippedArtifacts, []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('returns seed_copy_failed when the runtime home cannot be created', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHomeFile = path.join(tempRoot, 'runtime-file');

  try {
    await writeSeedArtifacts(seedHome);
    await fs.writeFile(runtimeHomeFile, 'not-a-directory', 'utf8');

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome: path.join(runtimeHomeFile, 'nested-runtime'),
      seedHome,
    });

    assert.equal(result.status, 'seed_copy_failed');
    assert.match(result.error ?? '', /not a directory|ENOTDIR|ENOENT/u);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('entrypoint wires the Copilot seed bootstrap helper before node startup', async () => {
  const entrypoint = await fs.readFile(
    path.resolve(process.cwd(), 'entrypoint.sh'),
    'utf8',
  );

  assert.match(entrypoint, /node dist\/config\/copilotSeedBootstrap\.js/u);
  assert.match(entrypoint, /story\.0000056\.task04\.copilot_seed_import/u);
});
