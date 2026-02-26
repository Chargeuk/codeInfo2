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
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  delete process.env.FLOW_AND_COMMAND_RETRIES;
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

    const seenInstructions: string[] = [];
    const runAgentInstructionUnlocked = mock.fn(async (callParams) => {
      const attempt = runAgentInstructionUnlocked.mock.calls.length + 1;
      const instruction = (callParams as { instruction?: string } | undefined)
        ?.instruction;
      seenInstructions.push(instruction ?? '');
      if (attempt <= 4) {
        throw new Error('Reconnecting... 1/5');
      }
      assert.equal(
        typeof instruction === 'string',
        true,
        'instruction should be passed to command runner',
      );
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

    assert.equal(runAgentInstructionUnlocked.mock.calls.length, 5);
    assert.equal(logger.warn.mock.calls.length, 4);
    assert.equal(logger.info.mock.calls.length, 1);
    assert.equal(logger.error.mock.calls.length, 0);
    assert.equal(
      seenInstructions[1]?.startsWith(
        'Your previous attempt at this task failed with the error "',
      ),
      true,
    );
    assert.equal(seenInstructions[1]?.includes('\n' + 's1'), true);

    assert.equal(result.conversationId, 'c1');
    assert.equal(result.modelId, 'm1');
    assert.equal(result.commandName, 'improve');
    assert.equal(result.agentName, 'a1');
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('command runner sanitizes and truncates retry context text', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-commands-runner-retry-context-'),
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

    const longSecretError = `api_key=sk-this-should-not-leak ${'x'.repeat(500)}`;
    const seenInstructions: string[] = [];
    const runAgentInstructionUnlocked = mock.fn(async (callParams) => {
      const instruction = (callParams as { instruction?: string } | undefined)
        ?.instruction;
      seenInstructions.push(instruction ?? '');
      throw new Error(longSecretError);
    });

    await assert.rejects(() =>
      runAgentCommandRunner({
        agentName: 'a1',
        agentHome,
        commandName: 'improve',
        conversationId: 'c1',
        source: 'REST',
        sleep: async () => undefined,
        logger: {
          warn: mock.fn(),
          info: mock.fn(),
          error: mock.fn(),
        },
        runAgentInstructionUnlocked,
      }),
    );

    const secondAttemptInstruction = seenInstructions[1] ?? '';
    assert.equal(secondAttemptInstruction.includes('api_key=<redacted>'), true);
    assert.equal(
      secondAttemptInstruction.includes('sk-this-should-not-leak'),
      false,
    );
    assert.equal(secondAttemptInstruction.length < 500, true);
  } finally {
    if (previousRetries === undefined) {
      delete process.env.FLOW_AND_COMMAND_RETRIES;
    } else {
      process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
