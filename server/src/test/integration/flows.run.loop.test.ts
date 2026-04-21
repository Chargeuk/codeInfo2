import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';
import supertest from 'supertest';
import type WebSocket from 'ws';

import { AbortError, delayWithAbort } from '../../agents/retry.js';
import {
  getActiveRunOwnership,
  releaseConversationLock,
} from '../../agents/runLock.js';
import {
  cleanupInflight,
  getInflight,
  getPendingConversationCancel,
} from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import type { Turn } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
  waitForClose,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const closeHttpServer = async (
  httpServer: http.Server,
  timeoutMs = 2000,
): Promise<void> => {
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
    timeoutMs,
    'Timed out waiting for loop-test HTTP server shutdown',
  );
};

const closeFlowHarness = async (params: {
  ws: WebSocket;
  wsHandle: Awaited<ReturnType<typeof attachWs>>;
  httpServer: http.Server;
}) => {
  const forceCloseServer = () => {
    params.httpServer.closeAllConnections?.();
    params.httpServer.closeIdleConnections?.();
  };

  try {
    await withTimeout(
      closeWs(params.ws),
      2000,
      'Timed out gracefully closing loop-test WebSocket client',
    );
  } catch {
    try {
      params.ws.terminate();
      await waitForClose(params.ws, 500);
    } catch {
      // Ignore forced-close failures and continue draining the server.
    }
  }

  try {
    await withTimeout(
      params.wsHandle.close(),
      2000,
      'Timed out waiting for loop-test WebSocket server shutdown',
    );
  } catch {
    forceCloseServer();
  }

  try {
    await closeHttpServer(params.httpServer);
  } catch (error) {
    forceCloseServer();
    await closeHttpServer(params.httpServer, 1000).catch(() => {
      throw error;
    });
  }
};

class ScriptedChat extends ChatInterface {
  constructor(private readonly responder: (message: string) => string) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    if (signal?.aborted) {
      this.emit('error', { type: 'error', message: 'aborted' });
      return;
    }
    this.emit('thread', { type: 'thread', threadId: conversationId });
    const rawResponse = this.responder(message);
    const delayedMatch = rawResponse.match(/^__delay:(\d+)::([\s\S]*)$/);
    if (delayedMatch) {
      try {
        await delayWithAbort(Number(delayedMatch[1]), signal);
      } catch (error) {
        if (error instanceof AbortError) {
          this.emit('error', { type: 'error', message: 'aborted' });
          return;
        }
        throw error;
      }
      if (signal?.aborted) {
        this.emit('error', { type: 'error', message: 'aborted' });
        return;
      }
    }
    const response = delayedMatch ? delayedMatch[2] : rawResponse;
    this.emit('final', { type: 'final', content: response });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/flows',
);

