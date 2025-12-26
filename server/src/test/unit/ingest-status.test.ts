import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  __resetIngestJobsForTest,
  __setStatusForTest,
  getStatus,
} from '../../ingest/ingestJob.js';

const ORIGINAL_ENV = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
});

afterEach(() => {
  __resetIngestJobsForTest();
  process.env.NODE_ENV = ORIGINAL_ENV;
});

test('includes per-file progress fields in ingest status snapshots', () => {
  const runId = 'run-123';
  const status = {
    runId,
    state: 'embedding' as const,
    counts: { files: 3, chunks: 5, embedded: 2 },
    message: 'Embedding 3 files',
    lastError: null,
    currentFile: '/repo/a.txt',
    fileIndex: 1,
    fileTotal: 3,
    percent: 33.3,
    etaMs: 1200,
  };

  __setStatusForTest(runId, status);

  const snapshot = getStatus(runId);

  assert.ok(snapshot, 'expected status to be stored');
  assert.equal(snapshot?.currentFile, status.currentFile);
  assert.equal(snapshot?.fileIndex, status.fileIndex);
  assert.equal(snapshot?.fileTotal, status.fileTotal);
  assert.equal(snapshot?.percent, status.percent);
  assert.equal(snapshot?.etaMs, status.etaMs);
});
