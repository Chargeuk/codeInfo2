import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { resetStore } from '../../logStore.js';
import { createLogsRouter } from '../../routes/logs.js';
import { attachWs } from '../../ws/server.js';
import { closeWs, connectWs, sendJson } from '../support/wsClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('WS lifecycle logs are queryable via GET /logs', async () => {
  resetStore();

  const app = express();
  app.use('/logs', createLogsRouter());

  const httpServer = http.createServer(app);
  const wsHandle = attachWs({ httpServer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const ws = await connectWs({ baseUrl });
  try {
    sendJson(ws, {
      type: 'subscribe_conversation',
      conversationId: 'log-conv-1',
    });
    await delay(25);

    const res = await request(httpServer)
      .get('/logs')
      .query({ source: 'server', text: 'chat.ws.connect' })
      .expect(200);

    assert.ok(Array.isArray(res.body.items));
    assert.ok(
      res.body.items.length > 0,
      'expected chat.ws.connect log entries',
    );
  } finally {
    await closeWs(ws);
    await wsHandle.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
