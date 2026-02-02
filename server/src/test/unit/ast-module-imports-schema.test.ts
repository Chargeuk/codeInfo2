import assert from 'node:assert/strict';
import test from 'node:test';
import { AstModuleImportModel } from '../../mongo/astModuleImport.js';

const requiredPaths = ['root', 'relPath', 'fileHash', 'imports'] as const;

const hasIndex = (
  indexes: Array<[Record<string, 1 | -1>, { unique?: boolean }]>,
  keys: Record<string, 1 | -1>,
) =>
  indexes.some(
    ([indexKeys]) => JSON.stringify(indexKeys) === JSON.stringify(keys),
  );

test('ast_module_imports schema defines required fields', () => {
  const schema = AstModuleImportModel.schema;

  for (const key of requiredPaths) {
    const path = schema.path(key);
    assert(path, `expected schema path to exist: ${key}`);

    const options = (path as unknown as { options?: { required?: boolean } })
      .options;
    assert.equal(options?.required, true, `expected ${key} to be required`);
  }

  const importsPath = schema.path('imports') as unknown as {
    schema?: { path: (key: string) => { options?: { required?: boolean } } };
  };
  assert(importsPath.schema, 'expected imports sub-schema to exist');
  assert.equal(
    importsPath.schema.path('source')?.options?.required,
    true,
    'expected imports.source to be required',
  );
  assert.equal(
    importsPath.schema.path('names')?.options?.required,
    true,
    'expected imports.names to be required',
  );
});

test('ast_module_imports schema includes timestamps', () => {
  const schema = AstModuleImportModel.schema;

  assert(schema.path('createdAt'));
  assert(schema.path('updatedAt'));
});

test('ast_module_imports schema defines compound indexes', () => {
  const indexes = AstModuleImportModel.schema.indexes() as Array<
    [Record<string, 1 | -1>, { unique?: boolean }]
  >;

  assert(
    hasIndex(indexes, { root: 1, relPath: 1, fileHash: 1 }),
    'expected index on { root, relPath, fileHash }',
  );
  assert(
    hasIndex(indexes, { root: 1, relPath: 1 }),
    'expected index on { root, relPath }',
  );
});
