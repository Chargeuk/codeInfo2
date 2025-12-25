import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RunAgentInstructionParams,
  RunAgentInstructionResult,
} from '../../agents/service.js';
import { createAgentsRunRouter } from '../../routes/agentsRun.js';
import { getWsHub } from '../../ws/hub.js';
import { getInflightRegistry } from '../../ws/inflightRegistry.js';
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

test('agents run broadcasts inflight events to ws subscribers', async () => {
  const server = await startWsTestServer({
    mount: (app) => {
      app.use(
        '/',
        createAgentsRunRouter({
          runAgentInstruction: async (
            params: RunAgentInstructionParams,
          ): Promise<RunAgentInstructionResult> => {
            const conversationId = params.conversationId ?? 'conv-agent';
            const inflight = getInflightRegistry();
            const hub = getWsHub();

            const started = inflight.createOrGetActive({
              conversationId,
              cancelFn: () => undefined,
            });
            const inflightId = started.inflightId;
            const snap = inflight.getActive(conversationId);
            assert.ok(snap);
            hub.beginInflight({
              conversationId,
              inflightId,
              startedAt: snap.startedAt,
              assistantText: snap.assistantText,
              analysisText: snap.analysisText,
              tools: snap.tools,
            });

            inflight.appendAssistantDelta(conversationId, inflightId, 'Hello');
            hub.assistantDelta({
              conversationId,
              inflightId,
              delta: 'Hello',
            });

            const finalized = inflight.finalize({
              conversationId,
              inflightId,
              status: 'ok',
            });
            if (finalized) {
              hub.turnFinal({ conversationId, inflightId, status: 'ok' });
            }

            return {
              agentName: params.agentName,
              conversationId,
              modelId: 'mock-model',
              segments: [],
            };
          },
        }),
      );
    },
  });

  try {
    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    sendJson(ws, {
      type: 'subscribe_conversation',
      requestId: 'r1',
      conversationId: 'conv-agent',
    });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );

    await fetch(`${server.baseUrl}/agents/coding_agent/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instruction: 'hello',
        conversationId: 'conv-agent',
      }),
    });

    await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'inflight_snapshot' &&
        m.conversationId === 'conv-agent',
    );
    await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'assistant_delta' &&
        m.conversationId === 'conv-agent',
    );
    await waitForMessage<WsJson>(
      ws,
      (m) =>
        messageType(m) === 'turn_final' && m.conversationId === 'conv-agent',
    );
  } finally {
    await server.close();
  }
});
