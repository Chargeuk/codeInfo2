import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import rootLock from '../../../../package-lock.json' with { type: 'json' };
import serverPackage from '../../../package.json' with { type: 'json' };

const CODEX_VERSION = '0.145.0';
const COPILOT_CLI_VERSION = '1.0.75';
const COPILOT_SDK_VERSION = '1.0.8';

test('provider SDK, CLI, and container pins remain aligned with the lockfile', () => {
  const globalPackages = fs.readFileSync(
    new URL('../../../npm-global.txt', import.meta.url),
    'utf8',
  );

  assert.equal(serverPackage.dependencies['@openai/codex'], CODEX_VERSION);
  assert.equal(serverPackage.dependencies['@openai/codex-sdk'], CODEX_VERSION);
  assert.equal(
    serverPackage.dependencies['@github/copilot-sdk'],
    COPILOT_SDK_VERSION,
  );

  assert.equal(
    rootLock.packages['node_modules/@openai/codex']?.version,
    CODEX_VERSION,
  );
  assert.equal(
    rootLock.packages['node_modules/@openai/codex-sdk']?.version,
    CODEX_VERSION,
  );
  assert.equal(
    rootLock.packages['node_modules/@github/copilot-sdk']?.version,
    COPILOT_SDK_VERSION,
  );
  assert.equal(
    rootLock.packages['node_modules/@github/copilot']?.version,
    COPILOT_CLI_VERSION,
  );

  assert.match(globalPackages, /^@openai\/codex@0\.145\.0$/mu);
  assert.match(globalPackages, /^@github\/copilot@1\.0\.75$/mu);
});
