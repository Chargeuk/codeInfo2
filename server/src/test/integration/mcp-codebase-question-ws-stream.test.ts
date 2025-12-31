import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
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
