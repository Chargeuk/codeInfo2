import test from 'node:test';

import type WebSocket from 'ws';

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

async function expectNoSnapshot(ws: WebSocket, ms = 200) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve();
    }, ms);

    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as WsJson;
      if (messageType(msg) !== 'inflight_snapshot') return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      reject(new Error('unexpected inflight_snapshot'));
    };

    ws.on('message', onMessage);
  });
}

test('subscribe_conversation when idle does not emit inflight_snapshot', async () => {
  const server = await startWsTestServer();
  try {
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

    await expectNoSnapshot(ws);
  } finally {
    await server.close();
  }
});
