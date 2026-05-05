import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  getCompletedInflightByReplayId,
  getInflight,
} from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { importCopilotSeedIntoRuntimeHome } from '../../config/copilotSeedBootstrap.js';
import { resetStore } from '../../logStore.js';
import { handleRpc } from '../../mcp2/router.js';
import { resetToolDeps, setToolDeps } from '../../mcp2/tools.js';
import { attachWs } from '../../ws/server.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 5000,
  pollMs = 10,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(pollMs);
  }
  throw new Error('condition not met before timeout');
}

function currentRuntimeEnv(): NodeJS.ProcessEnv {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) {
    throw new Error('current runtime identity unavailable on this platform');
  }
  return {
    CODEINFO_RUNTIME_UID: String(uid),
    CODEINFO_RUNTIME_GID: String(gid),
  };
}

async function writeSeedArtifacts(seedHome: string) {
  await fs.mkdir(path.join(seedHome, 'session-state'), { recursive: true });
  await fs.writeFile(
    path.join(seedHome, 'config.json'),
    '{"store_token_plaintext": true}\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(seedHome, 'settings.json'),
    '{"storeTokenPlaintext": true}\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(seedHome, 'session-state', 'session.json'),
    '{"mcp": true}\n',
    'utf8',
  );
}

async function lockDownRuntimeArtifacts(runtimeHome: string) {
  await fs.chmod(path.join(runtimeHome, 'config.json'), 0o000);
  await fs.chmod(path.join(runtimeHome, 'settings.json'), 0o000);
  await fs.chmod(
    path.join(runtimeHome, 'session-state', 'session.json'),
    0o000,
  );
  await fs.chmod(path.join(runtimeHome, 'session-state'), 0o000);
}

async function hasReadableBootstrappedRuntime(runtimeHome: string) {
  try {
    await Promise.all([
      fs.access(path.join(runtimeHome, 'config.json')),
      fs.access(path.join(runtimeHome, 'settings.json')),
      fs.access(path.join(runtimeHome, 'session-state')),
      fs.access(path.join(runtimeHome, 'session-state', 'session.json')),
    ]);
    return true;
  } catch {
    return false;
  }
}

const makeLmStudioClientFactory = () => () =>
  ({
    system: {
      listDownloadedModels: async () => [
        {
          modelKey: 'm',
          displayName: 'm',
          type: 'gguf',
        },
      ],
    },
    llm: {
      model: () => ({
        complete: async () => {
          throw new Error('unused');
        },
      }),
    },
  }) as never;

