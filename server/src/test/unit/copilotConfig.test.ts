import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildCopilotClientOptions,
  getCopilotConfigDirForHome,
  getCopilotStatePathForHome,
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
