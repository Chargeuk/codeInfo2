import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { query, resetStore } from '../../logStore.js';
import { createIngestReembedRouter } from '../../routes/ingestReembed.js';

function buildApp(options?: {
  reembed?: (
    root: string,
  ) => Promise<`${string}-${string}-${string}-${string}-${string}`>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestReembedRouter({
      clientFactory: () => ({}) as never,
      isBusy: () => false,
      reembed: async (root) =>
        options?.reembed
          ? options.reembed(root)
          : ('00000000-0000-0000-0000-000000000001' as const),
    }),
  );
  return app;
}

test.beforeEach(() => {
  resetStore();
});

test('ingest-reembed catch-path logs retryable failures as warn', async () => {
  const response = await request(
    buildApp({
      reembed: async () => {
        const error = new Error('temporarily busy');
        (error as { code?: string }).code = 'BUSY';
        throw error;
      },
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'BUSY');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const warnEntry = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.surface === 'ingest/reembed' &&
      entry.context?.code === 'BUSY',
  );
  assert.ok(warnEntry, 'expected retryable reembed warn log');
});

test('ingest-reembed catch-path logs non-retryable failures as error', async () => {
  const response = await request(
    buildApp({
      reembed: async () => {
        const error = new Error('model locked');
        (error as { code?: string }).code = 'MODEL_LOCKED';
        throw error;
      },
    }),
  ).post('/ingest/reembed/%2Ftmp%2Frepo');

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'MODEL_LOCKED');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const errorEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.surface === 'ingest/reembed' &&
      entry.context?.code === 'MODEL_LOCKED',
  );
  assert.ok(errorEntry, 'expected non-retryable reembed error log');
  assert.equal(errorEntry?.context?.retryable, false);
  assert.equal(errorEntry?.context?.root, '/tmp/repo');
  assert.equal(errorEntry?.context?.runId, undefined);
});