class StreamingChat extends ChatInterface {
  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    if (abortIfNeeded()) return;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('analysis', { type: 'analysis', content: 'thinking...' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'Hel' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('token', { type: 'token', content: 'lo' });
    await delay(30);
    if (abortIfNeeded()) return;
    this.emit('final', { type: 'final', content: 'Hello world' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class CapturingRuntimeChat extends ChatInterface {
  constructor(
    private readonly calls: Array<{
      flags: Record<string, unknown>;
      conversationId: string;
    }>,
  ) {
    super();
  }

  async execute(
    _message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _model;
    this.calls.push({ flags, conversationId });
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'Captured runtime context' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

class ReplayBarrierStreamingChat extends ChatInterface {
  runs = 0;
  private releaseCleanup: (() => void) | null = null;
  private firstRunCleanupGate = new Promise<void>((resolve) => {
    this.releaseCleanup = resolve;
  });

  allowFirstCleanup() {
    this.releaseCleanup?.();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    this.runs += 1;
    if (abortIfNeeded()) return;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('analysis', { type: 'analysis', content: 'replay-check...' });
    if (abortIfNeeded()) return;
    this.emit('final', {
      type: 'final',
      content: `Replay-protected answer for ${message}`,
    });
    this.emit('complete', { type: 'complete', threadId: conversationId });

    if (this.runs === 1) {
      await this.firstRunCleanupGate;
    }
  }
}

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

test('MCP codebase_question publishes WS transcript events while in progress', async () => {
  resetStore();
  const originalForce = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  setToolDeps({
    chatFactory: () => new StreamingChat(),
    clientFactory: makeLmStudioClientFactory(),
  });

  const wsApp = express();
  const wsHttp = http.createServer(wsApp);
  const wsHandle = attachWs({ httpServer: wsHttp });
  await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
  const wsAddr = wsHttp.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${wsAddr.port}`;

  const mcpServer = http.createServer(handleRpc);
  await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
  const mcpAddr = mcpServer.address() as AddressInfo;

  const conversationId = 'mcp-ws-conv-1';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolCallPromise = postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'What is up?',
          conversationId,
          provider: 'lmstudio',
          model: 'm',
        },
      },
    });

    await waitForEvent({
      ws,
      predicate: (event: unknown): event is { type: string } => {
        const e = event as { type?: string; conversationId?: string };
        return (
          e.type === 'inflight_snapshot' && e.conversationId === conversationId
        );
      },
      timeoutMs: 5000,
    });

    await waitForEvent({
      ws,
      predicate: (event: unknown): event is { type: string } => {
        const e = event as { type?: string; conversationId?: string };
        return (
          e.type === 'assistant_delta' && e.conversationId === conversationId
        );
      },
      timeoutMs: 5000,
    });

    const final = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is { type: string; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });
    assert.equal(final.status, 'ok');

    const response = await toolCallPromise;
    assert.ok((response as { result?: unknown }).result);
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    resetToolDeps();
    process.env.MCP_FORCE_CODEX_AVAILABLE = originalForce;
  }
});

test('explicit-provider MCP codebase_question websocket runs receive the shared execution context', async () => {
  resetStore();
  const calls: Array<{
    flags: Record<string, unknown>;
    conversationId: string;
  }> = [];
  const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  process.env.CODEINFO_CODEX_WORKDIR = '/mounted/ws-default-root';

  setToolDeps({
    chatFactory: () => new CapturingRuntimeChat(calls),
    clientFactory: makeLmStudioClientFactory(),
  });

  const wsApp = express();
  const wsHttp = http.createServer(wsApp);
  const wsHandle = attachWs({ httpServer: wsHttp });
  await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
  const wsAddr = wsHttp.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${wsAddr.port}`;

  const mcpServer = http.createServer(handleRpc);
  await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
  const mcpAddr = mcpServer.address() as AddressInfo;
  const conversationId = 'mcp-ws-runtime-explicit';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolCallPromise = postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'What is up?',
          conversationId,
          provider: 'lmstudio',
          model: 'm',
        },
      },
    });

    await waitForEvent({
      ws,
      predicate: (event: unknown): event is { type: string } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });

    await toolCallPromise;
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.flags.runtime, {
      lookupSummary: {
        selectedRepositoryPath: '/mounted/ws-default-root',
        fallbackUsed: true,
        workingRepositoryAvailable: false,
      },
    });
    assert.deepEqual(calls[0]?.flags.repositoryContext, {
      selectedRepositoryPath: '/mounted/ws-default-root',
      defaultExecutionRoot: '/mounted/ws-default-root',
      workingDirectoryOverride: '/mounted/ws-default-root',
      fallbackUsed: true,
      workingRepositoryAvailable: false,
    });
  } finally {
    if (originalWorkdir === undefined) {
      delete process.env.CODEINFO_CODEX_WORKDIR;
    } else {
      process.env.CODEINFO_CODEX_WORKDIR = originalWorkdir;
    }
    await closeWs(ws);
    await wsHandle.close();
    resetToolDeps();
    mcpServer.close();
    wsHttp.close();
  }
});

test('omitted-provider MCP codebase_question websocket runs receive the same shared execution context', async () => {
  resetStore();
  const calls: Array<{
    flags: Record<string, unknown>;
    conversationId: string;
  }> = [];
  const originalWorkdir = process.env.CODEINFO_CODEX_WORKDIR;
  const originalDefaultProvider = process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
  process.env.CODEINFO_CODEX_WORKDIR = '/mounted/ws-default-root';
  process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = 'lmstudio';

  setToolDeps({
    chatFactory: () => new CapturingRuntimeChat(calls),
    clientFactory: makeLmStudioClientFactory(),
  });

  const wsApp = express();
  const wsHttp = http.createServer(wsApp);
  const wsHandle = attachWs({ httpServer: wsHttp });
  await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
  const wsAddr = wsHttp.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${wsAddr.port}`;

  const mcpServer = http.createServer(handleRpc);
  await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
  const mcpAddr = mcpServer.address() as AddressInfo;
  const conversationId = 'mcp-ws-runtime-omitted';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolCallPromise = postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'What is up?',
          conversationId,
        },
      },
    });

    await waitForEvent({
      ws,
      predicate: (event: unknown): event is { type: string } => {
        const e = event as { type?: string; conversationId?: string };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });

    await toolCallPromise;
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.flags.runtime, {
      lookupSummary: {
        selectedRepositoryPath: '/mounted/ws-default-root',
        fallbackUsed: true,
        workingRepositoryAvailable: false,
      },
    });
    assert.deepEqual(calls[0]?.flags.repositoryContext, {
      selectedRepositoryPath: '/mounted/ws-default-root',
      defaultExecutionRoot: '/mounted/ws-default-root',
      workingDirectoryOverride: '/mounted/ws-default-root',
      fallbackUsed: true,
      workingRepositoryAvailable: false,
    });
  } finally {
    if (originalWorkdir === undefined) {
      delete process.env.CODEINFO_CODEX_WORKDIR;
    } else {
      process.env.CODEINFO_CODEX_WORKDIR = originalWorkdir;
    }
    if (originalDefaultProvider === undefined) {
      delete process.env.CODEINFO_CHAT_DEFAULT_PROVIDER;
    } else {
      process.env.CODEINFO_CHAT_DEFAULT_PROVIDER = originalDefaultProvider;
    }
    await closeWs(ws);
    await wsHandle.close();
    resetToolDeps();
    mcpServer.close();
    wsHttp.close();
  }
});

test('MCP codebase_question keeps Copilot provider parity on the streamed websocket path', async () => {
  resetStore();

  setToolDeps({
    chatFactory: () => new StreamingChat(),
    copilotReadinessResolver: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready',
      models: ['copilot-gpt-5'],
      modelsRaw: [],
      authSource: 'env-token',
    }),
    clientFactory: makeLmStudioClientFactory(),
  });

  const wsApp = express();
  const wsHttp = http.createServer(wsApp);
  const wsHandle = attachWs({ httpServer: wsHttp });
  await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
  const wsAddr = wsHttp.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${wsAddr.port}`;

  const mcpServer = http.createServer(handleRpc);
  await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
  const mcpAddr = mcpServer.address() as AddressInfo;

  const conversationId = 'mcp-ws-copilot-conv-1';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolCallPromise = postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'What is up with Copilot?',
          conversationId,
          provider: 'copilot',
          model: 'copilot-gpt-5',
        },
      },
    });

    const final = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is { type: string; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });
    assert.equal(final.status, 'ok');

    const response = await toolCallPromise;
    assert.ok((response as { result?: unknown }).result);
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    resetToolDeps();
  }
});

