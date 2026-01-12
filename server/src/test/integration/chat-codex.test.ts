import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach, beforeEach } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import type {
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
} from '@openai/codex-sdk';
import express from 'express';
import request from 'supertest';
import {
  getMemoryTurns,
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

class MockThread {
  id: string | null;

  constructor(id: string) {
    this.id = id;
  }

  async runStreamed(): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    const threadId = this.id;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', text: 'Hello' },
      } as ThreadEvent;
      yield {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Hello world' },
      } as ThreadEvent;
      yield {
        type: 'turn.completed',
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 },
      } as ThreadEvent;
    }

    return { events: generator() };
  }
}

class MockCodex {
  id: string;
  lastStartOptions?: CodexThreadOptions;
  lastResumeOptions?: CodexThreadOptions;

  constructor(id = 'thread-mock') {
    this.id = id;
  }

  startThread(opts?: CodexThreadOptions) {
    this.lastStartOptions = opts;
    return new MockThread(this.id);
  }

  resumeThread(threadId: string, opts?: CodexThreadOptions) {
    this.lastResumeOptions = opts;
    return new MockThread(threadId);
  }
}

const dummyClientFactory = () =>
  ({
    llm: { model: async () => ({ act: async () => undefined }) },
  }) as unknown as LMStudioClient;

const ORIGINAL_CODEX_WORKDIR = process.env.CODEX_WORKDIR;
const ORIGINAL_CODEINFO_CODEX_WORKDIR = process.env.CODEINFO_CODEX_WORKDIR;

beforeEach(() => {
  delete process.env.CODEX_WORKDIR;
  delete process.env.CODEINFO_CODEX_WORKDIR;
  memoryConversations.clear();
  memoryTurns.clear();
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
  });
  conversationSeq = 0;
});

afterEach(() => {
  if (ORIGINAL_CODEX_WORKDIR === undefined) {
    delete process.env.CODEX_WORKDIR;
  } else {
    process.env.CODEX_WORKDIR = ORIGINAL_CODEX_WORKDIR;
  }

  if (ORIGINAL_CODEINFO_CODEX_WORKDIR === undefined) {
    delete process.env.CODEINFO_CODEX_WORKDIR;
  } else {
    process.env.CODEINFO_CODEX_WORKDIR = ORIGINAL_CODEINFO_CODEX_WORKDIR;
  }
});

let conversationSeq = 0;
const buildCodexBody = (overrides: Record<string, unknown> = {}) => ({
  provider: 'codex',
  model: 'gpt-5.1-codex-max',
  conversationId: `conv-codex-basic-${++conversationSeq}`,
  message: 'Hi',
  ...overrides,
});

