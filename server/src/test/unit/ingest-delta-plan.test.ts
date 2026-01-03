import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeltaPlan,
  type DiscoveredFileHash,
  type IndexedFile,
} from '../../ingest/deltaPlan.js';

test('buildDeltaPlan: no previous, discovered has 2 files -> all added', () => {
  const previous: IndexedFile[] = [];
  const discovered: DiscoveredFileHash[] = [
    { absPath: '/data/repo/a.txt', relPath: 'a.txt', fileHash: 'h1' },
    { absPath: '/data/repo/b.txt', relPath: 'b.txt', fileHash: 'h2' },
  ];

  const plan = buildDeltaPlan({ previous, discovered });

  assert.equal(plan.added.length, 2);
  assert.equal(plan.changed.length, 0);
  assert.equal(plan.unchanged.length, 0);
  assert.equal(plan.deleted.length, 0);
});

test('buildDeltaPlan: previous has 2, discovered matches hashes -> all unchanged', () => {
  const previous: IndexedFile[] = [
    { relPath: 'a.txt', fileHash: 'h1' },
    { relPath: 'b.txt', fileHash: 'h2' },
  ];
  const discovered: DiscoveredFileHash[] = [
    { absPath: '/data/repo/b.txt', relPath: 'b.txt', fileHash: 'h2' },
    { absPath: '/data/repo/a.txt', relPath: 'a.txt', fileHash: 'h1' },
  ];

  const plan = buildDeltaPlan({ previous, discovered });

  assert.equal(plan.unchanged.length, 2);
  assert.equal(plan.added.length, 0);
  assert.equal(plan.changed.length, 0);
  assert.equal(plan.deleted.length, 0);
});

test('buildDeltaPlan: previous has 2, discovered changes one hash -> 1 changed, 1 unchanged', () => {
  const previous: IndexedFile[] = [
    { relPath: 'a.txt', fileHash: 'h1' },
    { relPath: 'b.txt', fileHash: 'h2' },
  ];
  const discovered: DiscoveredFileHash[] = [
    { absPath: '/data/repo/a.txt', relPath: 'a.txt', fileHash: 'h1' },
    { absPath: '/data/repo/b.txt', relPath: 'b.txt', fileHash: 'h2-changed' },
  ];

  const plan = buildDeltaPlan({ previous, discovered });

  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0]?.relPath, 'b.txt');
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.unchanged[0]?.relPath, 'a.txt');
  assert.equal(plan.added.length, 0);
  assert.equal(plan.deleted.length, 0);
});

test('buildDeltaPlan: previous has 2, discovered missing one relPath -> 1 deleted', () => {
  const previous: IndexedFile[] = [
    { relPath: 'a.txt', fileHash: 'h1' },
    { relPath: 'b.txt', fileHash: 'h2' },
  ];
  const discovered: DiscoveredFileHash[] = [
    { absPath: '/data/repo/a.txt', relPath: 'a.txt', fileHash: 'h1' },
  ];

  const plan = buildDeltaPlan({ previous, discovered });

  assert.equal(plan.deleted.length, 1);
  assert.equal(plan.deleted[0]?.relPath, 'b.txt');
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.unchanged[0]?.relPath, 'a.txt');
  assert.equal(plan.added.length, 0);
  assert.equal(plan.changed.length, 0);
});

test('buildDeltaPlan: mixed add + change + delete in one run', () => {
  const previous: IndexedFile[] = [
    { relPath: 'a.txt', fileHash: 'h1' },
    { relPath: 'b.txt', fileHash: 'h2' },
    { relPath: 'c.txt', fileHash: 'h3' },
  ];
  const discovered: DiscoveredFileHash[] = [
    { absPath: '/data/repo/d.txt', relPath: 'd.txt', fileHash: 'h4' },
    { absPath: '/data/repo/b.txt', relPath: 'b.txt', fileHash: 'h2-new' },
    { absPath: '/data/repo/a.txt', relPath: 'a.txt', fileHash: 'h1' },
  ];

  const plan = buildDeltaPlan({ previous, discovered });

  assert.deepEqual(
    {
      added: plan.added.map((f) => f.relPath),
      changed: plan.changed.map((f) => f.relPath),
      deleted: plan.deleted.map((f) => f.relPath),
      unchanged: plan.unchanged.map((f) => f.relPath),
    },
    {
      added: ['d.txt'],
      changed: ['b.txt'],
      deleted: ['c.txt'],
      unchanged: ['a.txt'],
    },
  );
});