test('MCP codebase_question keeps Copilot provider parity after startup re-normalizes an existing seeded runtime home', async () => {
  resetStore();
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'mcp-copilot-seed-'),
  );
  const seedHome = path.join(tempRoot, 'seed-home');
  const runtimeHome = path.join(tempRoot, 'runtime-home');

  await writeSeedArtifacts(seedHome);
  const seedResult = await importCopilotSeedIntoRuntimeHome({
    runtimeHome,
    seedHome,
    env: currentRuntimeEnv(),
  });
  assert.equal(seedResult.status, 'seed_applied');
  await lockDownRuntimeArtifacts(runtimeHome);
  const normalizationResult = await importCopilotSeedIntoRuntimeHome({
    runtimeHome,
    seedHome,
    env: currentRuntimeEnv(),
  });
  assert.equal(
    normalizationResult.status,
    'seed_skipped_runtime_already_initialized',
  );

  setToolDeps({
    chatFactory: () => new StreamingChat(),
    copilotReadinessResolver: async () => ({
      available: await hasReadableBootstrappedRuntime(runtimeHome),
      toolsAvailable: await hasReadableBootstrappedRuntime(runtimeHome),
      blockingStage: (await hasReadableBootstrappedRuntime(runtimeHome))
        ? 'ready'
        : 'authentication',
      models: (await hasReadableBootstrappedRuntime(runtimeHome))
        ? ['copilot-gpt-5']
        : [],
      modelsRaw: [],
      authSource: (await hasReadableBootstrappedRuntime(runtimeHome))
        ? 'sdk-status'
        : 'unauthenticated',
      reason: (await hasReadableBootstrappedRuntime(runtimeHome))
        ? undefined
        : 'copilot authentication required',
    }),
    clientFactory: makeLmStudioClientFactory(),
  });

  const wsApp = express();
  const wsHttp = http.createServer(wsApp);
  const wsHandle = attachWs({ httpServer: wsHttp });
  await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
  const wsAddr = wsHttp.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${wsAddr.port}`;

  const mcpServer = http.createServer(handleRpc);
  await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
  const mcpAddr = mcpServer.address() as AddressInfo;

  const conversationId = 'mcp-ws-copilot-repaired-seed';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const toolCallPromise = postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'Can Copilot still stream after startup ownership repair?',
          conversationId,
          provider: 'copilot',
          model: 'copilot-gpt-5',
        },
      },
    });

    const final = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is { type: string; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });
    assert.equal(final.status, 'ok');

    const response = await toolCallPromise;
    assert.ok((response as { result?: unknown }).result);
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    resetToolDeps();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('MCP codebase_question replays one stable follow-up result before cleanup and after cleanup for the same conversation replayId', async () => {
  resetStore();

  const chat = new ReplayBarrierStreamingChat();
  setToolDeps({
    chatFactory: () => chat,
    clientFactory: makeLmStudioClientFactory(),
  });

  const wsApp = express();
  const wsHttp = http.createServer(wsApp);
  const wsHandle = attachWs({ httpServer: wsHttp });
  await new Promise<void>((resolve) => wsHttp.listen(0, resolve));
  const wsAddr = wsHttp.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${wsAddr.port}`;

  const mcpServer = http.createServer(handleRpc);
  await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
  const mcpAddr = mcpServer.address() as AddressInfo;

  const conversationId = 'mcp-ws-replay-barrier-1';
  const replayId = 'logical-retry-1';
  const ws = await connectWs({ baseUrl });

  try {
    sendJson(ws, { type: 'subscribe_conversation', conversationId });

    const firstCallPromise = postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'first logical follow-up',
          conversationId,
          replayId,
          provider: 'lmstudio',
          model: 'm',
        },
      },
    });

    const firstFinal = await waitForEvent({
      ws,
      predicate: (
        event: unknown,
      ): event is { type: string; status: string } => {
        const e = event as {
          type?: string;
          conversationId?: string;
          status?: string;
        };
        return e.type === 'turn_final' && e.conversationId === conversationId;
      },
      timeoutMs: 5000,
    });
    assert.equal(firstFinal.status, 'ok');

    await waitForCondition(
      () =>
        getCompletedInflightByReplayId({ conversationId, replayId }) !== null,
    );
    assert.ok(getInflight(conversationId));

    const immediateReplay = await postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'contradictory stale retry',
          conversationId,
          replayId,
          provider: 'lmstudio',
          model: 'm',
        },
      },
    });
    assert.ok((immediateReplay as { result?: unknown }).result);
    const immediateReplayPayload = JSON.parse(
      (immediateReplay as { result: { content: Array<{ text: string }> } })
        .result.content[0].text,
    );
    assert.equal(chat.runs, 1);
    assert.equal(
      immediateReplayPayload.segments[0].text,
      'Replay-protected answer for first logical follow-up',
    );

    chat.allowFirstCleanup();
    const firstResponse = await firstCallPromise;
    assert.ok((firstResponse as { result?: unknown }).result);

    await waitForCondition(() => getInflight(conversationId) === undefined);

    const cleanupReplay = await postJson(mcpAddr.port, {
      jsonrpc: '2.0',
      id: 43,
      method: 'tools/call',
      params: {
        name: 'codebase_question',
        arguments: {
          question: 'retry after cleanup already ran',
          conversationId,
          replayId,
          provider: 'lmstudio',
          model: 'm',
        },
      },
    });
    assert.ok((cleanupReplay as { result?: unknown }).result);
    const cleanupReplayPayload = JSON.parse(
      (cleanupReplay as { result: { content: Array<{ text: string }> } }).result
        .content[0].text,
    );
    assert.equal(chat.runs, 1);
    assert.deepEqual(cleanupReplayPayload, immediateReplayPayload);
  } finally {
    chat.allowFirstCleanup();
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => wsHttp.close(() => resolve()));
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    resetToolDeps();
  }
});