const withFlowServer = async (
  responder: (message: string) => string,
  task: (params: { baseUrl: string; wsUrl: WebSocket }) => Promise<void>,
  options?: {
    cleanupInflightFn?: (params: {
      conversationId: string;
      inflightId?: string;
    }) => void;
    releaseConversationLockFn?: (
      conversationId: string,
      expectedRunToken?: string,
    ) => boolean;
    onStopUnwindCheckpoint?: (params: {
      checkpoint: string;
      conversationId: string;
      detail?: string;
    }) => void;
  },
) => {
  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const prevFlowsDir = process.env.FLOWS_DIR;
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-flows-loop-'));
  await fs.cp(fixturesDir, tmpDir, { recursive: true });

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.FLOWS_DIR = tmpDir;

  const app = express();
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new ScriptedChat(responder),
          onStopUnwindCheckpoint: options?.onStopUnwindCheckpoint,
          cleanupInflightFn: options?.cleanupInflightFn,
          releaseConversationLockFn: options?.releaseConversationLockFn,
        }),
    }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ws = await connectWs({ baseUrl });

  try {
    await task({ baseUrl, wsUrl: ws });
  } finally {
    await closeFlowHarness({ ws, wsHandle, httpServer });
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
    if (prevFlowsDir) {
      process.env.FLOWS_DIR = prevFlowsDir;
    } else {
      delete process.env.FLOWS_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const waitForTurns = async (
  conversationId: string,
  predicate: (turns: Turn[]) => boolean,
  timeoutMs = 2000,
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const turns = memoryTurns.get(conversationId) ?? [];
    if (predicate(turns)) return turns;
    await delay(20);
  }
  throw new Error('Timed out waiting for flow turns');
};

const getAgentConversationId = (
  conversationId: string,
  agentKey: string,
): string => {
  const flowConversation = memoryConversations.get(conversationId);
  const flowFlags = (flowConversation?.flags ?? {}) as {
    flow?: { agentConversations?: Record<string, string> };
  };
  const agentConversationId = flowFlags.flow?.agentConversations?.[agentKey];
  assert.ok(agentConversationId, `Missing agent conversation for ${agentKey}`);
  return agentConversationId;
};

const cleanupMemory = (...conversationIds: Array<string | undefined>) => {
  conversationIds.forEach((conversationId) => {
    if (!conversationId) return;
    memoryConversations.delete(conversationId);
    memoryTurns.delete(conversationId);
  });
};

type RuntimeCleanupSnapshot = {
  inflightId: string | null;
  ownershipRunToken: string | null;
  pendingCancelRunToken: string | null;
  pendingCancelInflightId: string | null;
};

type OwnershipReleaseCall = {
  expectedRunToken?: string;
  released: boolean;
  beforeState: RuntimeCleanupSnapshot;
  afterState: RuntimeCleanupSnapshot;
};

type StopUnwindCheckpoint = {
  checkpoint: string;
  conversationId: string;
  detail?: string;
  state: RuntimeCleanupSnapshot;
};

type CleanupPhaseCheckpoint = {
  label: string;
  conversationId: string;
  state: RuntimeCleanupSnapshot;
};

const snapshotRuntimeCleanupState = (
  conversationId: string,
): RuntimeCleanupSnapshot => {
  const pendingCancel = getPendingConversationCancel(conversationId);
  return {
    inflightId: getInflight(conversationId)?.inflightId ?? null,
    ownershipRunToken: getActiveRunOwnership(conversationId)?.runToken ?? null,
    pendingCancelRunToken: pendingCancel?.runToken ?? null,
    pendingCancelInflightId: pendingCancel?.boundInflightId ?? null,
  };
};

const cleanupConversationRuntime = async (
  conversationId: string | undefined,
  ...conversationIds: Array<string | undefined>
) => {
  try {
    if (conversationId) {
      await waitForRuntimeCleanup(conversationId);
    }
  } finally {
    cleanupMemory(conversationId, ...conversationIds);
  }
};

const waitForRuntimeCleanup = async (
  conversationId: string,
  timeoutMs = 8000,
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (
      !getInflight(conversationId) &&
      !getActiveRunOwnership(conversationId)
    ) {
      return;
    }
    await delay(25);
  }
  const inflight = getInflight(conversationId);
  const ownership = getActiveRunOwnership(conversationId);
  throw new Error(
    `Timed out waiting for flow runtime cleanup (inflight=${String(Boolean(inflight))}, ownership=${String(Boolean(ownership))}, inflightId=${inflight?.inflightId ?? 'none'}, runToken=${ownership?.runToken ?? 'none'})`,
  );
};

const waitForPredicate = async (
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(message);
};

const expectNoTerminalFinal = async (
  ws: WebSocket,
  conversationId: string,
  waitMs = 300,
) => {
  await assert.rejects(
    () =>
      waitForEvent({
        ws,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return e.type === 'turn_final' && e.conversationId === conversationId;
        },
        timeoutMs: waitMs,
      }),
    /Timed out waiting for WebSocket event/,
  );
};

