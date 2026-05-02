import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __resetCopilotSeedBootstrapHooksForTests,
  __setCopilotSeedBootstrapHooksForTests,
  importCopilotSeedIntoRuntimeHome,
} from '../../config/copilotSeedBootstrap.js';

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

async function writeRuntimeArtifacts(params: {
  runtimeHome: string;
  includeConfig?: boolean;
  includeSettings?: boolean;
  includeSessionState?: boolean;
}) {
  await fs.mkdir(params.runtimeHome, { recursive: true });
  if (params.includeSessionState) {
    await fs.mkdir(path.join(params.runtimeHome, 'session-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(params.runtimeHome, 'session-state', 'session.json'),
      '{"runtime":"session"}\n',
      'utf8',
    );
  }
  if (params.includeConfig) {
    await fs.writeFile(
      path.join(params.runtimeHome, 'config.json'),
      '{"runtime":"wins"}\n',
      'utf8',
    );
  }
  if (params.includeSettings) {
    await fs.writeFile(
      path.join(params.runtimeHome, 'settings.json'),
      '{"runtimeSettings":"wins"}\n',
      'utf8',
    );
  }
}

function currentRuntimeEnv(): NodeJS.ProcessEnv {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) {
    throw new Error('current runtime identity unavailable on this platform');
  }
  return {
    CODEINFO_RUNTIME_UID: String(uid),
    CODEINFO_RUNTIME_GID: String(gid),
  };
}

async function lockDownRuntimeArtifacts(runtimeHome: string) {
  await fs.chmod(path.join(runtimeHome, 'config.json'), 0o000);
  await fs.chmod(path.join(runtimeHome, 'settings.json'), 0o000);
  await fs.chmod(
    path.join(runtimeHome, 'session-state', 'session.json'),
    0o000,
  );
  await fs.chmod(path.join(runtimeHome, 'session-state'), 0o000);
}

async function listBootstrapStageRoots(parentDir: string) {
  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('.copilot-seed-stage-'),
    )
    .map((entry) => entry.name);
}