async function waitForAssistantTurn(conversationId: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const turns = getMemoryTurns(conversationId);
    if (turns.some((t) => t.role === 'assistant' && (t.content ?? '').length)) {
      return turns;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for assistant turn: ${conversationId}`);
}

test('codex chat streams token/final/complete with thread id', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const codexFactory = () => new MockCodex('thread-abc');

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));

  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const ws = await connectWs({ baseUrl });

  try {
    // Subscribe before starting so the run-start snapshot is broadcast.
    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId: 'thread-abc',
    });

    // Start waits before triggering the HTTP request to avoid missing early frames.
    const snapshotPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflight: { inflightId: string };
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflight?: { inflightId?: string };
        };
        return (
          e.type === 'inflight_snapshot' && e.conversationId === 'thread-abc'
        );
      },
      timeoutMs: 4000,
    });

    const deltaPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
        };
        return (
          e.type === 'assistant_delta' && e.conversationId === 'thread-abc'
        );
      },
      timeoutMs: 4000,
    });

    const finalPromise = waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is {
        type: string;
        conversationId: string;
        inflightId: string;
        status: string;
        threadId?: string;
      } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          inflightId?: string;
          status?: string;
          threadId?: string;
        };
        return e.type === 'turn_final' && e.conversationId === 'thread-abc';
      },
      timeoutMs: 4000,
    });

    const res = await request(httpServer)
      .post('/chat')
      .send(buildCodexBody({ conversationId: 'thread-abc' }))
      .expect(202);

    assert.equal(res.body.status, 'started');
    assert.equal(res.body.conversationId, 'thread-abc');
    assert.equal(typeof res.body.inflightId, 'string');

    const snapshot = await snapshotPromise;
    assert.equal(snapshot.inflight.inflightId, res.body.inflightId);

    const delta = await deltaPromise;
    assert.equal(delta.inflightId, res.body.inflightId);

    const final = await finalPromise;
    assert.equal(final.inflightId, res.body.inflightId);

    assert.equal(final.status, 'ok');
    assert.equal(final.threadId, 'thread-abc');

    const turns = getMemoryTurns('thread-abc');
    const assistant = turns.find((turn) => turn.role === 'assistant');
    assert(assistant?.usage);
    assert.deepEqual(assistant.usage, {
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 0,
      totalTokens: 3,
    });
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('codex chat resumes existing thread when threadId supplied', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-resume');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app)
    .post('/chat')
    .send(buildCodexBody({ threadId: 'thread-resume' }))
    .expect(202);

  assert.equal(mockCodex.lastResumeOptions?.model, 'gpt-5.1-codex-max');
});

test('codex chat sets workingDirectory and skipGitRepoCheck', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const mockCodex = new MockCodex('thread-opt');
  const codexFactory = () => mockCodex;

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  await request(app).post('/chat').send(buildCodexBody()).expect(202);

  assert.equal(mockCodex.lastStartOptions?.workingDirectory, '/data');
  assert.equal(mockCodex.lastStartOptions?.skipGitRepoCheck, true);
});

test('codex chat rejects when detection is unavailable', async () => {
  const app = express();
  app.use(express.json());
  app.use('/chat', createChatRouter({ clientFactory: dummyClientFactory }));

  const resUnavailable = await request(app)
    .post('/chat')
    .send(buildCodexBody({ message: 'hi' }));

  assert.equal(resUnavailable.status, 503);
  assert.equal(resUnavailable.body.status, 'error');
  assert.equal(resUnavailable.body.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(typeof resUnavailable.body.message, 'string');
  assert.ok(String(resUnavailable.body.message).length > 0);
});

test('POST /chat persists turns without WS subscribers (run continues)', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  const codexFactory = () => new MockCodex('thread-no-ws');

  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const conversationId = 'thread-no-ws';
  await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId }))
    .expect(202);

  const turns = await waitForAssistantTurn(conversationId);
  assert.ok(turns.some((t) => t.role === 'user'));
  assert.ok(turns.some((t) => t.role === 'assistant'));
});

test('POST /chat returns 409 RUN_IN_PROGRESS when a run is already active', async () => {
  setCodexDetection({
    available: true,
    authPresent: true,
    configPresent: true,
    cliPath: '/usr/bin/codex',
  });

  class SlowThread extends MockThread {
    async runStreamed(): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
      const threadId = this.id;
      async function* generator(): AsyncGenerator<ThreadEvent> {
        yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield {
          type: 'item.updated',
          item: { type: 'agent_message', text: 'Hello' },
        } as ThreadEvent;
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Hello world' },
        } as ThreadEvent;
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield { type: 'turn.completed' } as ThreadEvent;
      }

      return { events: generator() };
    }
  }

  class SlowCodex extends MockCodex {
    override startThread(opts?: CodexThreadOptions) {
      this.lastStartOptions = opts;
      return new SlowThread(this.id);
    }
  }

  const codexFactory = () => new SlowCodex('thread-lock');
  const app = express();
  app.use(express.json());
  app.use(
    '/chat',
    createChatRouter({ clientFactory: dummyClientFactory, codexFactory }),
  );

  const conversationId = 'thread-lock';
  const first = await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId }))
    .expect(202);
  assert.equal(first.body.status, 'started');

  const second = await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId, message: 'Second' }));
  assert.equal(second.status, 409);
  assert.equal(second.body.status, 'error');
  assert.equal(second.body.code, 'RUN_IN_PROGRESS');

  await waitForAssistantTurn(conversationId);
});