test('flow loops until break answer matches breakOn', async () => {
  let outerBreakCount = 0;
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        outerBreakCount += 1;
        return JSON.stringify({ answer: outerBreakCount >= 2 ? 'yes' : 'no' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-1';
      const customTitle = 'Loop Custom Title';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId, customTitle })
        .expect(202);

      const turns = await waitForTurns(
        conversationId,
        (items) =>
          items.filter(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Exit outer loop?'),
          ).length === 2,
        4000,
      );

      const outerBreakTurns = turns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Exit outer loop?'),
      );
      const innerBreakTurns = turns.filter(
        (turn) =>
          turn.role === 'user' && turn.content.includes('Exit inner loop?'),
      );
      const breakAnswers = turns.filter(
        (turn) =>
          turn.role === 'assistant' && turn.content.includes('"answer"'),
      );

      assert.equal(outerBreakTurns.length, 2);
      assert.equal(innerBreakTurns.length, 2);
      assert.equal(breakAnswers.length, 4);
      assert.equal(outerBreakCount, 2);
      const agentConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:outer',
      );
      const agentConversation = memoryConversations.get(agentConversationId);
      assert.equal(agentConversation?.title, `${customTitle} (outer)`);
      await cleanupConversationRuntime(conversationId, agentConversationId);
    },
  );
});

test('break step fails on invalid JSON response', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        return 'not json';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-invalid-json';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is {
          type: 'turn_final';
          status: string;
          error?: { code?: string };
        } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
            error?: { code?: string };
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'failed'
          );
        },
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      assert.equal(final.error?.code, 'INVALID_BREAK_RESPONSE');
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('break step recovers from wrapper output containing json fence', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return 'wrapper output\n```json\n{"answer":"yes"}\n```';
      }
      if (message.includes('Exit outer loop?')) {
        return 'analysis first\n```json\n{"answer":"yes"}\n```';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-wrapper-json';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'ok'
          );
        },
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'ok');
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('break step fails with INVALID_BREAK_RESPONSE when wrappers contain no valid answer', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return '{"answer":"yes"}';
      }
      if (message.includes('Exit outer loop?')) {
        return '```json\\n{\"answer\":\"maybe\"}\\n``` trailing text';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-wrapper-invalid';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is {
          type: 'turn_final';
          status: string;
          error?: { code?: string };
        } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
            error?: { code?: string };
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'failed'
          );
        },
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      assert.equal(final.error?.code, 'INVALID_BREAK_RESPONSE');
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('break step fails on invalid answer value', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        return JSON.stringify({ answer: 'maybe' });
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-conv-invalid-answer';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'failed'
          );
        },
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'failed');
      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('flow step persists per-agent transcript', async () => {
  await withFlowServer(
    () => 'Flow agent response',
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-single-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/llm-basic/run')
        .send({ conversationId })
        .expect(202);

      await waitForTurns(
        conversationId,
        (items) =>
          items.filter((turn) => turn.role === 'assistant').length === 1,
      );

      const agentConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:basic',
      );
      const agentTurns = await waitForTurns(
        agentConversationId,
        (items) => items.length >= 2,
      );
      const userTurns = agentTurns.filter((turn) => turn.role === 'user');
      const assistantTurns = agentTurns.filter(
        (turn) => turn.role === 'assistant',
      );

      assert.equal(userTurns.length, 1);
      assert.equal(assistantTurns.length, 1);
      assert.ok(userTurns[0].content.includes('Say hello from a flow step.'));
      assert.equal(assistantTurns[0].content, 'Flow agent response');

      await cleanupConversationRuntime(conversationId, agentConversationId);
    },
  );
});

