import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { resetStore } from '../../logStore.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';
import { createIngestRootsRouter } from '../../routes/ingestRoots.js';
import { createIngestStartRouter } from '../../routes/ingestStart.js';
import { createLogsRouter } from '../../routes/logs.js';

function createApp() {
  const app = express();
  app.use(express.json());

  app.use(
    createIngestStartRouter({
      clientFactory: () => ({}) as never,
      collectionIsEmpty: async () => true,
      getLockedEmbeddingModel: async () => null,
      startIngest: async () => {
        const error = new Error('temporarily busy');
        (error as { code?: string }).code = 'BUSY';
        throw error;
      },
    }),
  );

  app.use(
    createIngestReembedRouter({
      clientFactory: () => ({}) as never,
      isBusy: () => false,
      reembed: async () => {
        const error = new Error('locked');
        (error as { code?: string }).code = 'MODEL_LOCKED';
        throw error;
      },
    }),
  );

  app.use(
    createIngestCancelRouter({
      getStatus: () => ({ runId: 'run-1' }) as never,
      isBusy: () => false,
      cancelRun: async () => {
        const error = new Error('not found');
        (error as { code?: string }).code = 'NOT_FOUND';
        throw error;
      },
    }),
  );

  app.use(
    createIngestRootsRouter({
      getLockedModel: async () => null,
      getRootsCollection: async () => {
        throw new Error('db read failed');
      },
    }),
  );

  app.use('/logs', createLogsRouter());
  return app;
}

test('ingest route failure coverage emits structured warn/error entries via /logs and /logs/stream', async () => {
  resetStore();
  const app = createApp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await request(app)
      .post('/ingest/start')
      .send({ path: '/tmp/repo', name: 'repo', model: 'nomic-embed' })
      .expect(429);
    await request(app).post('/ingest/reembed/%2Ftmp%2Frepo').expect(409);
    await request(app).post('/ingest/cancel/run-1').expect(404);
    await request(app).get('/ingest/roots').expect(502);

    const logsRes = await request(app)
      .get('/logs')
      .query({ text: 'DEV-0000036:T17:ingest_provider_failure' })
      .expect(200);

    const items = logsRes.body.items as Array<{
      level: string;
      context?: Record<string, unknown>;
    }>;
    assert.ok(
      items.some(
        (entry) =>
          entry.level === 'warn' &&
          entry.context?.surface === 'ingest/start' &&
          entry.context?.retryable === true &&
          entry.context?.code === 'BUSY',
      ),
    );
    assert.ok(
      items.some(
        (entry) =>
          entry.level === 'error' &&
          entry.context?.surface === 'ingest/reembed' &&
          entry.context?.code === 'MODEL_LOCKED',
      ),
    );
    assert.ok(
      items.some(
        (entry) =>
          entry.level === 'error' &&
          entry.context?.surface === 'ingest/cancel' &&
          entry.context?.code === 'NOT_FOUND',
      ),
    );
    assert.ok(
      items.some(
        (entry) =>
          entry.level === 'error' &&
          entry.context?.surface === 'ingest/roots' &&
          entry.context?.code === 'INGEST_ROOTS_LOOKUP_FAILED',
      ),
    );

    const streamBody = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        `${baseUrl}/logs/stream?text=${encodeURIComponent(
          'DEV-0000036:T17:ingest_provider_failure',
        )}`,
      );
      req.on('response', (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (
            body.includes('"surface":"ingest/start"') &&
            body.includes('"surface":"ingest/reembed"')
          ) {
            req.destroy();
            resolve(body);
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      setTimeout(() => {
        req.destroy();
        resolve('');
      }, 1000);
    });

    assert.ok(streamBody.includes('DEV-0000036:T17:ingest_provider_failure'));
    assert.ok(streamBody.includes('"surface":"ingest/start"'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
