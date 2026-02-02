import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  __resetIngestJobsForTest,
  __setStatusForTest,
  getActiveStatus,
  getStatus,
} from '../../ingest/ingestJob.js';
import { acquire, release } from '../../ingest/lock.js';

const ORIGINAL_ENV = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  __resetIngestJobsForTest();
  release();
});

afterEach(() => {
  __resetIngestJobsForTest();
  release();
  process.env.NODE_ENV = ORIGINAL_ENV;
});

test('includes per-file progress fields in ingest status snapshots', () => {
  const runId = 'run-123';
  const status = {
    runId,
    state: 'embedding' as const,
    counts: { files: 3, chunks: 5, embedded: 2 },
    ast: { supportedFileCount: 2, skippedFileCount: 1, failedFileCount: 0 },
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
  assert.equal(
    snapshot?.ast?.supportedFileCount,
    status.ast.supportedFileCount,
  );
  assert.equal(snapshot?.ast?.skippedFileCount, status.ast.skippedFileCount);
  assert.equal(snapshot?.ast?.failedFileCount, status.ast.failedFileCount);
});

test('getActiveStatus prefers active lock owner', () => {
  const lockedRun = 'run-locked';
  const otherRun = 'run-other';
  __setStatusForTest(lockedRun, {
    runId: lockedRun,
    state: 'embedding',
    counts: { files: 1, chunks: 2, embedded: 0 },
    message: 'Embedding',
    lastError: null,
  });
  __setStatusForTest(otherRun, {
    runId: otherRun,
    state: 'scanning',
    counts: { files: 2, chunks: 0, embedded: 0 },
    message: 'Scanning',
    lastError: null,
  });
  assert.equal(acquire(lockedRun), true);

  const active = getActiveStatus();

  assert.equal(active?.runId, lockedRun);
});

test('getActiveStatus falls back when lock owner is terminal', () => {
  const lockedRun = 'run-terminal';
  const activeRun = 'run-active';
  __setStatusForTest(lockedRun, {
    runId: lockedRun,
    state: 'completed',
    counts: { files: 1, chunks: 2, embedded: 2 },
    message: 'Completed',
    lastError: null,
  });
  __setStatusForTest(activeRun, {
    runId: activeRun,
    state: 'embedding',
    counts: { files: 1, chunks: 1, embedded: 0 },
    message: 'Embedding',
    lastError: null,
  });
  assert.equal(acquire(lockedRun), true);

  const active = getActiveStatus();

  assert.equal(active?.runId, activeRun);
});

test('getActiveStatus falls back when lock owner run is missing', () => {
  const missingRun = 'run-missing';
  const activeRun = 'run-active';
  __setStatusForTest(activeRun, {
    runId: activeRun,
    state: 'scanning',
    counts: { files: 3, chunks: 0, embedded: 0 },
    message: 'Scanning',
    lastError: null,
  });
  assert.equal(acquire(missingRun), true);

  const active = getActiveStatus();

  assert.equal(active?.runId, activeRun);
});

test('getActiveStatus returns null when only terminal runs exist', () => {
  __setStatusForTest('run-one', {
    runId: 'run-one',
    state: 'completed',
    counts: { files: 1, chunks: 1, embedded: 1 },
    message: 'Completed',
    lastError: null,
  });
  __setStatusForTest('run-two', {
    runId: 'run-two',
    state: 'error',
    counts: { files: 1, chunks: 0, embedded: 0 },
    message: 'Error',
    lastError: 'boom',
  });

  const active = getActiveStatus();

  assert.equal(active, null);
});
