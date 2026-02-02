import assert from 'node:assert/strict';
import test from 'node:test';
import { AstCoverageModel } from '../../mongo/astCoverage.js';

const requiredPaths = [
  'root',
  'supportedFileCount',
  'skippedFileCount',
  'failedFileCount',
  'lastIndexedAt',
] as const;

const hasIndex = (
  indexes: Array<[Record<string, 1 | -1>, { unique?: boolean }]>,
  keys: Record<string, 1 | -1>,
  unique?: boolean,
) =>
  indexes.some(
    ([indexKeys, options]) =>
      JSON.stringify(indexKeys) === JSON.stringify(keys) &&
      (unique === undefined || Boolean(options.unique) === unique),
  );

test('ast_coverage schema defines required fields', () => {
  const schema = AstCoverageModel.schema;

  for (const key of requiredPaths) {
    const path = schema.path(key);
    assert(path, `expected schema path to exist: ${key}`);

    const options = (path as unknown as { options?: { required?: boolean } })
      .options;
    assert.equal(options?.required, true, `expected ${key} to be required`);
  }
});

test('ast_coverage schema includes timestamps', () => {
  const schema = AstCoverageModel.schema;

  assert(schema.path('createdAt'));
  assert(schema.path('updatedAt'));
});

test('ast_coverage schema defines unique root index', () => {
  const indexes = AstCoverageModel.schema.indexes() as Array<
    [Record<string, 1 | -1>, { unique?: boolean }]
  >;

  assert(
    hasIndex(indexes, { root: 1 }, true),
    'expected unique index on { root }',
  );
});
