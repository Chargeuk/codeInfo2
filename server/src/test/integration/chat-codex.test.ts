import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import type {
  ThreadEvent,
  ThreadOptions as CodexThreadOptions,
} from '@openai/codex-sdk';
import express from 'express';
import request from 'supertest';
import { setCodexDetection } from '../../providers/codexRegistry.js';
import { createChatRouter } from '../../routes/chat.js';

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

  const res = await request(app)
    .post('/chat')
    .send(buildCodexBody({ conversationId: 'thread-abc' }))
    .expect(200);

  // Debug aid for SSE frames if this test fails
  // console.log('codex sse raw', res.text);

  const frames = res.text
    .split('\n\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map(
      (line) =>
        JSON.parse(line.replace(/^data:\s*/, '')) as {
          type: string;
          threadId?: string;
          content?: string;
          message?: { content?: string };
        },
    );

  const threadFrame =
    frames.find((f) => f.type === 'thread' && f.threadId) ??
    frames.find((f) => f.threadId);
  assert.equal(threadFrame?.threadId, 'thread-abc');
  assert.ok(frames.some((f) => f.type === 'token' && f.content === 'Hello'));
  assert.ok(
    frames.some(
      (f) =>
        f.type === 'final' &&
        (f.message?.content ?? '').includes('Hello world'),
    ),
  );
  const completeFrame = frames.find((f) => f.type === 'complete');
  assert.ok(completeFrame);
  assert.equal(completeFrame?.threadId, 'thread-abc');
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
    .expect(200);

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

  await request(app).post('/chat').send(buildCodexBody()).expect(200);

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
  assert.ok(resUnavailable.body.error?.includes('codex'));
});
