import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { mock } from 'node:test';

import {
  CopilotManagedJsonArtifactError,
  buildCopilotClientOptions,
  ensureCopilotBaseConfigSeeded,
  ensureCopilotAuthHomeCompatibility,
  ensureLmStudioBaseConfigSeeded,
  ensureCopilotPlaintextTokenStorage,
  getCopilotConfigPathForHome,
  getCopilotChatConfigPathForHome,
  getCopilotConfigDirForHome,
  getLmStudioConfigPathForHome,
  getCopilotSettingsPathForHome,
  getCopilotStatePathForHome,
  inspectCopilotAuthLocations,
  readCopilotManagedJsonObject,
  resolveCopilotHome,
} from '../../config/copilotConfig.js';

test('resolves CODEINFO_COPILOT_HOME and derives the config path centrally', () => {
  const home = resolveCopilotHome('./tmp/copilot-home', {
    CODEINFO_COPILOT_HOME: './ignored',
  });
  const configDir = getCopilotConfigDirForHome(home);
  const chatConfigPath = getCopilotChatConfigPathForHome(home);
  const settingsPath = getCopilotSettingsPathForHome(home);
  const authPath = getCopilotStatePathForHome(home, 'auth.json');

  assert.equal(home, path.resolve('./tmp/copilot-home'));
  assert.equal(configDir, home);
  assert.equal(chatConfigPath, path.join(home, 'chat', 'config.toml'));
  assert.equal(settingsPath, path.join(home, 'settings.json'));
  assert.equal(authPath, path.join(home, 'auth.json'));
});

test('keeps the seeded Copilot chat defaults path separate from the runtime configDir', () => {
  const home = resolveCopilotHome('./tmp/copilot-home', {
    CODEINFO_COPILOT_HOME: './ignored',
  });

  assert.equal(
    getCopilotConfigDirForHome(home),
    path.resolve('./tmp/copilot-home'),
  );
  assert.equal(
    getCopilotChatConfigPathForHome(home),
    path.join(path.resolve('./tmp/copilot-home'), 'chat', 'config.toml'),
  );
});

test('buildCopilotClientOptions resolves COPILOT_HOME and optional cliPath together', () => {
  const resolved = buildCopilotClientOptions({
    copilotHome: './tmp/copilot-home',
    cliPath: '/usr/local/bin/copilot',
  });

  assert.equal(resolved.copilotHome, path.resolve('./tmp/copilot-home'));
  assert.equal(
    resolved.clientOptions.env?.COPILOT_HOME,
    path.resolve('./tmp/copilot-home'),
  );
  assert.equal(resolved.clientOptions.cliPath, '/usr/local/bin/copilot');
  assert.equal(resolved.cliMode, 'cliPath');
});