test('flow agent transcripts stay isolated by agent', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Alpha step.')) return 'Alpha response';
      if (message.includes('Beta step.')) return 'Beta response';
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-multi-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/multi-agent/run')
        .send({ conversationId })
        .expect(202);

      await waitForTurns(
        conversationId,
        (items) =>
          items.filter((turn) => turn.role === 'assistant').length === 2,
      );

      const alphaConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:alpha',
      );
      const betaConversationId = getAgentConversationId(
        conversationId,
        'planning_agent:beta',
      );
      const alphaTurns = await waitForTurns(
        alphaConversationId,
        (items) => items.length >= 2,
      );
      const betaTurns = await waitForTurns(
        betaConversationId,
        (items) => items.length >= 2,
      );

      const alphaContent = alphaTurns.map((turn) => turn.content).join(' ');
      const betaContent = betaTurns.map((turn) => turn.content).join(' ');

      assert.ok(alphaContent.includes('Alpha step.'));
      assert.ok(alphaContent.includes('Alpha response'));
      assert.ok(!alphaContent.includes('Beta step.'));
      assert.ok(!alphaContent.includes('Beta response'));

      assert.ok(betaContent.includes('Beta step.'));
      assert.ok(betaContent.includes('Beta response'));
      assert.ok(!betaContent.includes('Alpha step.'));
      assert.ok(!betaContent.includes('Alpha response'));

      await cleanupConversationRuntime(
        conversationId,
        alphaConversationId,
        betaConversationId,
      );
    },
  );
});

test('flow conversation remains merged with command metadata', async () => {
  await withFlowServer(
    (message) => `${message} response`,
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-merged-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/multi-agent/run')
        .send({ conversationId })
        .expect(202);

      const flowTurns = await waitForTurns(
        conversationId,
        (items) => items.length >= 4,
      );

      assert.equal(flowTurns.length, 4);
      assert.ok(
        flowTurns.every((turn) =>
          turn.command && typeof turn.command === 'object'
            ? turn.command.name === 'flow'
            : false,
        ),
      );
      const stepIndexes = flowTurns
        .map((turn) => (turn.command as { stepIndex?: number })?.stepIndex)
        .filter((stepIndex): stepIndex is number => stepIndex !== undefined);
      assert.ok(stepIndexes.includes(1));
      assert.ok(stepIndexes.includes(2));

      await cleanupConversationRuntime(conversationId);
    },
  );
});

test('failed flow step persists to agent conversation', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return JSON.stringify({ answer: 'yes' });
      }
      if (message.includes('Exit outer loop?')) {
        return 'not json';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-agent-failed-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is { type: 'turn_final'; status: string } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'failed'
          );
        },
        timeoutMs: 4000,
      });

      const agentConversationId = getAgentConversationId(
        conversationId,
        'coding_agent:outer-break',
      );
      const agentTurns = await waitForTurns(agentConversationId, (items) =>
        items.some((turn) => turn.role === 'assistant'),
      );
      const assistantTurns = agentTurns.filter(
        (turn) => turn.role === 'assistant',
      );
      const failedTurn = assistantTurns.find((turn) =>
        ['failed', 'stopped'].includes(turn.status),
      );

      assert.ok(
        failedTurn,
        'Expected failed assistant turn in agent transcript',
      );
      assert.ok(failedTurn?.content.length);

      await cleanupConversationRuntime(conversationId, agentConversationId);
    },
  );
});

