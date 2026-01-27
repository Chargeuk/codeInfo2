import assert from 'node:assert/strict';
import test from 'node:test';
import { AstSymbolModel } from '../../mongo/astSymbol.js';

const requiredPaths = [
  'root',
  'relPath',
  'fileHash',
  'language',
  'kind',
  'name',
  'symbolId',
  'range.start.line',
  'range.start.column',
  'range.end.line',
  'range.end.column',
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

test('ast_symbols schema defines required fields', () => {
  const schema = AstSymbolModel.schema;

  for (const key of requiredPaths) {
    const path = schema.path(key);
    assert(path, `expected schema path to exist: ${key}`);

    const options = (path as unknown as { options?: { required?: boolean } })
      .options;
    assert.equal(options?.required, true, `expected ${key} to be required`);
  }
});

test('ast_symbols schema includes timestamps', () => {
  const schema = AstSymbolModel.schema;

  assert(schema.path('createdAt'));
  assert(schema.path('updatedAt'));
});

test('ast_symbols schema defines compound indexes', () => {
  const indexes = AstSymbolModel.schema.indexes() as Array<
    [Record<string, 1 | -1>, { unique?: boolean }]
  >;

  assert(
    hasIndex(indexes, { root: 1, relPath: 1, fileHash: 1 }, false),
    'expected index on { root, relPath, fileHash }',
  );
  assert(
    hasIndex(indexes, { root: 1, symbolId: 1 }, true),
    'expected unique index on { root, symbolId }',
  );
  assert(
    hasIndex(indexes, { root: 1, kind: 1 }, false),
    'expected index on { root, kind }',
  );
});
