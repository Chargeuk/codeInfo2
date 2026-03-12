import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  __resetMarkdownFileResolverDepsForTests,
  __setMarkdownFileResolverDepsForTests,
  resolveMarkdownFile,
} from '../../flows/markdownFileResolver.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { query, resetStore } from '../../logStore.js';

type Harness = {
  tmpDir: string;
  codeInfo2Root: string;
  codeInfo2AgentsHome: string;
  repoOne: string;
  repoTwo: string;
  repoThree: string;
};

const buildRepoEntry = (params: {
  id: string;
  containerPath: string;
}): RepoEntry => ({
  id: params.id,
  description: null,
  containerPath: params.containerPath,
  hostPath: params.containerPath,
  lastIngestAt: null,
  embeddingProvider: 'lmstudio',
  embeddingModel: 'text-embedding',
  embeddingDimensions: 768,
  modelId: 'test-model',
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

const ensureMarkdownFile = async (
  repoRoot: string,
  relativePath: string,
  content: string | Uint8Array,
) => {
  const filePath = path.join(repoRoot, 'codeinfo_markdown', relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return filePath;
};

const createHarness = async (): Promise<Harness> => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-markdown-resolver-'),
  );
  const codeInfo2Root = path.join(tmpDir, 'codeinfo2');
  const codeInfo2AgentsHome = path.join(codeInfo2Root, 'codex_agents');
  const repoOne = path.join(tmpDir, 'repo-one');
  const repoTwo = path.join(tmpDir, 'repo-two');
  const repoThree = path.join(tmpDir, 'repo-three');

  await fs.mkdir(codeInfo2AgentsHome, { recursive: true });
  await fs.mkdir(repoOne, { recursive: true });
  await fs.mkdir(repoTwo, { recursive: true });
  await fs.mkdir(repoThree, { recursive: true });

  return {
    tmpDir,
    codeInfo2Root,
    codeInfo2AgentsHome,
    repoOne,
    repoTwo,
    repoThree,
  };
};

describe('resolveMarkdownFile', () => {
  let harness: Harness;
  let previousAgentsHome: string | undefined;

  beforeEach(async () => {
    harness = await createHarness();
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    process.env.CODEINFO_CODEX_AGENT_HOME = harness.codeInfo2AgentsHome;
    resetStore();
    __resetMarkdownFileResolverDepsForTests();
  });

  afterEach(async () => {
    __resetMarkdownFileResolverDepsForTests();
    resetStore();
    if (previousAgentsHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
    }
    await fs.rm(harness.tmpDir, { recursive: true, force: true });
  });

  test('resolves local direct-command markdown from codeInfo2 when sourceId is absent', async () => {
    await ensureMarkdownFile(harness.codeInfo2Root, 'local.md', 'local direct');
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
    });

    const content = await resolveMarkdownFile({ markdownFile: 'local.md' });

    assert.equal(content, 'local direct');
    const logs = query({ text: 'DEV-0000045:T3:markdown_file_resolved' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.context?.resolutionScope, 'direct-command');
    assert.equal(logs[0]?.context?.resolvedSourceId, harness.codeInfo2Root);
  });

  test('resolves direct-command markdown from the ingested sourceId first', async () => {
    await ensureMarkdownFile(
      harness.codeInfo2Root,
      'shared.md',
      'codeinfo2 fallback',
    );
    await ensureMarkdownFile(harness.repoOne, 'shared.md', 'source repo');
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({
              id: 'Source Repo',
              containerPath: harness.repoOne,
            }),
          ],
        }) as never,
    });

    const content = await resolveMarkdownFile({
      markdownFile: 'shared.md',
      sourceId: harness.repoOne,
    });

    assert.equal(content, 'source repo');
  });

  test('resolves flow markdown from the same-source repository first', async () => {
    await ensureMarkdownFile(harness.codeInfo2Root, 'flow.md', 'codeinfo2');
    await ensureMarkdownFile(harness.repoOne, 'flow.md', 'flow source');
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({ id: 'Flow Repo', containerPath: harness.repoOne }),
          ],
        }) as never,
    });

    const content = await resolveMarkdownFile({
      markdownFile: 'flow.md',
      flowSourceId: harness.repoOne,
    });

    assert.equal(content, 'flow source');
  });

  test('falls back to codeInfo2 after a same-source miss', async () => {
    await ensureMarkdownFile(
      harness.codeInfo2Root,
      'fallback.md',
      'codeinfo2 fallback',
    );
    await ensureMarkdownFile(harness.repoTwo, 'fallback.md', 'other repo');
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({ id: 'Flow Repo', containerPath: harness.repoOne }),
            buildRepoEntry({ id: 'Zulu', containerPath: harness.repoTwo }),
          ],
        }) as never,
    });

    const content = await resolveMarkdownFile({
      markdownFile: 'fallback.md',
      flowSourceId: harness.repoOne,
    });

    assert.equal(content, 'codeinfo2 fallback');
  });

  test('falls back to other repositories only after same-source and codeInfo2 miss', async () => {
    await ensureMarkdownFile(harness.repoTwo, 'ordered.md', 'alpha repo');
    await ensureMarkdownFile(harness.repoThree, 'ordered.md', 'zulu repo');
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({ id: 'Zulu', containerPath: harness.repoThree }),
            buildRepoEntry({ id: 'Alpha', containerPath: harness.repoTwo }),
          ],
        }) as never,
    });

    const content = await resolveMarkdownFile({ markdownFile: 'ordered.md' });

    assert.equal(content, 'alpha repo');
  });

  test('accepts root-level markdown lookups inside codeinfo_markdown', async () => {
    await ensureMarkdownFile(harness.codeInfo2Root, 'file.md', 'root file');
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
    });

    const content = await resolveMarkdownFile({ markdownFile: 'file.md' });

    assert.equal(content, 'root file');
  });

  test('accepts nested markdown lookups inside codeinfo_markdown', async () => {
    await ensureMarkdownFile(
      harness.codeInfo2Root,
      'nested/file.md',
      'nested file',
    );
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
    });

    const content = await resolveMarkdownFile({
      markdownFile: 'nested/file.md',
    });

    assert.equal(content, 'nested file');
  });

  test('returns valid UTF-8 markdown containing non-ASCII characters verbatim', async () => {
    await ensureMarkdownFile(
      harness.codeInfo2Root,
      'unicode.md',
      'Café, mañana, 東京, &amp;',
    );
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
    });

    const content = await resolveMarkdownFile({ markdownFile: 'unicode.md' });

    assert.equal(content, 'Café, mañana, 東京, &amp;');
  });

  test('uses source path as a stable tie-breaker when labels match case-insensitively', async () => {
    await ensureMarkdownFile(harness.repoTwo, 'tie.md', 'first path');
    await ensureMarkdownFile(harness.repoThree, 'tie.md', 'second path');
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({
              id: 'same-label',
              containerPath: harness.repoThree,
            }),
            buildRepoEntry({
              id: 'SAME-LABEL',
              containerPath: harness.repoTwo,
            }),
          ],
        }) as never,
    });

    const content = await resolveMarkdownFile({ markdownFile: 'tie.md' });

    assert.equal(content, 'second path');
  });

  test('fails clearly when all repository candidates miss', async () => {
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({ id: 'Alpha', containerPath: harness.repoOne }),
            buildRepoEntry({ id: 'Beta', containerPath: harness.repoTwo }),
          ],
        }) as never,
    });

    await assert.rejects(
      () => resolveMarkdownFile({ markdownFile: 'missing.md' }),
      /was not found in any codeinfo_markdown repository candidate/,
    );
  });

  test('fails fast when a higher-priority repository file cannot be read', async () => {
    const blockedPath = await ensureMarkdownFile(
      harness.repoOne,
      'blocked.md',
      'source file',
    );
    await ensureMarkdownFile(
      harness.codeInfo2Root,
      'blocked.md',
      'fallback file',
    );
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({ id: 'Flow Repo', containerPath: harness.repoOne }),
          ],
        }) as never,
      readFile: async (filePath) => {
        if (path.resolve(filePath.toString()) === path.resolve(blockedPath)) {
          const error = new Error(
            'simulated read failure',
          ) as NodeJS.ErrnoException;
          error.code = 'EIO';
          throw error;
        }
        return fs.readFile(filePath);
      },
    });

    await assert.rejects(
      () =>
        resolveMarkdownFile({
          markdownFile: 'blocked.md',
          flowSourceId: harness.repoOne,
        }),
      /Failed to read markdownFile blocked\.md/,
    );
  });

  test('surfaces explicit permission failures clearly', async () => {
    const blockedPath = await ensureMarkdownFile(
      harness.repoOne,
      'permission.md',
      'source file',
    );
    await ensureMarkdownFile(
      harness.codeInfo2Root,
      'permission.md',
      'fallback file',
    );
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () =>
        ({
          repos: [
            buildRepoEntry({ id: 'Flow Repo', containerPath: harness.repoOne }),
          ],
        }) as never,
      readFile: async (filePath) => {
        if (path.resolve(filePath.toString()) === path.resolve(blockedPath)) {
          const error = new Error('permission denied') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
        return fs.readFile(filePath);
      },
    });

    await assert.rejects(
      () =>
        resolveMarkdownFile({
          markdownFile: 'permission.md',
          flowSourceId: harness.repoOne,
        }),
      /permission denied/,
    );
  });

  test('rejects invalid UTF-8 markdown bytes', async () => {
    await ensureMarkdownFile(
      harness.codeInfo2Root,
      'invalid-utf8.md',
      Uint8Array.from([0xc3, 0x28]),
    );
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
    });

    await assert.rejects(
      () => resolveMarkdownFile({ markdownFile: 'invalid-utf8.md' }),
      /Invalid UTF-8 markdown content/,
    );
  });

  test('rejects empty markdownFile paths before reading files', async () => {
    let readCalls = 0;
    __setMarkdownFileResolverDepsForTests({
      listIngestedRepositories: async () => ({ repos: [] }) as never,
      readFile: async (filePath) => {
        readCalls += 1;
        return fs.readFile(filePath);
      },
    });

    await assert.rejects(
      () => resolveMarkdownFile({ markdownFile: '   ' }),
      /must not be empty/,
    );
    assert.equal(readCalls, 0);
  });

  test('rejects absolute markdownFile paths', async () => {
    await assert.rejects(
      () => resolveMarkdownFile({ markdownFile: '/tmp/file.md' }),
      /must be a relative path under codeinfo_markdown/,
    );
  });

  test('rejects parent-directory traversal in markdownFile paths', async () => {
    await assert.rejects(
      () => resolveMarkdownFile({ markdownFile: '../escape.md' }),
      /must not use parent-directory traversal/,
    );
  });

  test('rejects normalized escape attempts that would leave codeinfo_markdown', async () => {
    await assert.rejects(
      () => resolveMarkdownFile({ markdownFile: 'nested/../../escape.md' }),
      /must not use parent-directory traversal/,
    );
  });
});