test('flow step retries transient failures and eventually succeeds', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '3';
  let outerBreakAttempts = 0;
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) return '{"answer":"yes"}';
      if (message.includes('Exit outer loop?')) {
        outerBreakAttempts += 1;
        if (outerBreakAttempts < 2) return '{"answer":"maybe"}';
        return '{"answer":"yes"}';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-retry-success';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      await waitForTurns(
        conversationId,
        (items) =>
          items.some(
            (turn) =>
              turn.role === 'user' && turn.content.includes('Exit outer loop?'),
          ) &&
          items.some(
            (turn) =>
              turn.role === 'assistant' &&
              turn.content.includes('{"answer":"yes"}'),
          ),
        5000,
      );
      assert.equal(outerBreakAttempts, 2);
      await cleanupConversationRuntime(conversationId);
    },
  );
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test('flow step retries to exhaustion and emits one terminal failure', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '2';
  let outerBreakAttempts = 0;
  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) return '{"answer":"yes"}';
      if (message.includes('Exit outer loop?')) {
        outerBreakAttempts += 1;
        return '{"answer":"maybe"}';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-retry-exhausted';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      await supertest(baseUrl)
        .post('/flows/loop-break/run')
        .send({ conversationId })
        .expect(202);

      const final = await waitForEvent({
        ws: wsUrl,
        predicate: (
          event: unknown,
        ): event is {
          type: 'turn_final';
          status: string;
          error?: { code?: string };
        } => {
          const e = event as {
            type?: string;
            conversationId?: string;
            status?: string;
            error?: { code?: string };
          };
          return (
            e.type === 'turn_final' &&
            e.conversationId === conversationId &&
            e.status === 'failed'
          );
        },
        timeoutMs: 5000,
      });

      assert.equal(final.status, 'failed');
      assert.equal(outerBreakAttempts, 2);
      await expectNoTerminalFinal(wsUrl, conversationId);
      await cleanupConversationRuntime(conversationId);
    },
  );
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test('aborted flow step is not retried', async () => {
  const previousRetries = process.env.FLOW_AND_COMMAND_RETRIES;
  process.env.FLOW_AND_COMMAND_RETRIES = '3';
  let outerBreakAttempts = 0;
  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        outerBreakAttempts += 1;
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-retry-aborted';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        const response = await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);

        const inflightId = response.body.inflightId as string;
        sendJson(wsUrl, {
          type: 'cancel_inflight',
          conversationId,
          inflightId,
        });

        const final = await waitForEvent({
          ws: wsUrl,
          predicate: (
            event: unknown,
          ): event is { type: 'turn_final'; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' && e.conversationId === conversationId
            );
          },
          timeoutMs: 5000,
        });

        assert.ok(final.status === 'stopped' || final.status === 'failed');
        assert.equal(outerBreakAttempts <= 1, true);
      } finally {
        await cleanupConversationRuntime(conversationId);
      }
    },
  );
  if (previousRetries === undefined) {
    delete process.env.FLOW_AND_COMMAND_RETRIES;
  } else {
    process.env.FLOW_AND_COMMAND_RETRIES = previousRetries;
  }
});

test('startup-race conversation-only stop still terminalizes a flow as stopped', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-startup-stop-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);

        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });

        const final = await waitForEvent({
          ws: wsUrl,
          predicate: (
            event: unknown,
          ): event is { type: 'turn_final'; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' &&
              e.conversationId === conversationId &&
              e.status === 'stopped'
            );
          },
          timeoutMs: 5000,
        });

        assert.equal(final.status, 'stopped');
      } finally {
        await cleanupConversationRuntime(conversationId);
      }
    },
  );
});

test('duplicate flow stop requests emit one terminal stopped event', async () => {
  const events: Array<{ type?: string; conversationId?: string }> = [];

  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-duplicate-stop-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });

      wsUrl.on('message', (raw) => {
        const parsed = JSON.parse(String(raw)) as {
          type?: string;
          conversationId?: string;
        };
        events.push(parsed);
      });

      try {
        await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);

        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });
        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });

        await waitForEvent({
          ws: wsUrl,
          predicate: (
            event: unknown,
          ): event is { type: 'turn_final'; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' &&
              e.conversationId === conversationId &&
              e.status === 'stopped'
            );
          },
          timeoutMs: 5000,
        });

        await delay(200);

        const finals = events.filter(
          (event) =>
            event.type === 'turn_final' &&
            event.conversationId === conversationId,
        );
        assert.equal(finals.length, 1);
      } finally {
        await cleanupConversationRuntime(conversationId);
      }
    },
  );
});

