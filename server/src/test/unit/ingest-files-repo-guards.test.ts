import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { IngestFileModel } from '../../mongo/ingestFile.js';
import {
  clearIngestFilesByRoot,
  deleteIngestFilesByRelPaths,
  listIngestFilesByRoot,
  upsertIngestFiles,
} from '../../mongo/repo.js';

function overrideReadyState(value: number) {
  const conn = mongoose.connection as unknown as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(conn, 'readyState');
  const original = Object.getOwnPropertyDescriptor(conn, 'readyState');

  Object.defineProperty(conn, 'readyState', {
    configurable: true,
    get: () => value,
  });

  return () => {
    if (hadOwn && original) {
      Object.defineProperty(conn, 'readyState', original);
      return;
    }

    delete conn.readyState;
  };
}

function stubModelMethod<T extends keyof typeof IngestFileModel>(
  key: T,
  replacement: (typeof IngestFileModel)[T],
) {
  const original = IngestFileModel[key];
  (IngestFileModel as unknown as Record<string, unknown>)[key as string] =
    replacement;
  return () => {
    (IngestFileModel as unknown as Record<string, unknown>)[key as string] =
      original;
  };
}

test('listIngestFilesByRoot(root) returns null when Mongo is disconnected', async () => {
  const restoreReadyState = overrideReadyState(0);
  const restoreFind = stubModelMethod('find', (() => {
    throw new Error('unexpected mongo call: IngestFileModel.find');
  }) as unknown as typeof IngestFileModel.find);

  try {
    const result = await listIngestFilesByRoot('r1');
    assert.equal(result, null);
  } finally {
    restoreFind();
    restoreReadyState();
  }
});

test('upsertIngestFiles(...) returns null when Mongo is disconnected', async () => {
  const restoreReadyState = overrideReadyState(0);
  const restoreBulkWrite = stubModelMethod('bulkWrite', (async () => {
    throw new Error('unexpected mongo call: IngestFileModel.bulkWrite');
  }) as unknown as typeof IngestFileModel.bulkWrite);

  try {
    const result = await upsertIngestFiles({
      root: 'r1',
      files: [{ relPath: 'a.txt', fileHash: 'h1' }],
    });
    assert.equal(result, null);
  } finally {
    restoreBulkWrite();
    restoreReadyState();
  }
});

test('deleteIngestFilesByRelPaths(...) returns null when Mongo is disconnected', async () => {
  const restoreReadyState = overrideReadyState(0);
  const restoreDeleteMany = stubModelMethod('deleteMany', (async () => {
    throw new Error('unexpected mongo call: IngestFileModel.deleteMany');
  }) as unknown as typeof IngestFileModel.deleteMany);

  try {
    const result = await deleteIngestFilesByRelPaths({
      root: 'r1',
      relPaths: ['a.txt'],
    });
    assert.equal(result, null);
  } finally {
    restoreDeleteMany();
    restoreReadyState();
  }
});

test('deleteIngestFilesByRelPaths(...) batches large relPath deletes into bounded selectors', async () => {
  const restoreReadyState = overrideReadyState(1);
  const queries: Array<{ root?: string; relPath?: { $in?: string[] } }> = [];
  const restoreDeleteMany = stubModelMethod('deleteMany', ((query: {
    root?: string;
    relPath?: { $in?: string[] };
  }) => ({
    exec: async () => {
      queries.push(query);
      return {
        acknowledged: true,
        deletedCount: query.relPath?.$in?.length ?? 0,
      };
    },
  })) as unknown as typeof IngestFileModel.deleteMany);

  try {
    const relPaths = Array.from(
      { length: 450 },
      (_, index) => `src/file-${index}.ts`,
    );
    const result = await deleteIngestFilesByRelPaths({
      root: 'r1',
      relPaths,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(queries.length, 3);
    assert.deepEqual(
      queries.map((query) => query.relPath?.$in?.length ?? 0),
      [200, 200, 50],
    );
    assert.deepEqual(
      queries.flatMap((query) => query.relPath?.$in ?? []),
      relPaths,
    );
  } finally {
    restoreDeleteMany();
    restoreReadyState();
  }
});

test('deleteIngestFilesByRelPaths(...) removes the full intended relPath set across batches', async () => {
  const restoreReadyState = overrideReadyState(1);
  const persistedRelPaths = new Set([
    ...Array.from({ length: 405 }, (_, index) => `docs/deleted-${index}.md`),
    'docs/keep.md',
  ]);
  const restoreDeleteMany = stubModelMethod('deleteMany', ((query: {
    relPath?: { $in?: string[] };
  }) => ({
    exec: async () => {
      for (const relPath of query.relPath?.$in ?? []) {
        persistedRelPaths.delete(relPath);
      }
      return { acknowledged: true, deletedCount: 0 };
    },
  })) as unknown as typeof IngestFileModel.deleteMany);

  try {
    const relPaths = Array.from(
      { length: 405 },
      (_, index) => `docs/deleted-${index}.md`,
    );
    const result = await deleteIngestFilesByRelPaths({
      root: 'r1',
      relPaths,
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual([...persistedRelPaths], ['docs/keep.md']);
  } finally {
    restoreDeleteMany();
    restoreReadyState();
  }
});

test('clearIngestFilesByRoot(root) returns null when Mongo is disconnected', async () => {
  const restoreReadyState = overrideReadyState(0);
  const restoreDeleteMany = stubModelMethod('deleteMany', (async () => {
    throw new Error('unexpected mongo call: IngestFileModel.deleteMany');
  }) as unknown as typeof IngestFileModel.deleteMany);

  try {
    const result = await clearIngestFilesByRoot('r1');
    assert.equal(result, null);
  } finally {
    restoreDeleteMany();
    restoreReadyState();
  }
});
