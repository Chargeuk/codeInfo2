import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAgentInstruction } from '../../agents/service.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { resetStore } from '../../logStore.js';

class MinimalChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

test('Agents runs accept a client-supplied conversationId even when it does not exist yet', async () => {
  resetStore();

  const prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../',
  );
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');

  try {
    const providedConversationId = 'agents-client-provided-conversation-id-1';
    const result = await runAgentInstruction({
      agentName: 'coding_agent',
      instruction: 'Hello',
      conversationId: providedConversationId,
      source: 'REST',
      chatFactory: () => new MinimalChat(),
    });

    assert.equal(result.conversationId, providedConversationId);
    assert.equal(result.agentName, 'coding_agent');
  } finally {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
  }
});