test('flow stop cleanup fallback still releases runtime state', async () => {
  await withFlowServer(
    (message) => {
      if (message.includes('Say hello from a flow step.')) {
        return '__delay:1000::Flow agent response';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-cleanup-fallback-conv';
      let secondConversationId: string | undefined;
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        const firstRun = await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);
        assert.equal(firstRun.body.conversationId, conversationId);

        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });

        await waitForEvent({
          ws: wsUrl,
          predicate: (
            event: unknown,
          ): event is { type: 'turn_final'; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' &&
              e.conversationId === conversationId &&
              e.status === 'stopped'
            );
          },
          timeoutMs: 5000,
        });

        await waitForRuntimeCleanup(conversationId);

        const secondRun = await supertest(baseUrl)
          .post('/flows/llm-basic/run')
          .send({ conversationId })
          .expect(202);
        secondConversationId = secondRun.body.conversationId as string;
        assert.notEqual(secondConversationId, conversationId);
        sendJson(wsUrl, {
          type: 'subscribe_conversation',
          conversationId: secondConversationId,
        });

        await waitForEvent({
          ws: wsUrl,
          predicate: (
            event: unknown,
          ): event is { type: 'turn_final'; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' &&
              e.conversationId === secondConversationId &&
              e.status === 'ok'
            );
          },
          timeoutMs: 5000,
        });
      } finally {
        await cleanupConversationRuntime(
          conversationId,
          ...(secondConversationId ? [secondConversationId] : []),
        );
      }
    },
    {
      cleanupInflightFn: ({ conversationId: cleanupConversationId }) => {
        if (cleanupConversationId === 'flow-cleanup-fallback-conv') {
          throw new Error('forced cleanup failure');
        }
      },
    },
  );
});

