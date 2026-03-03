import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { listAgentPrompts } from '../../agents/service.js';

let tmpDir: string;
let prevAgentsHome: string | undefined;

type AgentSetup = {
  agentName: string;
  agentHome: string;
  workingFolder: string;
};

async function createAgentWithWorkingFolder(
  agentName = 'coding_agent',
): Promise<AgentSetup> {
  const agentHome = path.join(tmpDir, 'agents', agentName);
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'config.toml'), '# config', 'utf-8');

  const workingFolder = path.join(tmpDir, 'workspace');
  await fs.mkdir(workingFolder, { recursive: true });

  return { agentName, agentHome, workingFolder };
}

async function mkdirp(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeFile(filePath: string, contents = '# prompt') {
  await mkdirp(path.dirname(filePath));
  await fs.writeFile(filePath, contents, 'utf-8');
}

describe('agent prompts list service', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-prompts-list-'));
    prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    process.env.CODEINFO_CODEX_AGENT_HOME = path.join(tmpDir, 'agents');
    await mkdirp(process.env.CODEINFO_CODEX_AGENT_HOME);
  });

  afterEach(async () => {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("unknown agentName throws { code: 'AGENT_NOT_FOUND' }", async () => {
    await assert.rejects(
      async () =>
        listAgentPrompts({
          agentName: 'does-not-exist',
          working_folder: '/tmp',
        }),
      (err) => (err as { code?: string }).code === 'AGENT_NOT_FOUND',
    );
  });

  test('relative working_folder throws WORKING_FOLDER_INVALID', async () => {
    const setup = await createAgentWithWorkingFolder();
    await assert.rejects(
      async () =>
        listAgentPrompts({
          agentName: setup.agentName,
          working_folder: 'relative/path',
        }),
      (err) => (err as { code?: string }).code === 'WORKING_FOLDER_INVALID',
    );
  });

  test('missing working_folder path throws WORKING_FOLDER_NOT_FOUND', async () => {
    const setup = await createAgentWithWorkingFolder();
    const missing = path.join(tmpDir, 'nope');
    await assert.rejects(
      async () =>
        listAgentPrompts({
          agentName: setup.agentName,
          working_folder: missing,
        }),
      (err) => (err as { code?: string }).code === 'WORKING_FOLDER_NOT_FOUND',
    );
  });

  test('case-insensitive .github/prompts detection succeeds', async () => {
    const setup = await createAgentWithWorkingFolder();
    await writeFile(
      path.join(setup.workingFolder, '.GITHUB', 'Prompts', 'Start.md'),
      '# start',
    );

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    assert.deepEqual(res, {
      prompts: [
        {
          relativePath: 'Start.md',
          fullPath: path.resolve(
            setup.workingFolder,
            '.GITHUB',
            'Prompts',
            'Start.md',
          ),
        },
      ],
    });
  });

  test('recursive prompt discovery returns nested markdown files', async () => {
    const setup = await createAgentWithWorkingFolder();
    await writeFile(
      path.join(
        setup.workingFolder,
        '.github',
        'prompts',
        'onboarding',
        'start.md',
      ),
    );
    await writeFile(
      path.join(setup.workingFolder, '.github', 'prompts', 'ops', 'runbook.md'),
    );

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    assert.equal(res.prompts.length, 2);
    assert.ok(
      res.prompts.some(
        (prompt) => prompt.relativePath === 'onboarding/start.md',
      ),
    );
    assert.ok(
      res.prompts.some((prompt) => prompt.relativePath === 'ops/runbook.md'),
    );
  });

  test('markdown extension filter includes .md/.MD/*.prompt.md and excludes non-markdown files', async () => {
    const setup = await createAgentWithWorkingFolder();
    const promptsRoot = path.join(setup.workingFolder, '.github', 'prompts');
    await writeFile(path.join(promptsRoot, 'a.md'));
    await writeFile(path.join(promptsRoot, 'b.MD'));
    await writeFile(path.join(promptsRoot, 'c.prompt.md'));
    await writeFile(path.join(promptsRoot, 'd.txt'));
    await writeFile(path.join(promptsRoot, 'e.md.txt'));

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    assert.deepEqual(
      res.prompts.map((item) => item.relativePath),
      ['a.md', 'b.MD', 'c.prompt.md'],
    );
  });

  test('symlink files/directories under prompts tree are ignored', async (t) => {
    const setup = await createAgentWithWorkingFolder();
    const promptsRoot = path.join(setup.workingFolder, '.github', 'prompts');
    await writeFile(path.join(promptsRoot, 'keep.md'));

    const outsideDir = path.join(tmpDir, 'outside');
    await mkdirp(outsideDir);
    await writeFile(path.join(outsideDir, 'outside.md'));

    try {
      await fs.symlink(outsideDir, path.join(promptsRoot, 'linked-dir'));
      await fs.symlink(
        path.join(outsideDir, 'outside.md'),
        path.join(promptsRoot, 'linked-file.md'),
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        t.skip('symlink creation is not permitted in this environment');
        return;
      }
      throw error;
    }

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    assert.deepEqual(
      res.prompts.map((item) => item.relativePath),
      ['keep.md'],
    );
  });

  test('prompts are sorted by normalized relativePath', async () => {
    const setup = await createAgentWithWorkingFolder();
    await writeFile(
      path.join(setup.workingFolder, '.github', 'prompts', 'z.md'),
    );
    await writeFile(
      path.join(setup.workingFolder, '.github', 'prompts', 'a', 'c.md'),
    );
    await writeFile(
      path.join(setup.workingFolder, '.github', 'prompts', 'a.md'),
    );

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    assert.deepEqual(
      res.prompts.map((item) => item.relativePath),
      ['a.md', 'a/c.md', 'z.md'],
    );
  });

  test('all returned relativePath values use forward slashes', async () => {
    const setup = await createAgentWithWorkingFolder();
    await writeFile(
      path.join(
        setup.workingFolder,
        '.github',
        'prompts',
        'nested',
        'prompt.md',
      ),
    );

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    for (const item of res.prompts) {
      assert.equal(item.relativePath.includes('\\'), false);
      assert.equal(item.relativePath.includes('/'), true);
    }
  });

  test('output shape keeps fullPath absolute and relativePath non-absolute/non-parent', async () => {
    const setup = await createAgentWithWorkingFolder();
    await writeFile(
      path.join(setup.workingFolder, '.github', 'prompts', 'safe.md'),
    );

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    for (const item of res.prompts) {
      assert.equal(path.isAbsolute(item.fullPath), true);
      assert.equal(path.isAbsolute(item.relativePath), false);
      assert.equal(item.relativePath.startsWith('..'), false);
    }
  });

  test('missing .github/prompts returns empty prompts array', async () => {
    const setup = await createAgentWithWorkingFolder();

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    assert.deepEqual(res, { prompts: [] });
  });

  test('existing prompts directory with no markdown files returns empty prompts array', async () => {
    const setup = await createAgentWithWorkingFolder();
    const promptsRoot = path.join(setup.workingFolder, '.github', 'prompts');
    await writeFile(path.join(promptsRoot, 'notes.txt'), 'plain text');

    const res = await listAgentPrompts({
      agentName: setup.agentName,
      working_folder: setup.workingFolder,
    });

    assert.deepEqual(res, { prompts: [] });
  });
});
