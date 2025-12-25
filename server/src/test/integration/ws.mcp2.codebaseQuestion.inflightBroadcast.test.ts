import assert from 'node:assert/strict';
import test from 'node:test';

import type { ThreadEvent } from '@openai/codex-sdk';

import type { CodexLike } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { runCodebaseQuestion } from '../../mcp2/tools/codebaseQuestion.js';
import {
  messageString,
  messageType,
  openWs,
  sendJson,
  startWsTestServer,
  type WsJson,
  waitForMessage,
  waitForOpen,
} from './wsTestUtils.js';

class MockThread {
  id: string;

  constructor(id: string) {
    this.id = id;
  }

  async runStreamed(): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    const threadId = this.id;
    async function* generator(): AsyncGenerator<ThreadEvent> {
      yield { type: 'thread.started', thread_id: threadId } as ThreadEvent;
      yield {
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          name: 'VectorSearch',
          result: { content: [{ type: 'text', text: 'ok' }] },
        },
      } as unknown as ThreadEvent;
      yield {
        type: 'item.updated',
        item: { type: 'agent_message', text: 'Hello' },
      } as ThreadEvent;
      yield { type: 'turn.completed' } as ThreadEvent;
    }
    return { events: generator() };
  }
}

class MockCodex {
  id: string;

  constructor(id = 'thread-mock') {
    this.id = id;
  }

  startThread() {
    return new MockThread(this.id);
  }

  resumeThread(threadId: string) {
    return new MockThread(threadId);
  }
}

test('mcp2 codebase_question broadcasts inflight events to ws subscribers', async () => {
  const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
  process.env.MCP_FORCE_CODEX_AVAILABLE = 'true';

  const server = await startWsTestServer();
  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    sendJson(ws, {
      type: 'subscribe_conversation',
      requestId: 'r1',
      conversationId: 'conv-mcp',
    });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );

    const runPromise = runCodebaseQuestion(
      { question: 'Hello?', conversationId: 'conv-mcp', provider: 'codex' },
      { codexFactory: () => new MockCodex('conv-mcp') as unknown as CodexLike },
    );

    const snapshot = await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'inflight_snapshot' &&
        m.conversationId === 'conv-mcp',
    );
    assert.equal(typeof snapshot.inflight, 'object');
    assert.equal(snapshot.inflight !== null, true);
    const inflightSnap = snapshot.inflight as Record<string, unknown>;
    assert.equal(typeof inflightSnap.inflightId, 'string');
    assert.equal((inflightSnap.inflightId as string).length > 0, true);

    await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'assistant_delta' && m.conversationId === 'conv-mcp',
    );
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'tool_event' && m.conversationId === 'conv-mcp',
    );
    const final = await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'turn_final' && m.conversationId === 'conv-mcp',
      5000,
    );
    assert.equal(final.status === 'ok' || final.status === 'stopped', true);

    await runPromise;
  } finally {
    process.env.MCP_FORCE_CODEX_AVAILABLE = original;
    await server.close();
  }
});
