import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import rootLock from '../../../../package-lock.json' with { type: 'json' };
import rootPackage from '../../../../package.json' with { type: 'json' };
import serverPackage from '../../../package.json' with { type: 'json' };

const CODEX_VERSION = '0.145.0';
const COPILOT_CLI_VERSION = '1.0.75';
const COPILOT_SDK_VERSION = '1.0.8';
const COPILOT_SDK_NODE_ENGINE = '^20.19.0 || >=22.12.0';
const REPOSITORY_NODE_ENGINE = '>=22.12.0';
const ROOT_ZOD_VERSION = '3.25.76';
const TESTING_LIBRARY_DOM_VERSION = '10.4.1';

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
  assert.equal(rootPackage.engines.node, REPOSITORY_NODE_ENGINE);
  assert.equal(serverPackage.engines.node, REPOSITORY_NODE_ENGINE);
  assert.equal(rootLock.packages['']?.engines.node, REPOSITORY_NODE_ENGINE);
  assert.equal(rootLock.packages.server.engines.node, REPOSITORY_NODE_ENGINE);
  assert.equal(
    rootLock.packages['node_modules/@github/copilot-sdk']?.engines.node,
    COPILOT_SDK_NODE_ENGINE,
  );
  assert.equal(
    rootLock.packages['node_modules/@github/copilot']?.version,
    COPILOT_CLI_VERSION,
  );

  assert.match(globalPackages, /^@openai\/codex@0\.145\.0$/mu);
  assert.match(globalPackages, /^@github\/copilot@1\.0\.75$/mu);
});

test('provider Zod majors and Testing Library peers remain isolated in the lockfile', () => {
  assert.equal(serverPackage.dependencies.zod, ROOT_ZOD_VERSION);
  assert.equal('zod' in rootPackage.overrides, false);
  assert.equal(rootPackage.overrides['@lmstudio/sdk'].zod, ROOT_ZOD_VERSION);
  assert.equal(
    rootLock.packages.client.devDependencies['@testing-library/dom'],
    TESTING_LIBRARY_DOM_VERSION,
  );

  assert.equal(
    rootLock.packages['node_modules/zod']?.version,
    ROOT_ZOD_VERSION,
  );
  assert.equal(
    rootLock.packages['node_modules/@lmstudio/sdk']?.dependencies.zod,
    '^3.22.4',
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      rootLock.packages,
      'node_modules/@lmstudio/sdk/node_modules/zod',
    ),
    false,
  );
  assert.equal(
    rootLock.packages['node_modules/@github/copilot-sdk']?.dependencies.zod,
    '^4.3.6',
  );
  assert.match(
    rootLock.packages['node_modules/@github/copilot-sdk/node_modules/zod']
      ?.version ?? '',
    /^4\./u,
  );
  assert.equal(
    rootLock.packages['node_modules/@testing-library/dom']?.version,
    TESTING_LIBRARY_DOM_VERSION,
  );
});
