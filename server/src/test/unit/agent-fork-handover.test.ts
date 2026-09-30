import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CopilotSession,
  SessionEvent,
  SessionEventHandler,
} from '@github/copilot-sdk';
import {
  ForkInstructionOutcomeUnknownError,
  sendPendingForkHandover,
} from '../../chat/forkHandover.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const userEvent = (content: string) =>
  ({ type: 'user.message', data: { content } }) as SessionEvent;

function eventWaiter() {
  let listener: SessionEventHandler | undefined;
  return {
    on: (handler: SessionEventHandler) => {
      listener = handler;
      return () => {
        listener = undefined;
      };
    },
    idle: () => listener?.({ type: 'session.idle', data: {} } as SessionEvent),
    error: () =>
      listener?.({
        type: 'session.error',
        data: { message: 'Provider run failed' },
      } as SessionEvent),
    active: () => !!listener,
  };
}

test('pending handover and instruction are separate ordered user messages in one run', async () => {
  let messages: unknown;
  let delivered = 0;
  const waiter = eventWaiter();
  const session = {
    on: waiter.on,
    getEvents: async () => [],
    rpc: {
      sendMessages: async (request: unknown) => {
        messages = request;
        assert.equal(waiter.active(), true);
        waiter.idle();
      },
    },
    sendAndWait: async () => {
      assert.fail('Unexpected second run');
    },
  } as unknown as CopilotSession;
  await sendPendingForkHandover({
    session,
    handovers: ['Target handover'],
    instruction: 'Next instruction',
    timeoutMs: resolveConfiguredTestTimeoutMs(1000),
    markDelivered: async () => {
      delivered++;
    },
  });
  assert.deepEqual(messages, {
    messages: [{ prompt: 'Target handover' }, { prompt: 'Next instruction' }],
    wait: false,
  });
  assert.equal(delivered, 1);
  assert.equal(waiter.active(), false);
});

test('crash after native acceptance is recovered from persisted events without duplicating handover', async () => {
  let accepted = false;
  let batchCount = 0;
  let nextCount = 0;
  const waiter = eventWaiter();
  const session = {
    on: waiter.on,
    getEvents: async () => (accepted ? [userEvent('Target handover')] : []),
    rpc: {
      sendMessages: async () => {
        batchCount++;
        accepted = true;
        throw new Error('Lost acknowledgement');
      },
    },
    sendAndWait: async ({ prompt }: { prompt: string }) => {
      nextCount++;
      assert.equal(prompt, 'Retry instruction');
    },
  } as unknown as CopilotSession;
  await assert.rejects(
    sendPendingForkHandover({
      session,
      handovers: ['Target handover'],
      instruction: 'Initial instruction',
      timeoutMs: resolveConfiguredTestTimeoutMs(1000),
      markDelivered: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof ForkInstructionOutcomeUnknownError);
      assert.match(error.message, /Lost acknowledgement/);
      return true;
    },
  );
  await sendPendingForkHandover({
    session,
    handovers: ['Target handover'],
    instruction: 'Retry instruction',
    timeoutMs: resolveConfiguredTestTimeoutMs(1000),
    markDelivered: async () => {},
  });
  assert.equal(batchCount, 1);
  assert.equal(nextCount, 1);
  assert.equal(waiter.active(), false);
});

test('fork-of-fork delivers inherited pending handovers once in order', async () => {
  let messages: unknown;
  const waiter = eventWaiter();
  const session = {
    on: waiter.on,
    getEvents: async () => [userEvent('Already delivered')],
    rpc: {
      sendMessages: async (request: unknown) => {
        messages = request;
        waiter.idle();
      },
    },
  } as unknown as CopilotSession;
  await sendPendingForkHandover({
    session,
    handovers: ['Already delivered', 'First target', 'Second target'],
    instruction: 'Continue',
    timeoutMs: resolveConfiguredTestTimeoutMs(1000),
    markDelivered: async () => {},
  });
  assert.deepEqual(messages, {
    messages: [
      { prompt: 'First target' },
      { prompt: 'Second target' },
      { prompt: 'Continue' },
    ],
    wait: false,
  });
});

test('recovered handover cancellation during Mongo acknowledgement prevents the next provider send', async () => {
  const controller = new AbortController();
  let entered!: () => void;
  let release!: () => void;
  const acknowledging = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = 0;
  const session = {
    getEvents: async () => [userEvent('Already delivered')],
    sendAndWait: async () => {
      sent++;
    },
    rpc: {
      sendMessages: async () => {
        assert.fail('Handover must not be resent');
      },
    },
  } as unknown as CopilotSession;
  const result = sendPendingForkHandover({
    session,
    handovers: ['Already delivered'],
    instruction: 'Cancelled instruction',
    timeoutMs: resolveConfiguredTestTimeoutMs(1000),
    signal: controller.signal,
    markDelivered: async () => {
      entered();
      await gate;
    },
  });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  try {
    await Promise.race([
      acknowledging,
      result.then(() => {
        throw new Error('Provider send completed before acknowledgement gate');
      }),
    ]);
    controller.abort();
    assert.equal(sent, 0);
  } finally {
    release();
    await rejected;
  }
  assert.equal(sent, 0);
});

