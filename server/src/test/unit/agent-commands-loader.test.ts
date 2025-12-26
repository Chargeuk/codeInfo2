import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { loadAgentCommandSummary } from '../../agents/commandsLoader.js';

describe('agent command loader (v1)', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
    tmpDir = null;
  });

  test('returns enabled summary for valid command file', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-loader-'));
    const filePath = path.join(tmpDir, 'good.json');

    await fs.writeFile(
      filePath,
      JSON.stringify({
        Description: 'My command',
        items: [{ type: 'message', role: 'user', content: ['x'] }],
      }),
      'utf-8',
    );

    const summary = await loadAgentCommandSummary({
      filePath,
      name: 'good',
    });

    assert.deepEqual(summary, {
      name: 'good',
      description: 'My command',
      disabled: false,
    });
  });

  test('returns disabled summary when schema invalid', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-commands-loader-'));
    const filePath = path.join(tmpDir, 'bad-schema.json');

    await fs.writeFile(
      filePath,
      JSON.stringify({
        Description: 'My command',
        items: [],
      }),
      'utf-8',
    );

    const summary = await loadAgentCommandSummary({
      filePath,
      name: 'bad-schema',
    });

    assert.deepEqual(summary, {
      name: 'bad-schema',
      description: 'Invalid command file',
      disabled: true,
    });
  });

  test('returns disabled summary when file read fails', async () => {
    const summary = await loadAgentCommandSummary({
      filePath: '/does/not/exist.json',
      name: 'missing',
    });

    assert.deepEqual(summary, {
      name: 'missing',
      description: 'Invalid command file',
      disabled: true,
    });
  });
});
