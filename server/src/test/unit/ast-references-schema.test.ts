import assert from 'node:assert/strict';
import test from 'node:test';
import { AstReferenceModel } from '../../mongo/astReference.js';

const requiredPaths = [
  'root',
  'relPath',
  'fileHash',
  'name',
  'range.start.line',
  'range.start.column',
  'range.end.line',
  'range.end.column',
] as const;

const hasIndex = (
  indexes: Array<[Record<string, 1 | -1>, { unique?: boolean }]>,
  keys: Record<string, 1 | -1>,
) =>
  indexes.some(
    ([indexKeys]) => JSON.stringify(indexKeys) === JSON.stringify(keys),
  );

test('ast_references schema defines required fields', () => {
  const schema = AstReferenceModel.schema;

  for (const key of requiredPaths) {
    const path = schema.path(key);
    assert(path, `expected schema path to exist: ${key}`);

    const options = (path as unknown as { options?: { required?: boolean } })
      .options;
    assert.equal(options?.required, true, `expected ${key} to be required`);
  }
});

test('ast_references schema defines createdAt only', () => {
  const schema = AstReferenceModel.schema;

  assert(schema.path('createdAt'));
  assert.equal(schema.path('updatedAt'), undefined);
});

test('ast_references schema defines compound indexes', () => {
  const indexes = AstReferenceModel.schema.indexes() as Array<
    [Record<string, 1 | -1>, { unique?: boolean }]
  >;

  assert(
    hasIndex(indexes, { root: 1, symbolId: 1 }),
    'expected index on { root, symbolId }',
  );
  assert(
    hasIndex(indexes, { root: 1, name: 1, kind: 1 }),
    'expected index on { root, name, kind }',
  );
  assert(
    hasIndex(indexes, { root: 1, relPath: 1, fileHash: 1 }),
    'expected index on { root, relPath, fileHash }',
  );
});
