import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getFlowDefinitionCatalog,
  resolveChildFlowDefinition,
} from '../../flows/flowDefinitionCatalog.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';

const definition = (description: string) =>
  JSON.stringify({
    description,
    steps: [{ type: 'wait', seconds: 1 }],
  });

const fixture = async (
  run: (paths: {
    root: string;
    working: string;
    local: string;
    fallback: string;
  }) => Promise<void>,
) => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'child-flow-catalog-')),
  );
  const working = path.join(root, 'working');
  const local = path.join(working, 'flows');
  const fallback = path.join(root, 'configured');
  await fs.mkdir(local, { recursive: true });
  await fs.mkdir(fallback);
  try {
    await runWithTestEnvOverrides(
      {
        FLOWS_DIR: fallback,
        CODEINFO_AGENT_HOME: path.join(working, 'codeinfo_agents'),
        CODEINFO_CODEX_AGENT_HOME: undefined,
      },
      () => run({ root, working, local, fallback }),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

test('child lookup uses local definitions and only absence permits configured fallback', async () => {
  await fixture(async ({ working, local, fallback }) => {
    await fs.writeFile(path.join(local, 'both.json'), definition('local'));
    await fs.writeFile(path.join(fallback, 'both.json'), definition('default'));
    await fs.writeFile(
      path.join(fallback, 'default-only.json'),
      definition('default-only'),
    );
    await fs.writeFile(path.join(local, 'invalid.json'), '{');
    await fs.writeFile(
      path.join(fallback, 'invalid.json'),
      definition('valid fallback'),
    );
    const lookup = (flowName: string) =>
      resolveChildFlowDefinition({ flowName, workingRepositoryPath: working });
    assert.equal((await lookup('both'))?.sourceId, working);
    assert.equal((await lookup('default-only'))?.flowsRoot, fallback);
    assert.equal((await lookup('default-only'))?.sourceId, undefined);
    assert.equal(await lookup('absent'), undefined);
    const invalid = await lookup('invalid');
    assert.equal(invalid?.flowsRoot, local);
    assert.equal(invalid?.entry.parsed?.ok, false);
  });
});

test('working equals harness still tries distinct FLOWS_DIR and deduplicates actual directory aliases', async (t) => {
  await fixture(async ({ root, working, local, fallback }) => {
    await fs.writeFile(
      path.join(fallback, 'child.json'),
      definition('configured custom'),
    );
    assert.equal(
      (
        await resolveChildFlowDefinition({
          flowName: 'child',
          workingRepositoryPath: working,
        })
      )?.flowsRoot,
      fallback,
    );
    const alias = path.join(root, 'alias');
    await fs.symlink(local, alias, 'dir');
    const catalog = await getFlowDefinitionCatalog(local);
    assert.equal(await getFlowDefinitionCatalog(alias), catalog);
    const originalReadDir = fs.readdir;
    const reads: string[] = [];
    const mocked = t.mock.method(
      fs,
      'readdir',
      (...args: Parameters<typeof fs.readdir>) => {
        reads.push(String(args[0]));
        return originalReadDir(...args);
      },
    );
    try {
      await runWithTestEnvOverrides({ FLOWS_DIR: alias }, async () => {
        assert.equal(
          await resolveChildFlowDefinition({
            flowName: 'missing',
            workingRepositoryPath: working,
          }),
          undefined,
        );
        assert.deepEqual(reads, []);
      });
    } finally {
      mocked.mock.restore();
    }
  });
});

test('child name traversal fails before any candidate filesystem probes', async (t) => {
  await fixture(async ({ working }) => {
    const probe = t.mock.method(fs, 'realpath', () => {
      throw new Error('unexpected directory probe');
    });
    try {
      for (const flowName of ['../escape', 'a/b', 'a\\b', '..', '']) {
        await assert.rejects(
          resolveChildFlowDefinition({
            flowName,
            workingRepositoryPath: working,
          }),
          /Invalid flow name/,
        );
      }
      assert.equal(probe.mock.callCount(), 0);
    } finally {
      probe.mock.restore();
    }
  });
});

test('unreadable local entry retains the underlying cause and never selects fallback', async (t) => {
  await fixture(async ({ working, local, fallback }) => {
    const localFile = path.join(local, 'child.json');
    await fs.writeFile(localFile, definition('local'));
    await fs.writeFile(
      path.join(fallback, 'child.json'),
      definition('fallback'),
    );
    const originalRead = fs.readFile;
    const mocked = t.mock.method(
      fs,
      'readFile',
      (...args: Parameters<typeof fs.readFile>) => {
        if (String(args[0]) === localFile)
          throw Object.assign(new Error('EACCES controlled local read'), {
            code: 'EACCES',
          });
        return originalRead(...args);
      },
    );
    try {
      const selected = await resolveChildFlowDefinition({
        flowName: 'child',
        workingRepositoryPath: working,
      });
      assert.equal(selected?.flowsRoot, local);
      assert.equal(selected?.entry.parsed, null);
      assert.match(
        selected?.entry.readError ?? '',
        /EACCES controlled local read/,
      );
    } finally {
      mocked.mock.restore();
    }
  });
});

test('local success does not probe an unusable configured fallback directory', async () => {
  await fixture(async ({ root, working, local }) => {
    await fs.writeFile(path.join(local, 'child.json'), definition('local'));
    const unusable = path.join(root, 'not-a-directory');
    await fs.writeFile(unusable, 'x');
    await runWithTestEnvOverrides(
      { FLOWS_DIR: path.join(unusable, 'flows') },
      async () => {
        assert.equal(
          (
            await resolveChildFlowDefinition({
              flowName: 'child',
              workingRepositoryPath: working,
            })
          )?.flowsRoot,
          local,
        );
      },
    );
  });
});

test('local catalog directory errors fail rather than using the configured definition', async () => {
  await fixture(async ({ working, local, fallback }) => {
    await fs.rm(local, { recursive: true });
    await fs.writeFile(local, 'not a directory');
    await fs.writeFile(
      path.join(fallback, 'child.json'),
      definition('fallback'),
    );
    await assert.rejects(
      resolveChildFlowDefinition({
        flowName: 'child',
        workingRepositoryPath: working,
      }),
      /ENOTDIR/,
    );
  });
});

test('child lookup keeps immutable local and fallback catalogs for their lifetime', async () => {
  await fixture(async ({ working, local, fallback }) => {
    await fs.writeFile(
      path.join(local, 'child.json'),
      definition('first local'),
    );
    await fs.writeFile(
      path.join(fallback, 'default.json'),
      definition('first default'),
    );
    const localFirst = await resolveChildFlowDefinition({
      flowName: 'child',
      workingRepositoryPath: working,
    });
    const defaultFirst = await resolveChildFlowDefinition({
      flowName: 'default',
      workingRepositoryPath: working,
    });
    await fs.writeFile(
      path.join(local, 'child.json'),
      definition('second local'),
    );
    await fs.writeFile(
      path.join(local, 'default.json'),
      definition('new local override'),
    );
    await fs.writeFile(
      path.join(fallback, 'default.json'),
      definition('second default'),
    );
    assert.equal(
      (
        await resolveChildFlowDefinition({
          flowName: 'child',
          workingRepositoryPath: working,
        })
      )?.entry,
      localFirst?.entry,
    );
    const defaultSecond = await resolveChildFlowDefinition({
      flowName: 'default',
      workingRepositoryPath: working,
    });
    assert.equal(defaultSecond?.entry, defaultFirst?.entry);
    assert.equal(defaultSecond?.flowsRoot, fallback);
  });
});