test('flow stop during a looped flow prevents later iterations from continuing', async () => {
  const cleanupEventLimit = 20;
  let cleanupEventCount = 0;
  const ownershipReleaseCalls: OwnershipReleaseCall[] = [];
  let ownershipReacquiredAfterRelease = false;
  let ownershipReacquiredState: RuntimeCleanupSnapshot | null = null;
  const stopUnwindCheckpointLimit = 20;
  const stopUnwindCheckpoints: StopUnwindCheckpoint[] = [];
  const cleanupPhaseCheckpointLimit = 12;
  const cleanupPhaseCheckpoints: CleanupPhaseCheckpoint[] = [];
  const cleanupEvents: Array<
    {
      label: string;
      state: RuntimeCleanupSnapshot;
    } & Partial<{
      conversationId: string;
      inflightId: string;
      expectedRunToken: string;
      released: boolean;
    }>
  > = [];
  const recordCleanupEvent = (
    label: string,
    conversationId: string,
    extra?: Partial<{
      inflightId: string;
      expectedRunToken: string;
      released: boolean;
    }>,
  ) => {
    const state = snapshotRuntimeCleanupState(conversationId);
    cleanupEventCount += 1;
    if (
      !ownershipReacquiredAfterRelease &&
      ownershipReleaseCalls.some(
        (call) => call.released && call.afterState.ownershipRunToken === null,
      ) &&
      state.ownershipRunToken !== null
    ) {
      ownershipReacquiredAfterRelease = true;
      ownershipReacquiredState = state;
    }
    cleanupEvents.push({
      label,
      conversationId,
      state,
      ...extra,
    });
    if (cleanupEvents.length > cleanupEventLimit) {
      cleanupEvents.shift();
    }
  };
  const buildOwnershipReleaseSummary = () => ({
    branch:
      ownershipReleaseCalls.length === 0
        ? 'never_reached'
        : ownershipReleaseCalls.some((call) => !call.released)
          ? 'returned_false'
          : ownershipReacquiredAfterRelease
            ? 'reacquired_after_release'
            : 'released_without_reacquire_observed',
    releaseCallCount: ownershipReleaseCalls.length,
    releaseFalseCount: ownershipReleaseCalls.filter((call) => !call.released)
      .length,
    releaseTrueCount: ownershipReleaseCalls.filter((call) => call.released)
      .length,
    ownershipReacquiredAfterRelease,
    ownershipReacquiredState,
    recentReleaseCalls: ownershipReleaseCalls.slice(-5),
  });
  const recordStopUnwindCheckpoint = (params: {
    checkpoint: string;
    conversationId: string;
    detail?: string;
  }) => {
    stopUnwindCheckpoints.push({
      ...params,
      state: snapshotRuntimeCleanupState(params.conversationId),
    });
    if (stopUnwindCheckpoints.length > stopUnwindCheckpointLimit) {
      stopUnwindCheckpoints.shift();
    }
  };
  const waitForStopUnwindCheckpoint = async (
    checkpoint: string,
    conversationId: string,
    timeoutMs = 5000,
  ) => {
    await waitForPredicate(
      () =>
        stopUnwindCheckpoints.some(
          (item) =>
            item.checkpoint === checkpoint &&
            item.conversationId === conversationId,
        ),
      timeoutMs,
      `Timed out waiting for stop-unwind checkpoint ${checkpoint}`,
    );
  };
  const recordCleanupPhaseCheckpoint = (
    label: string,
    conversationId: string,
  ) => {
    cleanupPhaseCheckpoints.push({
      label,
      conversationId,
      state: snapshotRuntimeCleanupState(conversationId),
    });
    if (cleanupPhaseCheckpoints.length > cleanupPhaseCheckpointLimit) {
      cleanupPhaseCheckpoints.shift();
    }
  };
  const buildCleanupPhaseSummary = () => {
    const labels = new Set(cleanupPhaseCheckpoints.map((item) => item.label));
    const branch = labels.has('before cleanupConversationRuntime')
      ? labels.has('after cleanupConversationRuntime')
        ? 'post_test_teardown_or_resource_cleanup'
        : 'stop_runtime_cleanup_divergence'
      : labels.has('after stop request sent') ||
          labels.has('after first outer break observed') ||
          labels.has('after stopped final observed')
        ? 'setup_not_owner'
        : 'setup_contamination_or_earlier';
    return {
      branch,
      totalCheckpoints: cleanupPhaseCheckpoints.length,
      recentCheckpoints: cleanupPhaseCheckpoints,
    };
  };

  await withFlowServer(
    (message) => {
      if (message.includes('Exit inner loop?')) {
        return '{"answer":"yes"}';
      }
      if (message.includes('Exit outer loop?')) {
        return '__delay:1000::{"answer":"no"}';
      }
      return 'ok';
    },
    async ({ baseUrl, wsUrl }) => {
      const conversationId = 'flow-loop-stop-boundary-conv';
      sendJson(wsUrl, { type: 'subscribe_conversation', conversationId });
      try {
        await supertest(baseUrl)
          .post('/flows/loop-break/run')
          .send({ conversationId })
          .expect(202);

        await waitForTurns(
          conversationId,
          (items) =>
            items.some(
              (turn) =>
                turn.role === 'user' &&
                turn.content.includes('Exit outer loop?'),
            ),
          4000,
        );
        recordCleanupPhaseCheckpoint(
          'after first outer break observed',
          conversationId,
        );
        await waitForPredicate(
          () =>
            !getInflight(conversationId) &&
            Boolean(getActiveRunOwnership(conversationId)),
          5000,
          'Timed out waiting for between-iteration stop gap',
        );
        recordCleanupPhaseCheckpoint(
          'after between-iteration gap observed',
          conversationId,
        );

        sendJson(wsUrl, { type: 'cancel_inflight', conversationId });
        recordCleanupPhaseCheckpoint('after stop request sent', conversationId);

        await waitForEvent({
          ws: wsUrl,
          predicate: (
            event: unknown,
          ): event is { type: 'turn_final'; status: string } => {
            const e = event as {
              type?: string;
              conversationId?: string;
              status?: string;
            };
            return (
              e.type === 'turn_final' &&
              e.conversationId === conversationId &&
              e.status === 'stopped'
            );
          },
          timeoutMs: 5000,
        });
        recordCleanupPhaseCheckpoint(
          'after stopped final observed',
          conversationId,
        );

        await waitForStopUnwindCheckpoint(
          'runStartLoopStep.return.stop.pending_cancel.before_iteration',
          conversationId,
        );

        await waitForStopUnwindCheckpoint(
          'runFlowUnlocked.finalize.exit',
          conversationId,
        );
        recordCleanupPhaseCheckpoint(
          'after stop unwind finalized',
          conversationId,
        );
        recordCleanupEvent('after stop unwind finalized', conversationId);
        const turns = memoryTurns.get(conversationId) ?? [];
        const outerBreakTurns = turns.filter(
          (turn) =>
            turn.role === 'user' && turn.content.includes('Exit outer loop?'),
        );
        assert.equal(outerBreakTurns.length, 1);
      } finally {
        recordCleanupPhaseCheckpoint(
          'before cleanupConversationRuntime',
          conversationId,
        );
        recordCleanupEvent('before cleanupConversationRuntime', conversationId);
        try {
          try {
            await waitForRuntimeCleanup(conversationId, 15000);
          } finally {
            cleanupMemory(conversationId);
          }
          recordCleanupPhaseCheckpoint(
            'after cleanupConversationRuntime',
            conversationId,
          );
        } catch (error) {
          const ownershipReleaseSummary = buildOwnershipReleaseSummary();
          const cleanupPhaseSummary = buildCleanupPhaseSummary();
          console.error(
            'FLOW_LOOP_CLEANUP_EVENTS',
            JSON.stringify({
              totalEvents: cleanupEventCount,
              recentEvents: cleanupEvents,
            }),
          );
          console.error(
            'FLOW_LOOP_OWNERSHIP_RELEASE',
            JSON.stringify(ownershipReleaseSummary),
          );
          console.error(
            'FLOW_LOOP_STOP_UNWIND',
            JSON.stringify({
              totalCheckpoints: stopUnwindCheckpoints.length,
              recentCheckpoints: stopUnwindCheckpoints,
            }),
          );
          console.error(
            'FLOW_LOOP_CLEANUP_PHASE',
            JSON.stringify(cleanupPhaseSummary),
          );
          if (error instanceof Error) {
            error.message += ` cleanupEvents=${JSON.stringify({ totalEvents: cleanupEventCount, recentEvents: cleanupEvents })} ownershipRelease=${JSON.stringify(ownershipReleaseSummary)} stopUnwind=${JSON.stringify({ totalCheckpoints: stopUnwindCheckpoints.length, recentCheckpoints: stopUnwindCheckpoints })} cleanupPhase=${JSON.stringify(cleanupPhaseSummary)}`;
          }
          throw error;
        }
      }
    },
    {
      cleanupInflightFn: (params) => {
        recordCleanupEvent('before cleanupInflightFn', params.conversationId, {
          inflightId: params.inflightId,
        });
        cleanupInflight(params);
        recordCleanupEvent('after cleanupInflightFn', params.conversationId, {
          inflightId: params.inflightId,
        });
      },
      releaseConversationLockFn: (conversationId, expectedRunToken) => {
        const beforeState = snapshotRuntimeCleanupState(conversationId);
        recordCleanupEvent('before releaseConversationLockFn', conversationId, {
          expectedRunToken,
        });
        const released = releaseConversationLock(
          conversationId,
          expectedRunToken,
        );
        const afterState = snapshotRuntimeCleanupState(conversationId);
        ownershipReleaseCalls.push({
          expectedRunToken,
          released,
          beforeState,
          afterState,
        });
        recordCleanupEvent('after releaseConversationLockFn', conversationId, {
          expectedRunToken,
          released,
        });
        return released;
      },
      onStopUnwindCheckpoint: recordStopUnwindCheckpoint,
    },
  );
});
