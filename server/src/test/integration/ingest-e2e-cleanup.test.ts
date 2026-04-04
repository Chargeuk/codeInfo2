import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createIngestE2eCleanupRouter } from '../../routes/ingestE2eCleanup.js';

function buildApp(options: {
  enabled?: boolean;
  isBusy?: () => boolean;
  removeRoot?: (rootPath: string) => Promise<{ unlocked: boolean }>;
  deleteWaitingQueueRequestsByTargetPath?: (
    rootPath: string,
  ) => Promise<number>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestE2eCleanupRouter({
      enabled: options.enabled,
      isBusy: options.isBusy as never,
      removeRoot: options.removeRoot as never,
      deleteWaitingQueueRequestsByTargetPath:
        options.deleteWaitingQueueRequestsByTargetPath as never,
    }),
  );
  return app;
}

test('POST /ingest/e2e/cleanup removes waiting queue items even while active work is still draining', async () => {
  let removeCalled = false;
  const app = buildApp({
    enabled: true,
    isBusy: () => true,
    removeRoot: async () => {
      removeCalled = true;
      return { unlocked: false };
    },
    deleteWaitingQueueRequestsByTargetPath: async (rootPath: string) => {
      assert.equal(rootPath, '/fixtures/repo/docs');
      return 1;
    },
  });

  const res = await request(app).post(
    '/ingest/e2e/cleanup/%2Ffixtures%2Frepo%2Fdocs',
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.waitingRemoved, 1);
  assert.equal(res.body.rootRemoved, false);
  assert.equal(removeCalled, false);
});

test('POST /ingest/e2e/cleanup still reports BUSY when no waiting queue item was removed', async () => {
  const app = buildApp({
    enabled: true,
    isBusy: () => true,
    removeRoot: async () => ({ unlocked: false }),
    deleteWaitingQueueRequestsByTargetPath: async () => 0,
  });

  const res = await request(app).post('/ingest/e2e/cleanup/%2Ffixtures%2Frepo');

  assert.equal(res.status, 429);
  assert.equal(res.body.code, 'BUSY');
});

test('POST /ingest/e2e/cleanup falls back to the normal root removal path once the queue is idle', async () => {
  let removedRoot: string | null = null;
  const app = buildApp({
    enabled: true,
    isBusy: () => false,
    removeRoot: async (rootPath: string) => {
      removedRoot = rootPath;
      return { unlocked: true };
    },
    deleteWaitingQueueRequestsByTargetPath: async () => 1,
  });

  const res = await request(app).post(
    '/ingest/e2e/cleanup/%2Ffixtures%2Frepo%2Fdocs',
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.waitingRemoved, 1);
  assert.equal(res.body.rootRemoved, true);
  assert.equal(res.body.unlocked, true);
  assert.equal(removedRoot, '/fixtures/repo/docs');
});
