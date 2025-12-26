import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { runAgentCommandRunner } from '../../agents/commandsRunner.js';

async function writeCommandFile(params: {
  agentHome: string;
  commandName: string;
  jsonText: string;
}): Promise<string> {
  const filePath = path.join(
    params.agentHome,
    'commands',
    `${params.commandName}.json`,
  );
  await fs.writeFile(filePath, params.jsonText, 'utf-8');
  return filePath;
}

test('command runner retries transient reconnect errors and succeeds', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-commands-runner-retry-'),
  );
  try {
    const agentHome = path.join(tmpDir, 'a1');
    await fs.mkdir(path.join(agentHome, 'commands'), { recursive: true });

    await writeCommandFile({
      agentHome,
      commandName: 'improve',
      jsonText: JSON.stringify({
        Description: 'Improve plan',
        items: [{ type: 'message', role: 'user', content: ['s1'] }],
      }),
    });

    const runAgentInstructionUnlocked = mock.fn(async () => {
      const attempt = runAgentInstructionUnlocked.mock.calls.length + 1;
      if (attempt <= 2) {
        throw new Error('Reconnecting... 1/5');
      }
      return { modelId: 'm1' };
    });

    const logger = {
      warn: mock.fn(),
      info: mock.fn(),
      error: mock.fn(),
    };

    const result = await runAgentCommandRunner({
      agentName: 'a1',
      agentHome,
      commandName: 'improve',
      conversationId: 'c1',
      source: 'REST',
      sleep: async () => undefined,
      logger,
      runAgentInstructionUnlocked,
    });

    assert.equal(runAgentInstructionUnlocked.mock.calls.length, 3);
    assert.equal(logger.warn.mock.calls.length, 2);
    assert.equal(logger.info.mock.calls.length, 1);
    assert.equal(logger.error.mock.calls.length, 0);

    assert.equal(result.conversationId, 'c1');
    assert.equal(result.modelId, 'm1');
    assert.equal(result.commandName, 'improve');
    assert.equal(result.agentName, 'a1');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
