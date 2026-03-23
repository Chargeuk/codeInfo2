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
  assert.equal(configDir, path.join(home, 'config'));
  assert.equal(authPath, path.join(home, 'config', 'auth.json'));
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

test('creates a ~/.copilot compatibility symlink when HOME differs from the configured copilot home', async () => {
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