async function withForcedSessionStateRenameExdev<T>(
  callback: () => Promise<T>,
): Promise<T> {
  const originalRename = nodeFs.promises.rename;
  nodeFs.promises.rename = async (
    oldPath: nodeFs.PathLike,
    newPath: nodeFs.PathLike,
  ) => {
    if (
      typeof oldPath === 'string' &&
      typeof newPath === 'string' &&
      oldPath.includes(`${path.sep}session-state`) &&
      newPath.endsWith(`${path.sep}session-state`)
    ) {
      const error = new Error(
        'cross-device link not permitted',
      ) as NodeJS.ErrnoException;
      error.code = 'EXDEV';
      throw error;
    }
    return originalRename.call(nodeFs.promises, oldPath, newPath);
  };

  try {
    return await callback();
  } finally {
    nodeFs.promises.rename = originalRename;
  }
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

test('complete runtime homes still skip seeding without overwriting existing auth-bearing artifacts', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);
    await writeRuntimeArtifacts({
      runtimeHome,
      includeConfig: true,
      includeSettings: true,
      includeSessionState: true,
    });

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

test('one-of-three partial runtime homes import the missing peers without overwriting the existing artifact', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);
    await writeRuntimeArtifacts({
      runtimeHome,
      includeConfig: true,
    });

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
    });

    assert.equal(result.status, 'seed_applied');
    assert.deepEqual(result.copiedArtifacts.sort(), [
      'session-state',
      'settings.json',
    ]);
    assert.deepEqual(result.skippedArtifacts, [
      {
        artifact: 'config.json',
        action: 'skipped_existing_runtime',
        sourcePath: path.join(seedHome, 'config.json'),
        targetPath: path.join(runtimeHome, 'config.json'),
      },
    ]);
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'config.json'), 'utf8'),
      '{"runtime":"wins"}\n',
    );
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'settings.json'), 'utf8'),
      '{"storeTokenPlaintext":true}\n',
    );
    assert.equal(
      await fs.readFile(
        path.join(runtimeHome, 'session-state', 'session.json'),
        'utf8',
      ),
      '{"session":"ok"}\n',
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('two-of-three partial runtime homes import only the missing peer and preserve the existing pair', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);
    await writeRuntimeArtifacts({
      runtimeHome,
      includeConfig: true,
      includeSessionState: true,
    });

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
    });

    assert.equal(result.status, 'seed_applied');
    assert.deepEqual(result.copiedArtifacts, ['settings.json']);
    assert.deepEqual(
      result.skippedArtifacts.map((artifact) => artifact.artifact).sort(),
      ['config.json', 'session-state'],
    );
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'config.json'), 'utf8'),
      '{"runtime":"wins"}\n',
    );
    assert.equal(
      await fs.readFile(
        path.join(runtimeHome, 'session-state', 'session.json'),
        'utf8',
      ),
      '{"runtime":"session"}\n',
    );
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'settings.json'), 'utf8'),
      '{"storeTokenPlaintext":true}\n',
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('partial runtime homes still publish the missing session-state directory when same-device rename is unavailable', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);
    await writeRuntimeArtifacts({
      runtimeHome,
      includeConfig: true,
      includeSettings: true,
    });

    const repairResult = await withForcedSessionStateRenameExdev(() =>
      importCopilotSeedIntoRuntimeHome({
        runtimeHome,
        seedHome,
      }),
    );

    assert.equal(repairResult.status, 'seed_applied');
    assert.deepEqual(repairResult.copiedArtifacts, ['session-state']);
    assert.deepEqual(
      repairResult.skippedArtifacts.map((artifact) => artifact.artifact).sort(),
      ['config.json', 'settings.json'],
    );
    assert.equal(
      await fs.readFile(
        path.join(runtimeHome, 'session-state', 'session.json'),
        'utf8',
      ),
      '{"session":"ok"}\n',
    );

    const completeResult = await withForcedSessionStateRenameExdev(() =>
      importCopilotSeedIntoRuntimeHome({
        runtimeHome,
        seedHome,
      }),
    );

    assert.equal(
      completeResult.status,
      'seed_skipped_runtime_already_initialized',
    );
    assert.deepEqual(completeResult.copiedArtifacts, []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('re-normalizes existing runtime artifacts for the runtime identity without overwriting them', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);
    const firstResult = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
      env: currentRuntimeEnv(),
    });
    assert.equal(firstResult.status, 'seed_applied');

    await lockDownRuntimeArtifacts(runtimeHome);

    const secondResult = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
      env: currentRuntimeEnv(),
    });

    assert.equal(
      secondResult.status,
      'seed_skipped_runtime_already_initialized',
    );
    assert.deepEqual(secondResult.copiedArtifacts, []);
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'config.json'), 'utf8'),
      '{"store_token_plaintext":true}\n',
    );
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'settings.json'), 'utf8'),
      '{"storeTokenPlaintext":true}\n',
    );
    assert.equal(
      await fs.readFile(
        path.join(runtimeHome, 'session-state', 'session.json'),
        'utf8',
      ),
      '{"session":"ok"}\n',
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('late-publish runtime winners remain intact when another writer completes the runtime mid-sequence', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');
  let injectedRuntime = false;

  try {
    await writeSeedArtifacts(seedHome);
    __setCopilotSeedBootstrapHooksForTests({
      beforePublishArtifact: async ({ artifact }) => {
        if (artifact !== 'settings.json' || injectedRuntime) return;
        injectedRuntime = true;
        await fs.mkdir(path.join(runtimeHome, 'session-state'), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(runtimeHome, 'config.json'),
          '{"runtime":"wins-after-preflight"}\n',
          'utf8',
        );
        await fs.writeFile(
          path.join(runtimeHome, 'settings.json'),
          '{"runtimeSettings":"wins-after-preflight"}\n',
          'utf8',
        );
        await fs.writeFile(
          path.join(runtimeHome, 'session-state', 'session.json'),
          '{"runtime":"session-after-preflight"}\n',
          'utf8',
        );
      },
    });

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
    });

    assert.equal(result.status, 'seed_skipped_runtime_already_initialized');
    assert.deepEqual(result.copiedArtifacts, []);
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'config.json'), 'utf8'),
      '{"runtime":"wins-after-preflight"}\n',
    );
    assert.equal(
      await fs.readFile(path.join(runtimeHome, 'settings.json'), 'utf8'),
      '{"runtimeSettings":"wins-after-preflight"}\n',
    );
    assert.equal(
      await fs.readFile(
        path.join(runtimeHome, 'session-state', 'session.json'),
        'utf8',
      ),
      '{"runtime":"session-after-preflight"}\n',
    );
    assert.deepEqual(await listBootstrapStageRoots(tempRoot), []);
  } finally {
    __resetCopilotSeedBootstrapHooksForTests();
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

test('returns seed_copy_failed when the configured seed home is a file instead of a directory', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHomeFile = path.join(tempRoot, 'seed-file');

  try {
    await fs.writeFile(seedHomeFile, 'not-a-directory', 'utf8');

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome: path.join(tempRoot, 'runtime'),
      seedHome: seedHomeFile,
    });

    assert.equal(result.status, 'seed_copy_failed');
    assert.equal(result.seedHome, seedHomeFile);
    assert.match(result.error ?? '', /not a directory/u);
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

test('publish-failure cleanup removes only helper-owned staged artifacts without leaving a partial runtime behind', async () => {
  const tempRoot = await makeTempDir('copilot-seed-bootstrap-');
  const seedHome = path.join(tempRoot, 'seed');
  const runtimeHome = path.join(tempRoot, 'runtime');

  try {
    await writeSeedArtifacts(seedHome);
    __setCopilotSeedBootstrapHooksForTests({
      beforePublishArtifact: async ({ artifact }) => {
        if (artifact === 'config.json') {
          throw new Error('publish gate failed');
        }
      },
    });

    const result = await importCopilotSeedIntoRuntimeHome({
      runtimeHome,
      seedHome,
    });

    assert.equal(result.status, 'seed_copy_failed');
    assert.match(result.error ?? '', /publish gate failed/u);
    await assert.rejects(fs.access(path.join(runtimeHome, 'config.json')), {
      code: 'ENOENT',
    });
    await assert.rejects(fs.access(path.join(runtimeHome, 'settings.json')), {
      code: 'ENOENT',
    });
    await assert.rejects(
      fs.access(path.join(runtimeHome, 'session-state', 'session.json')),
      {
        code: 'ENOENT',
      },
    );
    assert.deepEqual(await listBootstrapStageRoots(tempRoot), []);
  } finally {
    __resetCopilotSeedBootstrapHooksForTests();
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
