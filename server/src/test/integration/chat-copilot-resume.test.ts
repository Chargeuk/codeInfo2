import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import {
  startCopilotChatServer,
  waitForAssistantTurn,
  waitForAssistantTurnCount,
} from './support/copilotChatHarness.js';

test('copilot resume failures stay explicit instead of silently creating a fresh session', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-resume-failure',
      resumeSessionError: new Error('resume failed'),
    },
  });

  try {
    const conversationId = 'copilot-resume-failure';
    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId,
        message: 'First turn',
      })
      .expect(202);
    await waitForAssistantTurn(conversationId);

    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId,
        message: 'Second turn',
      })
      .expect(202);

    const assistantTurns = await waitForAssistantTurnCount(conversationId, 2);
    const failedTurn =
      assistantTurns.find((turn) =>
        turn.content.includes('Copilot session resume failed'),
      )?.content ?? '';

    assert.match(failedTurn, /Copilot session resume failed/u);
    assert.equal(
      server.harness.getState().lastCreateSessionConfig?.sessionId,
      conversationId,
    );
  } finally {
    await server.stop();
  }
});

test('copilot resume-session path uses MCP-configured servers instead of custom SDK tools', async () => {
  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-tool-access',
    },
  });

  try {
    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId: 'copilot-tool-access-on',
        message: 'Tools on',
        agentFlags: {
          toolAccess: 'on',
        },
      });
    await waitForAssistantTurn('copilot-tool-access-on');

    assert.equal(
      server.harness.getState().lastCreateSessionConfig?.tools,
      undefined,
    );
    assert.equal(
      server.harness.getState().lastCreateSessionConfig?.availableTools,
      undefined,
    );
    assert.deepEqual(
      Object.keys(
        server.harness.getState().lastCreateSessionConfig?.mcpServers ?? {},
      ).sort(),
      ['code_info', 'context7', 'deepwiki', 'mui'],
    );

    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId: 'copilot-tool-access-on',
        message: 'Tools still on',
        agentFlags: {
          toolAccess: 'on',
        },
      });
    await waitForAssistantTurnCount('copilot-tool-access-on', 2);

    assert.equal(
      server.harness.getState().lastResumeSession?.sessionId,
      'copilot-tool-access-on',
    );
    assert.equal(
      server.harness.getState().lastResumeSession?.config.tools,
      undefined,
    );
    assert.equal(
      server.harness.getState().lastResumeSession?.config.availableTools,
      undefined,
    );
    assert.deepEqual(
      Object.keys(
        server.harness.getState().lastResumeSession?.config.mcpServers ?? {},
      ).sort(),
      ['code_info', 'context7', 'deepwiki', 'mui'],
    );

    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId: 'copilot-tool-access-off',
        message: 'Tools off',
        agentFlags: {
          toolAccess: 'off',
        },
      });
    await waitForAssistantTurn('copilot-tool-access-off');

    assert.equal(
      server.harness.getState().lastCreateSessionConfig?.tools,
      undefined,
    );
    assert.deepEqual(
      server.harness.getState().lastCreateSessionConfig?.availableTools,
      [],
    );

    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId: 'copilot-tool-access-off',
        message: 'Tools still off',
        agentFlags: {
          toolAccess: 'off',
        },
      });
    await waitForAssistantTurnCount('copilot-tool-access-off', 2);

    assert.equal(
      server.harness.getState().lastResumeSession?.sessionId,
      'copilot-tool-access-off',
    );
    assert.equal(
      server.harness.getState().lastResumeSession?.config.tools,
      undefined,
    );
    assert.deepEqual(
      server.harness.getState().lastResumeSession?.config.availableTools,
      [],
    );
  } finally {
    await server.stop();
  }
});
