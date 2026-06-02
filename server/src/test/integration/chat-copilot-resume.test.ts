import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import request from 'supertest';

import {
  startCopilotChatServer,
  waitForAssistantTurn,
  waitForAssistantTurnCount,
} from './support/copilotChatHarness.js';

async function withTempCopilotHome(chatToml: string): Promise<{
  copilotHome: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-copilot-endpoint-'),
  );
  const copilotHome = path.join(root, 'copilot');
  await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
  await fs.writeFile(
    path.join(copilotHome, 'chat', 'config.toml'),
    chatToml,
    'utf8',
  );
  return {
    copilotHome,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

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

test('copilot resume-session path preserves the On and Off tool-registration contract', async () => {
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

    assert.deepEqual(
      server.harness
        .getState()
        .lastCreateSessionConfig?.tools?.map((tool) => tool.name),
      ['ListIngestedRepositories', 'VectorSearch'],
    );
    assert.equal(
      server.harness.getState().lastCreateSessionConfig?.availableTools,
      undefined,
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
    assert.deepEqual(
      server.harness
        .getState()
        .lastResumeSession?.config.tools?.map((tool) => tool.name),
      ['ListIngestedRepositories', 'VectorSearch'],
    );
    assert.equal(
      server.harness.getState().lastResumeSession?.config.availableTools,
      undefined,
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

test('copilot create-session path builds an OpenAI-compatible provider config from codeinfo_openai_endpoint', async () => {
  const originalCopilotHome = process.env.CODEINFO_COPILOT_HOME;
  const originalCompatEndpoints =
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  const tempHome = await withTempCopilotHome(
    [
      'model = "copilot-gpt-5"',
      'codeinfo_openai_endpoint = "https://alpha.example/v1|responses,completions"',
      '',
    ].join('\n'),
  );
  process.env.CODEINFO_COPILOT_HOME = tempHome.copilotHome;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
    'https://alpha.example/v1|responses,completions';

  const server = await startCopilotChatServer({
    scenario: {
      name: 'copilot-chat-openai-compat-provider',
    },
  });

  try {
    await request(server.httpServer)
      .post('/chat')
      .send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId: 'copilot-openai-compat',
        message: 'OpenAI-compatible endpoint please',
        endpointId: 'https://alpha.example/v1',
      })
      .expect(202);

    await waitForAssistantTurn('copilot-openai-compat');

    assert.deepEqual(
      server.harness.getState().lastCreateSessionConfig?.provider,
      {
        type: 'openai',
        baseUrl: 'https://alpha.example/v1',
        wireApi: 'responses',
      },
    );
  } finally {
    await server.stop();
    if (originalCopilotHome === undefined) {
      delete process.env.CODEINFO_COPILOT_HOME;
    } else {
      process.env.CODEINFO_COPILOT_HOME = originalCopilotHome;
    }
    if (originalCompatEndpoints === undefined) {
      delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    } else {
      process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
        originalCompatEndpoints;
    }
    await tempHome.cleanup();
  }
});
