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
