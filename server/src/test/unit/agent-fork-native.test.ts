import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { SessionEvent } from '@github/copilot-sdk';
import { resolveForkBoundary } from '../../agents/forkHistory.js';
import {
  hasCodexRolloutInjected,
  mapCopilotForkTurns,
  openForkNative,
  readCompletedCodexTurn,
} from '../../agents/forkNative.js';
import { CodexAppServer } from '../../codex/appServer.js';
import type { TurnSummary } from '../../mongo/repo.js';

const event = (
  id: string,
  type: string,
  data: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  ({
    id,
    type,
    data,
    timestamp: '2026-09-29T00:00:00Z',
    parentId: null,
    ...extra,
  }) as SessionEvent;

test('Copilot exclusive cutoff keeps terminal marker and excludes the next persisted event even while a later turn runs', () => {
  const events = [
    event('u1', 'user.message', { content: 'First prompt' }),
    event('start1', 'assistant.turn_start', { turnId: 'turn1' }),
    event('message1', 'assistant.message', { content: 'First answer' }),
    event('end1', 'assistant.turn_end', { turnId: 'turn1' }),
    event('idle', 'session.idle', {}, { ephemeral: true }),
    event('u2', 'user.message', { content: 'Later prompt' }),
    event('start2', 'assistant.turn_start', { turnId: 'turn2' }),
  ];
  const turns = mapCopilotForkTurns(events);
  assert.equal(turns[0].eventId, 'end1');
  assert.equal(turns[0].nextEventId, 'u2');
  assert.equal(turns[0].completed, true);
  assert.equal(turns[1].completed, false);
});

test('Copilot idle tail has no persisted successor, and subagent turns cannot replace main-agent boundaries', () => {
  const turns = mapCopilotForkTurns([
    event('u', 'user.message', { content: 'Prompt' }),
    event('main-start', 'assistant.turn_start', { turnId: 'main' }),
    event(
      'child-start',
      'assistant.turn_start',
      { turnId: 'child' },
      { agentId: 'child-agent' },
    ),
    event(
      'child-message',
      'assistant.message',
      { content: 'Subagent response' },
      { agentId: 'child-agent' },
    ),
    event('main-message', 'assistant.message', { content: 'Main response' }),
    event('main-end', 'assistant.turn_end', { turnId: 'main' }),
    event('idle', 'session.idle', {}, { ephemeral: true }),
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].assistant, 'Main response');
  assert.equal(turns[0].nextEventId, undefined);
});

test('Codex rollout injection check tolerates only an unterminated malformed tail', () => {
  const injected = JSON.stringify({
    type: 'response_item',
    payload: { role: 'user', content: [{ text: 'handover' }] },
  });
  assert.equal(hasCodexRolloutInjected('', 'handover'), false);
  assert.equal(hasCodexRolloutInjected(`${injected}\n`, 'handover'), true);
  assert.equal(
    hasCodexRolloutInjected(`${injected}\n{"partial":`, 'handover'),
    true,
  );
  assert.equal(hasCodexRolloutInjected('{"partial":', 'handover'), false);
  assert.throws(() => hasCodexRolloutInjected('{bad}\n', 'handover'));
  assert.throws(() =>
    hasCodexRolloutInjected(`{bad}\n${injected}`, 'handover'),
  );
});

function nativeRpcHarness(
  result: (method: string, params: Record<string, unknown>) => unknown,
) {
  const requests: Array<{
    method: string;
    params: Record<string, unknown>;
  }> = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: () => true,
  });
  child.stdin.on('data', (line: Buffer) => {
    const message = JSON.parse(line.toString()) as {
      id?: number;
      method: string;
      params: Record<string, unknown>;
    };
    if (message.id === undefined) return;
    requests.push(message);
    let response: { result?: unknown; error?: { message: string } };
    try {
      response = {
        result:
          message.method === 'initialize'
            ? {}
            : result(message.method, message.params),
      };
    } catch (error) {
      // A fixture assertion must fail the RPC, not strand the writable stream
      // before finish and hide that assertion behind a writer-close timeout.
      response = {
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    child.stdout.write(JSON.stringify({ id: message.id, ...response }) + '\n');
  });
  child.stdin.once('finish', () => child.emit('close', 0, null));
  return {
    requests,
    createServer: () =>
      new CodexAppServer((() => child) as unknown as typeof spawn),
    dispose: () => {
      child.stdin.destroy();
      child.stdout.destroy();
    },
  };
}

for (const status of ['completed', 'failed', 'interrupted', 'inProgress']) {
  test(`completion metadata uses one descending header and preserves ${status} semantics`, async () => {
    const h = nativeRpcHarness((method, params) => {
      assert.equal(method, 'thread/turns/list');
      assert.deepEqual(params, {
        threadId: 'source',
        limit: 1,
        sortDirection: 'desc',
        itemsView: 'notLoaded',
      });
      return { data: [{ id: 'newest', status }], nextCursor: 'older-pages' };
    });
    try {
      assert.deepEqual(
        await readCompletedCodexTurn('source', h.createServer),
        status === 'completed'
          ? { sessionId: 'source', turnId: 'newest' }
          : undefined,
      );
      assert.deepEqual(
        h.requests.map((request) => request.method),
        ['initialize', 'thread/turns/list'],
      );
    } finally {
      h.dispose();
    }
  });
}

test('exact Codex fork sends selected lastTurnId and excludes turns without reading source history', async () => {
  const h = nativeRpcHarness((method, params) => {
    assert.equal(method, 'thread/fork');
    assert.deepEqual(params, {
      threadId: 'source',
      lastTurnId: 'earlier-completed',
      excludeTurns: true,
      model: 'target-model',
      cwd: '/target',
      config: { model: 'target-model' },
    });
    return { thread: { id: 'child', path: '/owned/rollout' } };
  });
  const native = await openForkNative('codex', 'source', false, h.createServer);
  try {
    assert.deepEqual(native.turns, []);
    assert.equal(
      await native.fork(
        {
          id: 'earlier-completed',
          completed: true,
          user: '',
          assistant: '',
        },
        { model: 'target-model' },
        'target-model',
        '/target',
      ),
      'child',
    );
    assert.deepEqual(
      h.requests.map((request) => request.method),
      ['initialize', 'thread/fork'],
    );
  } finally {
    await native.close();
    h.dispose();
  }
});

test('legacy Codex fork loads native items only when boundary lookup is required', async () => {
  const h = nativeRpcHarness((method, params) => {
    assert.equal(method, 'thread/turns/list');
    assert.deepEqual(params, {
      threadId: 'source',
      sortDirection: 'asc',
      itemsView: 'full',
    });
    return {
      data: [
        {
          id: 'legacy-turn',
          status: 'completed',
          items: [
            { type: 'userMessage', content: [{ text: 'Prompt' }] },
            { type: 'agentMessage', text: 'Answer' },
          ],
        },
      ],
      nextCursor: null,
    };
  });
  const native = await openForkNative('codex', 'source', true, h.createServer);
  try {
    assert.deepEqual(native.turns, [
      {
        id: 'legacy-turn',
        completed: true,
        user: 'Prompt',
        assistant: 'Answer',
      },
    ]);
  } finally {
    await native.close();
    h.dispose();
  }
});

test('native RPC fixture assertion failures preserve their cause and close the owned writer gracefully', async () => {
  const h = nativeRpcHarness(() => {
    assert.fail('Native history fixture rejected');
  });
  let rpc: CodexAppServer | undefined;
  try {
    await assert.rejects(
      openForkNative('codex', 'source', true, () => {
        rpc = h.createServer();
        return rpc;
      }),
      {
        code: 'FORK_NATIVE_UNAVAILABLE',
        message:
          'Codex native history is unavailable: Native history fixture rejected',
      },
    );
    assert.equal(rpc?.isWriterTerminated(), true);
    assert.deepEqual(
      h.requests.map((request) => request.method),
      ['initialize', 'thread/turns/list'],
    );
  } finally {
    h.dispose();
  }
});

test('repeated nonempty native history cursor rejects and closes the owned RPC', async () => {
  let historyRequests = 0;
  const h = nativeRpcHarness((method, params) => {
    assert.equal(method, 'thread/turns/list');
    assert.ok(++historyRequests <= 2, 'Native history requested a third page');
    assert.equal(params.itemsView, 'full');
    assert.equal(params.sortDirection, 'asc');
    assert.ok(params.cursor === undefined || params.cursor === 'same-page');
    return { data: [], nextCursor: 'same-page' };
  });
  let rpc: CodexAppServer | undefined;
  try {
    await assert.rejects(
      openForkNative('codex', 'source', true, () => {
        rpc = h.createServer();
        return rpc;
      }),
      {
        code: 'FORK_NATIVE_UNAVAILABLE',
        message:
          'Codex native history is unavailable: Codex native history cursor did not advance',
      },
    );
    assert.equal(rpc?.isWriterTerminated(), true);
    assert.deepEqual(
      h.requests.map((request) => request.method),
      ['initialize', 'thread/turns/list', 'thread/turns/list'],
    );
  } finally {
    h.dispose();
  }
});

test('legacy native boundary lookup preserves full content and order across every ascending page', async () => {
  const h = nativeRpcHarness((method, params) => {
    if (method === 'thread/fork') {
      assert.equal(params.lastTurnId, 'selected');
      assert.equal(params.excludeTurns, true);
      return { thread: { id: 'child' } };
    }
    assert.equal(method, 'thread/turns/list');
    assert.equal(params.itemsView, 'full');
    assert.equal(params.sortDirection, 'asc');
    if (!params.cursor)
      return {
        data: [
          {
            id: 'first',
            status: 'completed',
            items: [
              {
                type: 'userMessage',
                content: [{ type: 'text', text: 'First prompt' }],
              },
              { type: 'agentMessage', text: 'First answer' },
            ],
          },
        ],
        nextCursor: 'page-two',
      };
    assert.equal(params.cursor, 'page-two');
    return {
      data: [
        {
          id: 'selected',
          status: 'completed',
          items: [
            {
              type: 'userMessage',
              content: [
                { type: 'text', text: 'Selected prompt' },
                { type: 'text', text: 'Full context' },
              ],
            },
            { type: 'agentMessage', text: 'Intermediate text' },
            { type: 'agentMessage', text: 'Selected complete answer' },
          ],
        },
        {
          id: 'running',
          status: 'inProgress',
          items: [
            {
              type: 'userMessage',
              content: [{ type: 'text', text: 'Later prompt' }],
            },
          ],
        },
      ],
      nextCursor: null,
    };
  });
  const native = await openForkNative('codex', 'source', true, h.createServer);
  try {
    assert.deepEqual(native.turns, [
      {
        id: 'first',
        completed: true,
        user: 'First prompt',
        assistant: 'First answer',
      },
      {
        id: 'selected',
        completed: true,
        user: 'Selected prompt\nFull context',
        assistant: 'Selected complete answer',
      },
      { id: 'running', completed: false, user: 'Later prompt', assistant: '' },
    ]);
    const snapshot: TurnSummary[] = ['user', 'assistant'].map(
      (role, index) => ({
        turnId: `stored-${index}`,
        conversationId: 'source',
        role: role as 'user' | 'assistant',
        content:
          index === 0
            ? 'Selected prompt\nFull context'
            : 'Selected complete answer',
        provider: 'codex',
        model: 'old-model',
        source: 'REST',
        status: 'ok',
        toolCalls: null,
        createdAt: new Date(index),
      }),
    );
    const boundary = resolveForkBoundary(snapshot, native.turns);
    assert.equal(boundary.turn.id, 'selected');
    assert.equal(boundary.estimated, true);
    await native.fork(boundary.turn, {}, 'gpt-6.1-terra');
    assert.deepEqual(
      h.requests.map((request) => request.method),
      ['initialize', 'thread/turns/list', 'thread/turns/list', 'thread/fork'],
    );
  } finally {
    await native.close();
    h.dispose();
  }
});
