import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildCopilotClientOptions,
  ensureCopilotAuthHomeCompatibility,
  ensureCopilotPlaintextTokenStorage,
  getCopilotConfigDirForHome,
  getCopilotStatePathForHome,
  inspectCopilotAuthLocations,
  resolveCopilotHome,
} from '../../config/copilotConfig.js';

test('resolves CODEINFO_COPILOT_HOME and derives the config path centrally', () => {
  const home = resolveCopilotHome('./tmp/copilot-home', {
    CODEINFO_COPILOT_HOME: './ignored',
  });
  const configDir = getCopilotConfigDirForHome(home);
  const authPath = getCopilotStatePathForHome(home, 'auth.json');

  assert.equal(home, path.resolve('./tmp/copilot-home'));
  assert.equal(configDir, home);
  assert.equal(authPath, path.join(home, 'auth.json'));
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

test('enables plaintext token storage without overwriting existing config keys', async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(process.cwd(), 'tmp-copilot-config-'),
  );

  try {
    const configPath = path.join(tempRoot, 'config.json');
    await fs.promises.writeFile(
      configPath,
      JSON.stringify({ firstLaunchAt: '2026-03-23T00:00:00.000Z' }, null, 2),
      'utf8',
    );

    const result = await ensureCopilotPlaintextTokenStorage(tempRoot);
    const parsed = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));

    assert.equal(result.changed, true);
    assert.equal(result.configPath, configPath);
    assert.equal(parsed.firstLaunchAt, '2026-03-23T00:00:00.000Z');
    assert.equal(parsed.store_token_plaintext, true);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
