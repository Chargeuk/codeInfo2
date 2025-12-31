import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { resetStore } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import { createLogsRouter } from '../../routes/logs.js';

test('Client logs are forwarded to the server file logger', async () => {
  resetStore();

  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = `req-${req.method}`;
    next();
  });
  app.use('/logs', createLogsRouter());

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));

  const calls: Array<{ obj: unknown; msg: unknown }> = [];
  const originalInfo = (baseLogger as unknown as { info: unknown }).info;
  (baseLogger as unknown as { info: unknown }).info = (
    obj: unknown,
    msg: unknown,
    ...rest: unknown[]
  ) => {
    calls.push({ obj, msg });
    return (originalInfo as (...args: unknown[]) => unknown).call(
      baseLogger,
      obj,
      msg,
      ...rest,
    );
  };

  try {
    const payload = {
      level: 'info',
      message: 'chat.ws.client_test_forward',
      timestamp: new Date().toISOString(),
      source: 'client',
      route: '/chat',
      userAgent: 'test',
      correlationId: 'corr-1',
      context: { clientId: 'client-123', extra: 'ok' },
    };

    await request(httpServer).post('/logs').send(payload).expect(202);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.msg, 'CLIENT_LOG');
    const obj = calls[0]?.obj as Record<string, unknown>;
    assert.equal(obj.source, 'client');
    assert.equal(obj.clientId, 'client-123');
    assert.equal(obj.message, 'chat.ws.client_test_forward');
    assert.equal(obj.sequence, 1);

    const res = await request(httpServer)
      .get('/logs')
      .query({ source: 'client', text: 'chat.ws.client_test_forward' })
      .expect(200);

    assert.ok(Array.isArray(res.body.items));
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0]?.source, 'client');
    assert.equal(res.body.items[0]?.context?.clientId, 'client-123');
  } finally {
    (baseLogger as unknown as { info: unknown }).info = originalInfo;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