test('stalled first batch is bounded by the configured timeout and removes its waiter', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeoutMs = resolveConfiguredTestTimeoutMs(1000);
  const waiter = eventWaiter();
  let release!: () => void;
  let sent!: () => void;
  const started = new Promise<void>((resolve) => {
    sent = resolve;
  });
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delivered = 0;
  const session = {
    on: waiter.on,
    getEvents: async () => [],
    rpc: {
      sendMessages: (request: { wait: boolean }) => {
        assert.equal(request.wait, false);
        assert.equal(waiter.active(), true);
        sent();
        return stalled;
      },
    },
  } as unknown as CopilotSession;
  const result = sendPendingForkHandover({
    session,
    handovers: ['Handover'],
    instruction: 'Next',
    timeoutMs,
    markDelivered: async () => {
      delivered++;
    },
  });
  const rejected = assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof ForkInstructionOutcomeUnknownError);
    assert.match(error.message, /Timeout.*Copilot fork instruction/);
    return true;
  });
  try {
    await started;
    assert.equal(delivered, 0);
    t.mock.timers.tick(timeoutMs);
    await rejected;
    assert.equal(waiter.active(), false);
    assert.equal(delivered, 0);
  } finally {
    release();
    await stalled;
  }
});

test('abort during first batch rejects once and removes listeners without acknowledging handover', async () => {
  const waiter = eventWaiter();
  const controller = new AbortController();
  let delivered = 0;
  const session = {
    on: waiter.on,
    getEvents: async () => [],
    rpc: {
      sendMessages: async () => {
        controller.abort();
      },
    },
  } as unknown as CopilotSession;
  await assert.rejects(
    sendPendingForkHandover({
      session,
      handovers: ['Handover'],
      instruction: 'Next',
      signal: controller.signal,
      timeoutMs: resolveConfiguredTestTimeoutMs(1000),
      markDelivered: async () => {
        delivered++;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof ForkInstructionOutcomeUnknownError, false);
      assert.match(error.message, /fork instruction aborted/);
      return true;
    },
  );
  assert.equal(waiter.active(), false);
  assert.equal(delivered, 0);
});

test('provider error before the batch acknowledgement rejects immediately and removes its waiter', async () => {
  const waiter = eventWaiter();
  let release!: () => void;
  const reply = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = {
    on: waiter.on,
    getEvents: async () => [],
    rpc: {
      sendMessages: () => {
        waiter.error();
        return reply;
      },
    },
  } as unknown as CopilotSession;
  try {
    await assert.rejects(
      sendPendingForkHandover({
        session,
        handovers: ['Handover'],
        instruction: 'Next',
        timeoutMs: resolveConfiguredTestTimeoutMs(1000),
        markDelivered: async () => {
          assert.fail('Failed run cannot acknowledge delivery');
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error instanceof ForkInstructionOutcomeUnknownError,
          false,
        );
        assert.match(error.message, /Provider run failed/);
        return true;
      },
    );
    assert.equal(waiter.active(), false);
  } finally {
    release();
    await reply;
  }
});

test('fork runtime disables source-only MCP servers before any instruction is sent', async () => {
  const { enforceForkMcpServers } = await import('../../chat/forkHandover.js');
  const disabled: string[] = [];
  const session = {
    rpc: {
      mcp: {
        list: async () => ({
          servers: [{ name: 'source_only' }, { name: 'target_server' }],
        }),
        disable: async ({ serverName }: { serverName: string }) => {
          disabled.push(serverName);
        },
      },
    },
  } as unknown as CopilotSession;
  await enforceForkMcpServers(session, {
    target_server: { type: 'local', command: 'target', args: [], tools: ['*'] },
  });
  assert.deepEqual(disabled, ['source_only']);
});

test('fork resume derives tools, reasoning and MCP settings from the target runtime rather than source defaults', async () => {
  const { ChatInterfaceCopilot } = await import(
    '../../chat/interfaces/ChatInterfaceCopilot.js'
  );
  const { CopilotLifecycle } = await import('../../chat/copilotLifecycle.js');
  const { withIsolatedProviderHomeTestEnv } = await import(
    '../support/providerHomeHarness.js'
  );
  await withIsolatedProviderHomeTestEnv({}, async (homes) => {
    const chat = new ChatInterfaceCopilot(
      new CopilotLifecycle({ copilotHome: homes.copilotHome }),
    );
    const config = chat.buildResumeSessionConfig('target-model', {
      isFork: true,
      workingDirectoryOverride: '/preserved/source/folder',
      runtimeConfig: {
        tool_access: 'off',
        reasoning_effort: 'high',
        mcp_servers: {
          target_server: { command: 'node', args: ['target-server.js'] },
        },
      },
      agentFlags: { toolAccess: 'on', modelReasoningEffort: 'low' },
    });
    assert.deepEqual(config.availableTools, []);
    assert.equal(config.reasoningEffort, 'high');
    assert.equal(config.workingDirectory, '/preserved/source/folder');
    assert.deepEqual(Object.keys(config.mcpServers ?? {}), ['target_server']);
    assert.deepEqual(config.mcpServers?.target_server.tools, []);
  });
});
