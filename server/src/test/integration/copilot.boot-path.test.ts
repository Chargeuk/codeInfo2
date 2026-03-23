import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import {
  queryTask16BootLogs,
  startNamedCopilotScenarioServer,
} from '../support/copilotBootPath.js';
import {
  closeWs,
  connectWs,
  sendJson,
  waitForEvent,
} from '../support/wsClient.js';

test('named happy-path fake Copilot scenario boots the higher-level stack end to end', async () => {
  const server = await startNamedCopilotScenarioServer({
    scenarioName: 'copilot-happy-path',
  });

  try {
    const providers = await request(server.httpServer).get('/chat/providers');
    assert.equal(providers.status, 200);
    const copilotProvider = providers.body.providers.find(
      (provider: { id?: string }) => provider.id === 'copilot',
    );
    assert.ok(copilotProvider);
    assert.equal(copilotProvider.available, true);

    const models = await request(server.httpServer).get(
      '/chat/models?provider=copilot',
    );
    assert.equal(models.status, 200);
    assert.equal(models.body.provider, 'copilot');
    assert.equal(models.body.available, true);
    assert.equal(models.body.models[0]?.key, 'copilot-gpt-5');

    const ws = await connectWs({ baseUrl: server.baseUrl });
    try {
      const conversationId = 'task16-boot-happy-path';
      sendJson(ws, {
        type: 'subscribe_conversation',
        conversationId,
      });

      const start = await request(server.httpServer).post('/chat').send({
        provider: 'copilot',
        model: 'copilot-gpt-5',
        conversationId,
        message: 'Hello from task 16',
      });

      assert.equal(start.status, 202);
      assert.equal(start.body.provider, 'copilot');

      const final = await waitForEvent({
        ws,
        predicate: (
          event: unknown,
        ): event is {
          type?: string;
          status?: string;
          conversationId?: string;
        } => {
          const candidate = event as {
            type?: string;
            status?: string;
            conversationId?: string;
          };
          return (
            candidate.type === 'turn_final' &&
            candidate.status === 'ok' &&
            candidate.conversationId === conversationId
          );
        },
        timeoutMs: 4000,
      });

      assert.equal(final.status, 'ok');
    } finally {
      await closeWs(ws);
    }

    const task16Logs = queryTask16BootLogs();
    assert.ok(task16Logs.length > 0);
    assert.equal(task16Logs.at(-1)?.context?.scenario, 'copilot-happy-path');
  } finally {
    await server.stop();
  }
});

test('named auth-required fake Copilot scenario surfaces the negative path cleanly', async () => {
  const server = await startNamedCopilotScenarioServer({
    scenarioName: 'copilot-auth-required',
  });

  try {
    const providers = await request(server.httpServer).get('/chat/providers');
    assert.equal(providers.status, 200);
    const copilotProvider = providers.body.providers.find(
      (provider: { id?: string }) => provider.id === 'copilot',
    );
    assert.ok(copilotProvider);
    assert.equal(copilotProvider.available, false);
    assert.equal(
      copilotProvider.reason,
      'copilot authentication required',
    );

    const auth = await request(server.httpServer)
      .post('/copilot/device-auth')
      .send({});
    assert.equal(auth.status, 200);
    assert.equal(auth.body.provider, 'copilot');
    assert.equal(auth.body.state, 'verification_ready');
    assert.equal(auth.body.userCode, 'TASK16-ABCD');

    const task16Logs = queryTask16BootLogs();
    assert.ok(task16Logs.length > 0);
    assert.equal(task16Logs.at(-1)?.context?.scenario, 'copilot-auth-required');
  } finally {
    await server.stop();
  }
});