test('seeds copilot/config.toml through the startup-owned provider base-config path', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-base-config-'),
  );

  try {
    const home = path.join(tempRoot, 'copilot');
    const configPath = await ensureCopilotBaseConfigSeeded(home);

    assert.equal(configPath, getCopilotConfigPathForHome(home));
    assert.equal(fs.existsSync(configPath), true);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('seeds lmstudio/config.toml through the startup-owned provider base-config path', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-lmstudio-base-config-'),
  );

  try {
    const home = path.join(tempRoot, 'lmstudio');
    const configPath = await ensureLmStudioBaseConfigSeeded(home);

    assert.equal(configPath, getLmStudioConfigPathForHome(home));
    assert.equal(fs.existsSync(configPath), true);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('cleans up a failed provider-base bootstrap temp file so a later retry can succeed', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-provider-base-config-failure-'),
  );

  try {
    const home = path.join(tempRoot, 'copilot');
    const configPath = getCopilotConfigPathForHome(home);
    const renameMock = mock.method(fs.promises, 'rename', async () => {
      const error = Object.assign(new Error('simulated rename failure'), {
        code: 'EIO',
      });
      throw error;
    });

    await assert.rejects(
      ensureCopilotBaseConfigSeeded(home),
      /simulated rename failure/u,
    );
    renameMock.mock.restore();

    assert.equal(fs.existsSync(configPath), false);
    const entries = await fs.promises.readdir(home);
    assert.deepEqual(entries, []);

    const retriedPath = await ensureCopilotBaseConfigSeeded(home);
    assert.equal(retriedPath, configPath);
    assert.equal(fs.existsSync(configPath), true);
  } finally {
    mock.restoreAll();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('provider base-config bootstrap keeps a newer config that appears after the missing-state check and leaves no temp artifact behind', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-provider-base-config-race-'),
  );
  const originalLink = fs.promises.link;

  try {
    const home = path.join(tempRoot, 'copilot');
    const configPath = getCopilotConfigPathForHome(home);
    const linkMock = mock.method(
      fs.promises,
      'link',
      async (existingPath: fs.PathLike, newPath: fs.PathLike) => {
        await fs.promises.writeFile(
          configPath,
          '# newer config won\n',
          'utf8',
        );
        return originalLink.call(fs.promises, existingPath, newPath);
      },
    );

    const seededPath = await ensureCopilotBaseConfigSeeded(home);
    linkMock.mock.restore();

    assert.equal(seededPath, configPath);
    assert.equal(await fs.promises.readFile(configPath, 'utf8'), '# newer config won\n');
    const entries = await fs.promises.readdir(home);
    assert.deepEqual(entries, ['config.toml']);
  } finally {
    mock.restoreAll();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('keeps an explicitly configured CODEINFO_COPILOT_HOME as the primary contract without creating a ~/.copilot symlink', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const env = {
      HOME: path.join(tempRoot, 'home'),
      CODEINFO_COPILOT_HOME: path.join(tempRoot, 'mounted-copilot-home'),
    };
    const copilotHome = env.CODEINFO_COPILOT_HOME;

    const compatibility = await ensureCopilotAuthHomeCompatibility(
      copilotHome,
      env,
    );
    const diagnostics = await inspectCopilotAuthLocations(copilotHome, env);

    assert.equal(compatibility.action, 'none');
    assert.equal(diagnostics.compatStatus, 'missing');
    assert.equal(diagnostics.compatPath, path.join(env.HOME, '.copilot'));
    await assert.rejects(fs.promises.lstat(diagnostics.compatPath), {
      code: 'ENOENT',
    });
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('can still create a ~/.copilot compatibility symlink as fallback when no explicit home is configured', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const env = {
      HOME: path.join(tempRoot, 'home'),
    };
    const copilotHome = path.join(tempRoot, 'mounted-copilot-home');

    const compatibility = await ensureCopilotAuthHomeCompatibility(
      copilotHome,
      env,
    );
    const diagnostics = await inspectCopilotAuthLocations(copilotHome, env);

    assert.equal(compatibility.action, 'created_symlink');
    assert.equal(diagnostics.compatStatus, 'linked');
    assert.equal(diagnostics.compatPath, path.join(env.HOME, '.copilot'));
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('readCopilotManagedJsonObject returns missing for absent artifacts', async () => {
  const artifactPath = path.join(
    process.cwd(),
    'tmp-copilot-config-missing',
    'settings.json',
  );

  const result = await readCopilotManagedJsonObject(artifactPath);

  assert.deepEqual(result, {
    status: 'missing',
    artifactPath,
  });
});

test('readCopilotManagedJsonObject accepts commented JSONC objects', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const configPath = path.join(tempRoot, 'config.json');
    await fs.promises.writeFile(
      configPath,
      '{\n  // Copilot-managed compatibility metadata\n  "store_token_plaintext": true,\n}\n',
      'utf8',
    );

    const result = await readCopilotManagedJsonObject(configPath);

    assert.equal(result.status, 'present');
    assert.equal(result.artifactPath, configPath);
    assert.equal(result.value.store_token_plaintext, true);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('readCopilotManagedJsonObject rejects malformed and non-object JSON deterministically', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const malformedPath = path.join(tempRoot, 'settings.json');
    await fs.promises.writeFile(
      malformedPath,
      '{"storeTokenPlaintext":',
      'utf8',
    );

    await assert.rejects(
      readCopilotManagedJsonObject(malformedPath),
      (error: unknown) =>
        error instanceof CopilotManagedJsonArtifactError &&
        error.message === 'copilot settings.json is malformed',
    );

    await fs.promises.writeFile(malformedPath, '[]', 'utf8');
    await assert.rejects(
      readCopilotManagedJsonObject(malformedPath),
      /copilot settings\.json is malformed/u,
    );
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('enables plaintext token storage without overwriting existing settings keys', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const settingsPath = path.join(tempRoot, 'settings.json');
    await fs.promises.writeFile(
      settingsPath,
      JSON.stringify({ firstLaunchAt: '2026-03-23T00:00:00.000Z' }, null, 2),
      'utf8',
    );

    const result = await ensureCopilotPlaintextTokenStorage(tempRoot);
    const parsed = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));

    assert.equal(result.changed, true);
    assert.equal(result.settingsPath, settingsPath);
    assert.equal(parsed.firstLaunchAt, '2026-03-23T00:00:00.000Z');
    assert.equal(parsed.storeTokenPlaintext, true);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('managed settings normalization keeps newer settings that appear after a stale read and leaves no temp artifact behind', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-settings-race-'),
  );
  let injectedConcurrentWrite = false;
  const originalWriteFile = fs.promises.writeFile;

  try {
    const settingsPath = path.join(tempRoot, 'settings.json');
    await fs.promises.writeFile(
      settingsPath,
      JSON.stringify({ firstLaunchAt: '2026-03-23T00:00:00.000Z' }, null, 2),
      'utf8',
    );

    const writeMock = mock.method(
      fs.promises,
      'writeFile',
      async (
        file: unknown,
        data: unknown,
        options?: unknown,
      ) => {
        const result = await originalWriteFile.call(
          fs.promises,
          file,
          data as never,
          options as never,
        );
        if (
          !injectedConcurrentWrite &&
          typeof file === 'string' &&
          file.includes('settings.json.') &&
          file.endsWith('.tmp')
        ) {
          injectedConcurrentWrite = true;
          await originalWriteFile.call(
            fs.promises,
            settingsPath,
            `${JSON.stringify(
              {
                firstLaunchAt: '2026-04-01T00:00:00.000Z',
                storeTokenPlaintext: true,
                concurrentMarker: 'preserved',
              },
              null,
              2,
            )}\n`,
            'utf8',
          );
        }
        return result;
      },
    );

    const result = await ensureCopilotPlaintextTokenStorage(tempRoot);
    writeMock.mock.restore();

    const parsed = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));
    const entries = await fs.promises.readdir(tempRoot);

    assert.equal(result.changed, false);
    assert.deepEqual(parsed, {
      firstLaunchAt: '2026-04-01T00:00:00.000Z',
      storeTokenPlaintext: true,
      concurrentMarker: 'preserved',
    });
    assert.deepEqual(entries, ['settings.json']);
  } finally {
    mock.restoreAll();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('migrates a commented legacy config fallback into settings.json without rewriting config.json', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const configPath = path.join(tempRoot, 'config.json');
    const legacyConfig =
      '{\n  // Copilot-managed compatibility metadata\n  "store_token_plaintext": true,\n}\n';
    await fs.promises.writeFile(configPath, legacyConfig, 'utf8');

    const result = await ensureCopilotPlaintextTokenStorage(tempRoot);
    const settingsPath = path.join(tempRoot, 'settings.json');
    const parsed = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));

    assert.equal(result.changed, true);
    assert.equal(result.settingsPath, settingsPath);
    assert.equal(parsed.storeTokenPlaintext, true);
    assert.equal(await fs.promises.readFile(configPath, 'utf8'), legacyConfig);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('rejects malformed existing settings deterministically without leaving temp files behind', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const settingsPath = path.join(tempRoot, 'settings.json');
    await fs.promises.writeFile(
      settingsPath,
      '{"storeTokenPlaintext":',
      'utf8',
    );

    await assert.rejects(
      ensureCopilotPlaintextTokenStorage(tempRoot),
      /copilot settings\.json is malformed/u,
    );

    const entries = await fs.promises.readdir(tempRoot);
    assert.deepEqual(entries, ['settings.json']);
    assert.equal(
      await fs.promises.readFile(settingsPath, 'utf8'),
      '{"storeTokenPlaintext":',
    );
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
