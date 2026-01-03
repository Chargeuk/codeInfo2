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
