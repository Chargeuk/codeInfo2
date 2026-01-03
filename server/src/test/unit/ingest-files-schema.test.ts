import assert from 'node:assert/strict';
import test from 'node:test';
import { IngestFileModel } from '../../mongo/ingestFile.js';

test('ingest_files schema defines required fields', () => {
  const schema = IngestFileModel.schema;

  for (const key of ['root', 'relPath', 'fileHash'] as const) {
    const path = schema.path(key);
    assert(path, `expected schema path to exist: ${key}`);

    const options = (path as unknown as { options?: { required?: boolean } })
      .options;
    assert.equal(options?.required, true, `expected ${key} to be required`);
  }
});

test('ingest_files schema defines unique compound index on { root, relPath }', () => {
  const indexes = IngestFileModel.schema.indexes() as Array<
    [Record<string, 1 | -1>, { unique?: boolean }]
  >;
  const uniqueIndexes = indexes.filter(([, options]) => options.unique);

  assert.equal(uniqueIndexes.length, 1);
  assert.deepEqual(uniqueIndexes[0]?.[0], { root: 1, relPath: 1 });
});

test('ingest_files schema defines non-unique index on { root }', () => {
  const indexes = IngestFileModel.schema.indexes() as Array<
    [Record<string, 1 | -1>, { unique?: boolean }]
  >;
  const rootIndexes = indexes.filter(
    ([keys, options]) =>
      JSON.stringify(keys) === JSON.stringify({ root: 1 }) && !options.unique,
  );

  assert.equal(rootIndexes.length, 1);
});
