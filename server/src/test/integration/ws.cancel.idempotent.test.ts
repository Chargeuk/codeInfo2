import test from 'node:test';

import type WebSocket from 'ws';

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

async function expectNoFinal(ws: WebSocket, ms = 200) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve();
    }, ms);

    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as WsJson;
      if (messageType(msg) !== 'turn_final') return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      reject(new Error('unexpected turn_final'));
    };
    ws.on('message', onMessage);
  });
}

test('cancel_inflight is idempotent (no duplicate finals)', async () => {
  const server = await startWsTestServer();
  try {
    const inflight = getInflightRegistry();
    inflight.createOrGetActive({
      conversationId: 'c1',
      inflightId: 'i1',
      cancelFn: () => undefined,
    });

    const ws = openWs(server.wsUrl);
    await waitForOpen(ws);

    sendJson(ws, {
      type: 'subscribe_conversation',
      requestId: 'r1',
      conversationId: 'c1',
    });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r1',
    );
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'inflight_snapshot',
    );

    sendJson(ws, {
      type: 'cancel_inflight',
      requestId: 'r2',
      conversationId: 'c1',
      inflightId: 'i1',
    });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r2',
    );
    await waitForMessage<WsJson>(ws, (m) => messageType(m) === 'turn_final');

    sendJson(ws, {
      type: 'cancel_inflight',
      requestId: 'r3',
      conversationId: 'c1',
      inflightId: 'i1',
    });
    await waitForMessage<WsJson>(
      ws,
      (m) => messageType(m) === 'ack' && messageString(m, 'requestId') === 'r3',
    );

    await expectNoFinal(ws);
  } finally {
    await server.close();
  }
});
