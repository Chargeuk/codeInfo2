import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { attachChatStreamBridge } from '../../chat/chatStreamBridge.js';
import {
  cleanupInflight,
  createInflight,
  getInflight,
} from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { query, resetStore } from '../../logStore.js';

class BridgeTestChat extends ChatInterface {
  async execute() {
    return undefined;
  }
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanupInflight({ conversationId: 'bridge-conversation-1' });
  resetStore();
});

test('deferred finalization aligns stopped fallback with pending ok completion and preserves usage/timing', () => {
  const conversationId = 'bridge-conversation-1';
  const inflightId = 'bridge-inflight-1';
  const chat = new BridgeTestChat();

  createInflight({
    conversationId,
    inflightId,
    provider: 'codex',
    model: 'gpt-5.4',
  });

  const bridge = attachChatStreamBridge({
    conversationId,
    inflightId,
    provider: 'codex',
    model: 'gpt-5.4',
    chat,
    deferFinal: true,
  });

  chat.emit('thread', { type: 'thread', threadId: 'thread-123' });
  chat.emit('complete', {
    type: 'complete',
    threadId: 'thread-123',
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 7,
    },
    timing: {
      totalTimeSec: 1.5,
      tokensPerSecond: 2.67,
    },
  });

  bridge.finalize({
    fallback: {
      status: 'stopped',
      error: { code: 'CANCELLED', message: 'aborted' },
    },
  });

  const finalLog = query(
    {
      text: 'chat.ws.server_publish_turn_final',
    },
    20,
  ).find(
    (entry) =>
      entry.context?.conversationId === conversationId &&
      entry.context?.inflightId === inflightId,
  );

  assert.ok(finalLog);
  assert.equal(finalLog.context?.status, 'stopped');
  assert.equal(finalLog.context?.hasUsage, true);
  assert.equal(finalLog.context?.hasTiming, true);

  const streamFinalLog = query(
    {
      text: 'chat.stream.final',
    },
    20,
  ).find(
    (entry) =>
      entry.context?.conversationId === conversationId &&
      entry.context?.inflightId === inflightId,
  );
  assert.ok(streamFinalLog);
  assert.equal(streamFinalLog.context?.status, 'stopped');
  assert.equal(streamFinalLog.context?.threadId, 'thread-123');

  const alignmentLog = query(
    {
      text: 'DEV-0000049:T03:deferred_final_status_aligned',
    },
    20,
  ).find(
    (entry) =>
      entry.context?.conversationId === conversationId &&
      entry.context?.inflightId === inflightId,
  );
  assert.ok(alignmentLog);
  assert.equal(alignmentLog.context?.pendingStatus, 'ok');
  assert.equal(alignmentLog.context?.resolvedStatus, 'stopped');
  assert.equal(alignmentLog.context?.preservedUsage, true);
  assert.equal(alignmentLog.context?.preservedTiming, true);

  assert.equal(getInflight(conversationId)?.finalStatus, 'stopped');

  bridge.cleanup();
});
