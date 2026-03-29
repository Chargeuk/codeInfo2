import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { AstCoverageModel } from '../../mongo/astCoverage.js';
import { AstEdgeModel } from '../../mongo/astEdge.js';
import { AstModuleImportModel } from '../../mongo/astModuleImport.js';
import { AstReferenceModel } from '../../mongo/astReference.js';
import { AstSymbolModel } from '../../mongo/astSymbol.js';
import {
  clearAstCoverageByRoot,
  clearAstEdgesByRoot,
  clearAstModuleImportsByRoot,
  clearAstReferencesByRoot,
  clearAstSymbolsByRoot,
  deleteStaleAstSymbolsByRootFiles,
  listAstCoverageByRoot,
  listAstEdgesByRoot,
  listAstModuleImportsByRoot,
  listAstReferencesByRoot,
  listAstSymbolsByRoot,
  upsertAstCoverage,
  upsertAstEdges,
  upsertAstModuleImports,
  upsertAstReferences,
  upsertAstSymbols,
} from '../../mongo/repo.js';

type ModelLike = Record<string, unknown>;

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

function stubModelMethod<T extends ModelLike, K extends keyof T>(
  model: T,
  key: K,
  replacement: T[K],
) {
  const original = model[key];
  model[key] = replacement;
  return () => {
    model[key] = original;
  };
}

const listCases = [
  {
    name: 'listAstSymbolsByRoot',
    run: () => listAstSymbolsByRoot('r1'),
    model: AstSymbolModel,
    method: 'find',
  },
  {
    name: 'listAstEdgesByRoot',
    run: () => listAstEdgesByRoot('r1'),
    model: AstEdgeModel,
    method: 'find',
  },
  {
    name: 'listAstReferencesByRoot',
    run: () => listAstReferencesByRoot('r1'),
    model: AstReferenceModel,
    method: 'find',
  },
  {
    name: 'listAstModuleImportsByRoot',
    run: () => listAstModuleImportsByRoot('r1'),
    model: AstModuleImportModel,
    method: 'find',
  },
  {
    name: 'listAstCoverageByRoot',
    run: () => listAstCoverageByRoot('r1'),
    model: AstCoverageModel,
    method: 'findOne',
  },
] as const;

for (const testCase of listCases) {
  test(`${testCase.name} returns null when Mongo is disconnected`, async () => {
    const restoreReadyState = overrideReadyState(0);
    const restoreMethod = stubModelMethod(
      testCase.model as unknown as ModelLike,
      testCase.method,
      (() => {
        throw new Error(`unexpected mongo call: ${String(testCase.method)}`);
      }) as unknown as (typeof testCase.model)[typeof testCase.method],
    );

    try {
      const result = await testCase.run();
      assert.equal(result, null);
    } finally {
      restoreMethod();
      restoreReadyState();
    }
  });
}

