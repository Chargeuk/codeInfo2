import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { SessionEvent } from '@github/copilot-sdk';
import {
  resolveForkBoundary,
  resolveVerifiedCodexBoundary,
} from '../../agents/forkHistory.js';
import {
  hasCodexRolloutInjected,
  mapCopilotForkTurns,
  openForkNative,
  readCompletedCodexTurn,
  readCodexRunCheckpoint,
} from '../../agents/forkNative.js';
import { CodexAppServer } from '../../codex/appServer.js';
import { readCodexRollout } from '../../codex/rolloutHistory.js';
import type { TurnSummary } from '../../mongo/repo.js';
import { createIsolatedProviderHomeEnv } from '../support/providerHomeHarness.js';

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
  const homes: Array<string | undefined> = [];
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
    homes,
    createServer: (codexHome?: string) =>
      new CodexAppServer(
        ((
          _command: string,
          _args: string[],
          options: { env?: NodeJS.ProcessEnv },
        ) => {
          homes.push(options.env?.CODEX_HOME);
          return child;
        }) as unknown as typeof spawn,
        codexHome,
      ),
    dispose: () => {
      child.stdin.destroy();
      child.stdout.destroy();
    },
  };
}

const canonicalTask = (
  id: string,
  user: string | string[] = 'Prompt',
  messages = ['Answer'],
  complete = true,
) => [
  { type: 'event_msg', payload: { type: 'task_started', turn_id: id } },
  ...(Array.isArray(user) ? user : [user]).map((text) => ({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    },
  })),
  ...messages.map((text, index) => ({
    type: 'response_item',
    payload: {
      id: `${id}-${index}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    },
  })),
  ...(complete
    ? [
        {
          type: 'event_msg',
          payload: {
            type: 'task_complete',
            turn_id: id,
            last_agent_message: messages.at(-1),
          },
        },
      ]
    : []),
];
const canonicalLog = (records: unknown[], sessionId = 'source') =>
  [{ type: 'session_meta', payload: { id: sessionId } }, ...records]
    .map((record) => JSON.stringify(record))
    .join('\n') + '\n';

for (const status of ['completed', 'failed', 'interrupted', 'inProgress']) {
  test(`completion metadata requires actual canonical completion for ${status}`, async () => {
    const isolated = await createIsolatedProviderHomeEnv('native-capture-');
    const file = path.join(isolated.codexHome, 'canonical.jsonl');
    await fs.writeFile(
      file,
      canonicalLog([
        ...canonicalTask(
          'newest',
          'Prompt',
          ['Answer'],
          status !== 'inProgress',
        ),
        ...(status === 'failed' || status === 'interrupted'
          ? [
              {
                type: 'event_msg',
                payload: {
                  type: status === 'failed' ? 'task_failed' : 'turn_aborted',
                  turn_id: 'newest',
                },
              },
            ]
          : []),
      ]),
    );
    const h = nativeRpcHarness((method, params) => {
      assert.equal(method, 'thread/read');
      assert.deepEqual(params, { threadId: 'source', includeTurns: false });
      return { thread: { id: 'source', path: file } };
    });
    try {
      assert.equal(
        await readCompletedCodexTurn(
          'source',
          { fresh: false, prompt: 'Prompt', assistant: 'Answer' },
          isolated.codexHome,
          h.createServer,
        ),
        undefined,
      );
      assert.deepEqual(
        await readCompletedCodexTurn(
          'source',
          { fresh: true, prompt: 'Prompt', assistant: 'Answer' },
          isolated.codexHome,
          () => h.createServer(isolated.codexHome),
        ),
        status === 'completed'
          ? { sessionId: 'source', turnId: 'newest' }
          : undefined,
      );
      assert.deepEqual(
        h.requests.map((request) => request.method),
        ['initialize', 'thread/read'],
      );
      assert.deepEqual(h.homes, [isolated.codexHome]);
    } finally {
      h.dispose();
      await isolated.cleanup();
    }
  });
}

test('fresh capture matches the exact prompt among individual user messages', async () => {
  const isolated = await createIsolatedProviderHomeEnv('native-multiuser-');
  const file = path.join(isolated.codexHome, 'canonical.jsonl');
  const h = nativeRpcHarness(() => ({ thread: { id: 'source', path: file } }));
  try {
    await fs.writeFile(
      file,
      canonicalLog(
        canonicalTask('actual', ['Synthetic preamble', 'Prompt', 'Prompt']),
      ),
    );
    const history = await readCodexRollout(file, 'source');
    assert.equal(history.turns[0].user, 'Synthetic preamble\nPrompt\nPrompt');
    assert.deepEqual(history.turns[0].userMessages, [
      'Synthetic preamble',
      'Prompt',
      'Prompt',
    ]);
    assert.deepEqual(
      await readCompletedCodexTurn(
        'source',
        { fresh: true, prompt: 'Prompt', assistant: 'Answer' },
        isolated.codexHome,
        h.createServer,
      ),
      { sessionId: 'source', turnId: 'actual' },
    );
  } finally {
    h.dispose();
    await isolated.cleanup();
  }
});

test('resumed capture rejects old completed history and verifies the new composed task after its checkpoint', async () => {
  const isolated = await createIsolatedProviderHomeEnv('native-checkpoint-');
  const file = path.join(isolated.codexHome, 'canonical.jsonl');
  const create = () =>
    nativeRpcHarness(() => ({ thread: { id: 'source', path: file } }));
  const first = create(),
    stale = create(),
    current = create(),
    wrong = create(),
    active = create();
  try {
    await fs.writeFile(
      file,
      canonicalLog(canonicalTask('old', 'Prompt', ['One.', 'Two.'])),
    );
    const checkpoint = await readCodexRunCheckpoint(
      'source',
      isolated.codexHome,
      first.createServer,
    );
    const proof = {
      fresh: false,
      checkpoint,
      prompt: 'Prompt',
      assistant: 'One.Two.',
    };
    assert.equal(
      await readCompletedCodexTurn(
        'source',
        proof,
        isolated.codexHome,
        stale.createServer,
      ),
      undefined,
    );
    await fs.appendFile(
      file,
      canonicalTask(
        'actual',
        ['Synthetic preamble', 'Prompt'],
        ['One.', 'Two.'],
      )
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n',
    );
    assert.deepEqual(
      await readCompletedCodexTurn(
        'source',
        proof,
        isolated.codexHome,
        current.createServer,
      ),
      { sessionId: 'source', turnId: 'actual' },
    );
    assert.equal(
      await readCompletedCodexTurn(
        'source',
        { ...proof, prompt: 'Unrelated prompt' },
        isolated.codexHome,
        wrong.createServer,
      ),
      undefined,
    );
    await fs.appendFile(
      file,
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'still-running' },
      }) + '\n',
    );
    assert.equal(
      await readCompletedCodexTurn(
        'source',
        proof,
        isolated.codexHome,
        active.createServer,
      ),
      undefined,
    );
  } finally {
    for (const fixture of [first, stale, current, wrong, active])
      fixture.dispose();
    await isolated.cleanup();
  }
});

test('canonical reader verifies session identity, ignores typed duplicates/compaction, and tolerates only an incomplete final line', async () => {
  const isolated = await createIsolatedProviderHomeEnv('native-records-');
  const file = path.join(isolated.codexHome, 'canonical.jsonl');
  try {
    await fs.writeFile(
      file,
      canonicalLog([
        ...canonicalTask('actual', 'Prompt', ['One.', 'Two.']),
        {
          type: 'item_completed',
          payload: { type: 'AgentMessage', text: 'Duplicate' },
        },
        { type: 'compacted', payload: {} },
      ]) + '{"partial":',
    );
    const result = await readCodexRollout(file, 'source');
    assert.equal(result.turns[0].assistant, 'One.Two.');
    assert.equal(result.turns[0].finalAssistant, 'Two.');
    assert.equal(result.turns[0].completed, true);
    await assert.rejects(
      readCodexRollout(file, 'wrong-session'),
      /session does not match/u,
    );
    await fs.appendFile(file, '\n');
    await assert.rejects(readCodexRollout(file, 'source'));
  } finally {
    await isolated.cleanup();
  }
});

for (const terminated of [false, true]) {
  test(`canonical task_complete ${terminated ? 'with' : 'without'} its newline ${terminated ? 'verifies' : 'cannot verify'} a native boundary`, async () => {
    const isolated = await createIsolatedProviderHomeEnv('canonical-tail-');
    const file = path.join(isolated.codexHome, 'canonical.jsonl');
    const h = nativeRpcHarness((method, params) => {
      assert.equal(method, 'thread/read');
      assert.deepEqual(params, { threadId: 'source', includeTurns: false });
      return { thread: { id: 'source', path: file } };
    });
    try {
      await fs.writeFile(
        file,
        canonicalLog(
          canonicalTask('previous', 'Earlier prompt', ['Earlier answer']),
        ),
      );
      const checkpoint = await readCodexRollout(file, 'source');
      await fs.appendFile(
        file,
        canonicalTask('current')
          .map((record) => JSON.stringify(record))
          .join('\n') + (terminated ? '\n' : ''),
      );
      const history = await readCodexRollout(file, 'source');
      assert.deepEqual(
        history.turns.map((turn) => [turn.id, turn.completed]),
        [
          ['previous', true],
          ['current', terminated],
        ],
      );
      const rows: TurnSummary[] = ['user', 'assistant'].map((role, index) => ({
        turnId: `stored-${index}`,
        conversationId: 'source',
        role: role as 'user' | 'assistant',
        content: index ? 'Answer' : 'Prompt',
        provider: 'codex',
        model: 'old',
        source: 'REST',
        status: 'ok',
        toolCalls: null,
        createdAt: new Date(index),
      }));
      if (terminated) {
        assert.equal(
          resolveVerifiedCodexBoundary(rows, history.turns).turn.id,
          'current',
        );
      } else {
        assert.throws(() => resolveVerifiedCodexBoundary(rows, history.turns), {
          code: 'FORK_HISTORY_UNAVAILABLE',
        });
      }
      assert.deepEqual(
        await readCompletedCodexTurn(
          'source',
          { fresh: false, checkpoint, prompt: 'Prompt', assistant: 'Answer' },
          isolated.codexHome,
          h.createServer,
        ),
        terminated ? { sessionId: 'source', turnId: 'current' } : undefined,
      );
    } finally {
      h.dispose();
      await isolated.cleanup();
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
      ['initialize', 'thread/turns/list', 'thread/read'],
    );
  } finally {
    h.dispose();
  }
});

for (const indexState of ['empty', 'failed', 'stale'] as const) {
  test(`canonical recovery works with ${indexState} projection and forks the exact native ID`, async () => {
    const isolated = await createIsolatedProviderHomeEnv('canonical-recovery-');
    const file = path.join(isolated.codexHome, 'canonical.jsonl');
    const h = nativeRpcHarness((method, params) => {
      if (method === 'thread/turns/list') {
        if (indexState === 'failed') throw new Error('Projection unavailable');
        if (indexState === 'stale')
          return {
            data: [
              {
                id: 'stale-index-id',
                status: 'completed',
                items: [
                  { type: 'userMessage', content: [{ text: 'Prompt' }] },
                  { type: 'agentMessage', text: 'Old answer' },
                ],
              },
            ],
            nextCursor: null,
          };
        return { data: [], nextCursor: null };
      }
      if (method === 'thread/read')
        return { thread: { id: 'source', path: file } };
      assert.equal(method, 'thread/fork');
      assert.equal(params.lastTurnId, 'actual');
      assert.equal(params.excludeTurns, true);
      return { thread: { id: 'child' } };
    });
    let native: Awaited<ReturnType<typeof openForkNative>> | undefined;
    try {
      await fs.writeFile(
        file,
        canonicalLog(canonicalTask('actual', ['Synthetic preamble', 'Prompt'])),
      );
      native = await openForkNative('codex', 'source', true, h.createServer);
      const rows: TurnSummary[] = ['user', 'assistant'].map((role, index) => ({
        turnId: `stored-${index}`,
        conversationId: 'source',
        role: role as 'user' | 'assistant',
        content: index ? 'Answer' : 'Prompt',
        provider: 'codex',
        model: 'old',
        source: 'REST',
        status: 'ok',
        toolCalls: null,
        createdAt: new Date(index),
      }));
      const boundary = await native.recoverBoundary!(rows);
      assert.equal(boundary.turn.id, 'actual');
      assert.equal(boundary.estimated, false);
      assert.equal(
        await native.fork(boundary.turn, {}, 'gpt-6.1-terra'),
        'child',
      );
    } finally {
      if (native) await native.close();
      h.dispose();
      await isolated.cleanup();
    }
  });
}

for (const indexedAnswer of ['Answer', 'Final', 'Compacted text']) {
  test(`an inherited missing-ID reply preserves indexed ${indexedAnswer} without requiring the child rollout to contain it`, async () => {
    const isolated = await createIsolatedProviderHomeEnv('inherited-boundary-');
    const file = path.join(isolated.codexHome, 'child.jsonl');
    const h = nativeRpcHarness((method, params) => {
      if (method === 'thread/turns/list') {
        return {
          data: [
            {
              id: 'inherited-turn',
              status: 'completed',
              items: [
                { type: 'userMessage', content: [{ text: 'Prompt' }] },
                { type: 'agentMessage', text: indexedAnswer },
              ],
            },
          ],
          nextCursor: null,
        };
      }
      if (method === 'thread/read') {
        assert.deepEqual(params, { threadId: 'source', includeTurns: false });
        return { thread: { id: 'source', path: file } };
      }
      assert.equal(
        method,
        'thread/fork',
        'Inherited indexed history needs no ancestor file traversal',
      );
      assert.equal(params.threadId, 'source');
      assert.equal(params.lastTurnId, 'inherited-turn');
      assert.equal(params.excludeTurns, true);
      return { thread: { id: 'child' } };
    });
    let native: Awaited<ReturnType<typeof openForkNative>> | undefined;
    try {
      await fs.writeFile(
        file,
        canonicalLog(
          canonicalTask('local-turn', 'Local prompt', ['Local answer']),
        ),
      );
      assert.equal(
        (await readCodexRollout(file, 'source')).turns.some(
          (turn) => turn.id === 'inherited-turn',
        ),
        false,
      );
      const rows: TurnSummary[] = ['user', 'assistant'].map((role, index) => ({
        turnId: `stored-${index}`,
        conversationId: 'source',
        role: role as 'user' | 'assistant',
        content: index
          ? indexedAnswer === 'Answer'
            ? 'Answer'
            : 'Progress.Final'
          : 'Prompt',
        provider: 'codex',
        model: 'old',
        source: 'REST',
        status: 'ok',
        toolCalls: null,
        createdAt: new Date(index),
        fork: { sourceTurnId: `ancestor-${index}` },
      }));
      native = await openForkNative('codex', 'source', true, h.createServer);
      const boundary = await native.recoverBoundary!(rows);
      assert.equal(boundary.turn.id, 'inherited-turn');
      assert.equal(boundary.estimated, true);
      assert.deepEqual(boundary, resolveForkBoundary(rows, native.turns));
      // The frozen-snapshot gate resolves again after canonical local IDs were read.
      assert.deepEqual(await native.recoverBoundary!(rows), boundary);
      assert.equal(
        await native.fork(boundary.turn, {}, 'gpt-6.1-terra'),
        'child',
      );
      assert.equal(
        h.requests.filter((request) => request.method === 'thread/read').length,
        1,
      );
    } finally {
      if (native) await native.close();
      h.dispose();
      await isolated.cleanup();
    }
  });
}

for (const indexState of ['empty', 'failed', 'stale'] as const) {
  test(`an inherited missing-ID reply with ${indexState} index cannot select a matching local child exchange`, async () => {
    const isolated = await createIsolatedProviderHomeEnv(
      'inherited-unavailable-',
    );
    const file = path.join(isolated.codexHome, 'child.jsonl');
    const h = nativeRpcHarness((method) => {
      if (method === 'thread/turns/list') {
        if (indexState === 'failed') throw new Error('Projection unavailable');
        return {
          data:
            indexState === 'stale'
              ? [
                  {
                    id: 'wrong-local-one',
                    status: 'completed',
                    items: [
                      { type: 'userMessage', content: [{ text: 'Prompt' }] },
                      { type: 'agentMessage', text: 'Different answer' },
                    ],
                  },
                ]
              : [],
          nextCursor: null,
        };
      }
      assert.equal(
        method,
        'thread/read',
        'An unavailable inherited boundary must not fork',
      );
      return { thread: { id: 'source', path: file } };
    });
    let native: Awaited<ReturnType<typeof openForkNative>> | undefined;
    try {
      // Neither a unique nor repeated local pair can stand in for the ancestor.
      await fs.writeFile(
        file,
        canonicalLog([
          ...canonicalTask('wrong-local-one'),
          ...(indexState === 'empty' ? [] : canonicalTask('wrong-local-two')),
        ]),
      );
      const rows: TurnSummary[] = ['user', 'assistant'].map((role, index) => ({
        turnId: `stored-${index}`,
        conversationId: 'source',
        role: role as 'user' | 'assistant',
        content: index ? 'Answer' : 'Prompt',
        provider: 'codex',
        model: 'old',
        source: 'REST',
        status: 'ok',
        toolCalls: null,
        createdAt: new Date(index),
        fork: { sourceTurnId: `ancestor-${index}` },
      }));
      native = await openForkNative('codex', 'source', true, h.createServer);
      await assert.rejects(native.recoverBoundary!(rows), {
        code: 'FORK_HISTORY_UNAVAILABLE',
        message:
          'The inherited native boundary is unavailable in indexed history.',
      });
      assert.equal(
        h.requests.some((request) => request.method === 'thread/fork'),
        false,
      );
    } finally {
      if (native) await native.close();
      h.dispose();
      await isolated.cleanup();
    }
  });
}

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
