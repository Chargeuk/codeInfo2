import assert from 'node:assert/strict';
import test from 'node:test';
import { AstEdgeModel } from '../../mongo/astEdge.js';

const requiredPaths = [
  'root',
  'relPath',
  'fileHash',
  'fromSymbolId',
  'toSymbolId',
  'type',
] as const;

const hasIndex = (
  indexes: Array<[Record<string, 1 | -1>, { unique?: boolean }]>,
  keys: Record<string, 1 | -1>,
) =>
  indexes.some(
    ([indexKeys]) => JSON.stringify(indexKeys) === JSON.stringify(keys),
  );

test('ast_edges schema defines required fields', () => {
  const schema = AstEdgeModel.schema;

  for (const key of requiredPaths) {
    const path = schema.path(key);
    assert(path, `expected schema path to exist: ${key}`);

    const options = (path as unknown as { options?: { required?: boolean } })
      .options;
    assert.equal(options?.required, true, `expected ${key} to be required`);
  }
});

test('ast_edges schema defines createdAt only', () => {
  const schema = AstEdgeModel.schema;

  assert(schema.path('createdAt'));
  assert.equal(schema.path('updatedAt'), undefined);
});

test('ast_edges schema defines compound indexes', () => {
  const indexes = AstEdgeModel.schema.indexes() as Array<
    [Record<string, 1 | -1>, { unique?: boolean }]
  >;

  assert(
    hasIndex(indexes, { root: 1, fromSymbolId: 1 }),
    'expected index on { root, fromSymbolId }',
  );
  assert(
    hasIndex(indexes, { root: 1, toSymbolId: 1 }),
    'expected index on { root, toSymbolId }',
  );
  assert(
    hasIndex(indexes, { root: 1, relPath: 1, fileHash: 1 }),
    'expected index on { root, relPath, fileHash }',
  );
});
