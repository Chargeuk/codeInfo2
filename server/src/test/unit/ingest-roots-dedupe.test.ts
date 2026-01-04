import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeRootsByPath } from '../../routes/ingestRoots.js';

test('dedupeRootsByPath: keeps newest by lastIngestAt when path duplicates', () => {
  const roots = [
    {
      runId: 'r1',
      name: 'old',
      description: null,
      path: '/data/repo',
      model: 'embed-1',
      status: 'completed',
      lastIngestAt: '2026-01-01T00:00:00Z',
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
    {
      runId: 'r2',
      name: 'new',
      description: null,
      path: '/data/repo',
      model: 'embed-1',
      status: 'completed',
      lastIngestAt: '2026-01-02T00:00:00Z',
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
  ];

  const deduped = dedupeRootsByPath(roots);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.runId, 'r2');
  assert.equal(deduped[0]?.name, 'new');
});

test('dedupeRootsByPath: falls back to runId when lastIngestAt is missing', () => {
  const roots = [
    {
      runId: 'r1',
      name: 'old',
      description: null,
      path: '/data/repo',
      model: 'embed-1',
      status: 'completed',
      lastIngestAt: null,
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
    {
      runId: 'r9',
      name: 'newer',
      description: null,
      path: '/data/repo',
      model: 'embed-1',
      status: 'completed',
      lastIngestAt: null,
      counts: { files: 1, chunks: 1, embedded: 1 },
      lastError: null,
    },
  ];

  const deduped = dedupeRootsByPath(roots);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.runId, 'r9');
  assert.equal(deduped[0]?.name, 'newer');
});