const upsertCases = [
  {
    name: 'upsertAstSymbols',
    run: () =>
      upsertAstSymbols({
        root: 'r1',
        symbols: [
          {
            root: 'r1',
            relPath: 'index.ts',
            fileHash: 'hash',
            language: 'ts',
            kind: 'Module',
            name: 'index',
            range: {
              start: { line: 1, column: 1 },
              end: { line: 1, column: 5 },
            },
            symbolId: 'sym-1',
          },
        ],
      }),
    model: AstSymbolModel,
    method: 'bulkWrite',
  },
  {
    name: 'upsertAstEdges',
    run: () =>
      upsertAstEdges({
        root: 'r1',
        edges: [
          {
            root: 'r1',
            relPath: 'index.ts',
            fileHash: 'hash',
            fromSymbolId: 'from',
            toSymbolId: 'to',
            type: 'CALLS',
          },
        ],
      }),
    model: AstEdgeModel,
    method: 'bulkWrite',
  },
  {
    name: 'upsertAstReferences',
    run: () =>
      upsertAstReferences({
        root: 'r1',
        references: [
          {
            root: 'r1',
            relPath: 'index.ts',
            fileHash: 'hash',
            name: 'foo',
            range: {
              start: { line: 2, column: 1 },
              end: { line: 2, column: 3 },
            },
          },
        ],
      }),
    model: AstReferenceModel,
    method: 'bulkWrite',
  },
  {
    name: 'upsertAstModuleImports',
    run: () =>
      upsertAstModuleImports({
        root: 'r1',
        modules: [
          {
            root: 'r1',
            relPath: 'index.ts',
            fileHash: 'hash',
            imports: [{ source: './dep', names: ['foo'] }],
          },
        ],
      }),
    model: AstModuleImportModel,
    method: 'bulkWrite',
  },
  {
    name: 'upsertAstCoverage',
    run: () =>
      upsertAstCoverage({
        root: 'r1',
        coverage: {
          root: 'r1',
          supportedFileCount: 1,
          skippedFileCount: 0,
          failedFileCount: 0,
          lastIndexedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      }),
    model: AstCoverageModel,
    method: 'updateOne',
  },
] as const;

for (const testCase of upsertCases) {
  test(`${testCase.name} returns null when Mongo is disconnected`, async () => {
    const restoreReadyState = overrideReadyState(0);
    const restoreMethod = stubModelMethod(
      testCase.model as unknown as ModelLike,
      testCase.method,
      (async () => {
        throw new Error(`unexpected mongo call: ${String(testCase.method)}`);
      }) as unknown as (typeof testCase.model)[typeof testCase.method],
    );

    try {
      const result = await testCase.run();
      assert.equal(result, null);
    } finally {
      restoreMethod();
      restoreReadyState();
    }
  });
}

const clearCases = [
  {
    name: 'clearAstSymbolsByRoot',
    run: () => clearAstSymbolsByRoot('r1'),
    model: AstSymbolModel,
    method: 'deleteMany',
  },
  {
    name: 'clearAstEdgesByRoot',
    run: () => clearAstEdgesByRoot('r1'),
    model: AstEdgeModel,
    method: 'deleteMany',
  },
  {
    name: 'clearAstReferencesByRoot',
    run: () => clearAstReferencesByRoot('r1'),
    model: AstReferenceModel,
    method: 'deleteMany',
  },
  {
    name: 'clearAstModuleImportsByRoot',
    run: () => clearAstModuleImportsByRoot('r1'),
    model: AstModuleImportModel,
    method: 'deleteMany',
  },
  {
    name: 'clearAstCoverageByRoot',
    run: () => clearAstCoverageByRoot('r1'),
    model: AstCoverageModel,
    method: 'deleteMany',
  },
] as const;

for (const testCase of clearCases) {
  test(`${testCase.name} returns null when Mongo is disconnected`, async () => {
    const restoreReadyState = overrideReadyState(0);
    const restoreMethod = stubModelMethod(
      testCase.model as unknown as ModelLike,
      testCase.method,
      (async () => {
        throw new Error(`unexpected mongo call: ${String(testCase.method)}`);
      }) as unknown as (typeof testCase.model)[typeof testCase.method],
    );

    try {
      const result = await testCase.run();
      assert.equal(result, null);
    } finally {
      restoreMethod();
      restoreReadyState();
    }
  });
}

test('deleteStaleAstSymbolsByRootFiles returns null when Mongo is disconnected', async () => {
  const restoreReadyState = overrideReadyState(0);
  const restoreDeleteMany = stubModelMethod(
    AstSymbolModel as unknown as ModelLike,
    'deleteMany',
    (() => {
      throw new Error('unexpected mongo call: deleteMany');
    }) as unknown as (typeof AstSymbolModel)['deleteMany'],
  );
  const restoreDistinct = stubModelMethod(
    AstSymbolModel as unknown as ModelLike,
    'distinct',
    (() => {
      throw new Error('unexpected mongo call: distinct');
    }) as unknown as (typeof AstSymbolModel)['distinct'],
  );

  try {
    const result = await deleteStaleAstSymbolsByRootFiles({
      root: 'r1',
      files: [{ relPath: 'a.ts', fileHash: 'hash-a' }],
    });
    assert.equal(result, null);
  } finally {
    restoreDistinct();
    restoreDeleteMany();
    restoreReadyState();
  }
});

test('deleteStaleAstSymbolsByRootFiles batches stale deletes and mismatched hashes', async () => {
  const restoreReadyState = overrideReadyState(1);
  const distinctCalls: Array<[string, Record<string, unknown>]> = [];
  const deleteCalls: Record<string, unknown>[] = [];
  const restoreDistinct = stubModelMethod(
    AstSymbolModel as unknown as ModelLike,
    'distinct',
    ((field: string, query: Record<string, unknown>) => {
      distinctCalls.push([field, query]);
      return {
        exec: async () => ['stale.ts'],
      };
    }) as unknown as (typeof AstSymbolModel)['distinct'],
  );
  const restoreDeleteMany = stubModelMethod(
    AstSymbolModel as unknown as ModelLike,
    'deleteMany',
    ((query: Record<string, unknown>) => {
      deleteCalls.push(query);
      return { exec: async () => ({}) };
    }) as unknown as (typeof AstSymbolModel)['deleteMany'],
  );

  try {
    const files = Array.from({ length: 205 }, (_, index) => ({
      relPath: `src/file-${index}.ts`,
      fileHash: `hash-${index}`,
    }));

    const result = await deleteStaleAstSymbolsByRootFiles({
      root: 'r1',
      files,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(distinctCalls.length, 1);
    assert.deepEqual(distinctCalls[0], ['relPath', { root: 'r1' }]);
    assert.equal(deleteCalls.length, 3);
    assert.deepEqual(deleteCalls[0], {
      root: 'r1',
      relPath: { $in: ['stale.ts'] },
    });
    assert.equal((deleteCalls[1].$or as unknown[]).length, 200);
    assert.equal((deleteCalls[2].$or as unknown[]).length, 5);
  } finally {
    restoreDeleteMany();
    restoreDistinct();
    restoreReadyState();
  }
});
