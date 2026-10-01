import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import rootLock from '../../../../package-lock.json' with { type: 'json' };
import rootPackage from '../../../../package.json' with { type: 'json' };
import serverPackage from '../../../package.json' with { type: 'json' };

const CODEX_VERSION = '0.159.2';
const OPENAI_VERSION = '7.25.0';
const COPILOT_CLI_VERSION = '1.0.89';
const COPILOT_SDK_VERSION = '1.0.15';
const COPILOT_SDK_NODE_ENGINE = '^20.19.0 || >=22.12.0';
const REPOSITORY_NODE_ENGINE = '>=22.12.0';
const ROOT_ZOD_VERSION = '3.25.76';
const TESTING_LIBRARY_DOM_VERSION = '10.4.1';

type LockEntry = {
  version?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
};
const lockPackages = rootLock.packages as Record<string, LockEntry | undefined>;
const workspaceLockEntries = (packageName: string) => {
  const entries = [
    `node_modules/${packageName}`,
    `server/node_modules/${packageName}`,
  ].flatMap((path) => {
    const entry = lockPackages[path];
    return entry ? [{ path, entry }] : [];
  });
  assert.ok(
    entries.length > 0,
    `${packageName} must be present in the root or server lockfile tree`,
  );
  return entries;
};

const assertWorkspaceLockVersion = (
  packageName: string,
  expectedVersion: string,
) => {
  const resolvedVersions = workspaceLockEntries(packageName).map(
    ({ entry }) => entry.version,
  );
  assert.deepEqual([...new Set(resolvedVersions)], [expectedVersion]);
};

test('provider SDK, CLI, and container pins remain aligned with the lockfile', () => {
  const globalPackages = fs.readFileSync(
    new URL('../../../npm-global.txt', import.meta.url),
    'utf8',
  );

  assert.equal(
    serverPackage.dependencies['@github/copilot'],
    COPILOT_CLI_VERSION,
  );
  assert.equal(serverPackage.dependencies['@openai/codex'], CODEX_VERSION);
  assert.equal(serverPackage.dependencies['@openai/codex-sdk'], CODEX_VERSION);
  assert.equal(serverPackage.dependencies.openai, OPENAI_VERSION);
  assert.equal(
    serverPackage.dependencies['@github/copilot-sdk'],
    COPILOT_SDK_VERSION,
  );

  assertWorkspaceLockVersion('@openai/codex', CODEX_VERSION);
  assertWorkspaceLockVersion('@openai/codex-sdk', CODEX_VERSION);
  assertWorkspaceLockVersion('openai', OPENAI_VERSION);
  assertWorkspaceLockVersion('@github/copilot-sdk', COPILOT_SDK_VERSION);
  assert.equal(rootPackage.engines.node, REPOSITORY_NODE_ENGINE);
  assert.equal(serverPackage.engines.node, REPOSITORY_NODE_ENGINE);
  assert.equal(rootLock.packages['']?.engines.node, REPOSITORY_NODE_ENGINE);
  assert.equal(rootLock.packages.server.engines.node, REPOSITORY_NODE_ENGINE);
  for (const { entry } of workspaceLockEntries('@github/copilot-sdk'))
    assert.equal(entry.engines?.node, COPILOT_SDK_NODE_ENGINE);
  assertWorkspaceLockVersion('@github/copilot', COPILOT_CLI_VERSION);

  assert.ok(
    globalPackages.split(/\r?\n/u).includes(`@openai/codex@${CODEX_VERSION}`),
  );
  assert.match(globalPackages, /^@github\/copilot@1\.0\.89$/mu);
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
  for (const { path, entry } of workspaceLockEntries('@github/copilot-sdk')) {
    assert.equal(entry.dependencies?.zod, '4.3.6');
    // Follow Node's nearest-install resolution without assuming SDK hoisting.
    const zod =
      lockPackages[`${path}/node_modules/zod`] ??
      (path.startsWith('server/')
        ? lockPackages['server/node_modules/zod']
        : undefined) ??
      lockPackages['node_modules/zod'];
    assert.match(zod?.version ?? '', /^4\./u);
  }
  assert.equal(
    rootLock.packages['node_modules/@testing-library/dom']?.version,
    TESTING_LIBRARY_DOM_VERSION,
  );
});
