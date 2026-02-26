import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { query, resetStore } from '../../logStore.js';
import { createIngestCancelRouter } from '../../routes/ingestCancel.js';

function buildApp(options?: {
  cancelRun?: (
    runId: string,
  ) => Promise<{ cleanupState: 'complete'; found: boolean }>;
  getStatus?: (runId: string) => { runId: string } | null;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createIngestCancelRouter({
      cancelRun: options?.cancelRun as never,
      getStatus: (options?.getStatus ?? (() => ({ runId: 'run-1' }))) as never,
      isBusy: () => false,
    }),
  );
  return app;
}

test.beforeEach(() => {
  resetStore();
});

test('ingest-cancel catch path logs retryable failures as warn', async () => {
  const response = await request(
    buildApp({
      cancelRun: async () => {
        const error = new Error('temporary unavailable');
        (error as { code?: string }).code = 'BUSY';
        throw error;
      },
    }),
  ).post('/ingest/cancel/run-1');

  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'BUSY');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const warnEntry = entries.find(
    (entry) =>
      entry.level === 'warn' &&
      entry.context?.surface === 'ingest/cancel' &&
      entry.context?.code === 'BUSY',
  );
  assert.ok(warnEntry, 'expected warn-level cancel failure log');
  assert.equal(warnEntry?.context?.retryable, true);
});

test('ingest-cancel catch path logs non-retryable failures as error', async () => {
  const response = await request(
    buildApp({
      cancelRun: async () => {
        const error = new Error('lock metadata invalid');
        (error as { code?: string }).code = 'INVALID_LOCK_METADATA';
        throw error;
      },
    }),
  ).post('/ingest/cancel/run-2');

  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'INVALID_LOCK_METADATA');

  const entries = query(
    { text: 'DEV-0000036:T17:ingest_provider_failure' },
    20,
  );
  const errorEntry = entries.find(
    (entry) =>
      entry.level === 'error' &&
      entry.context?.surface === 'ingest/cancel' &&
      entry.context?.code === 'INVALID_LOCK_METADATA',
  );
  assert.ok(errorEntry, 'expected error-level cancel failure log');
  assert.equal(errorEntry?.context?.retryable, false);
});
