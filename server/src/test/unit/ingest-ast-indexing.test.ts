import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, mock } from 'node:test';
import type { LMStudioClient } from '@lmstudio/sdk';
import { ChromaClient } from 'chromadb';
import mongoose from 'mongoose';
import { __setParseAstSourceForTest } from '../../ast/parser.js';
import type { AstParseResult, ParseAstSourceInput } from '../../ast/types.js';
import { resetCollectionsForTests } from '../../ingest/chromaClient.js';
import { hashFile } from '../../ingest/hashing.js';
import {
  __resetIngestJobsForTest,
  cancelRun,
  getStatus,
  startIngest,
} from '../../ingest/ingestJob.js';
import { release } from '../../ingest/lock.js';
import { query, resetStore } from '../../logStore.js';
import { AstCoverageModel } from '../../mongo/astCoverage.js';
import { AstEdgeModel } from '../../mongo/astEdge.js';
import { AstModuleImportModel } from '../../mongo/astModuleImport.js';
import { AstReferenceModel } from '../../mongo/astReference.js';
import { AstSymbolModel } from '../../mongo/astSymbol.js';
import { IngestFileModel } from '../../mongo/ingestFile.js';

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_READY_STATE = mongoose.connection.readyState;

const baseAstResult: AstParseResult = {
  status: 'ok' as const,
  language: 'typescript' as const,
  symbols: [],
  edges: [],
  references: [],
  imports: [],
};

let mongoMocks: ReturnType<typeof setupMongoMocks>;

const createTempRepo = async (files: Record<string, string>) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codeinfo2-ingest-ast-'),
  );
  await fs.mkdir(path.join(root, '.git'));
  await Promise.all(
    Object.entries(files).map(async ([relPath, contents]) => {
      const fullPath = path.join(root, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, contents, 'utf8');
    }),
  );
  process.env.INGEST_TEST_GIT_PATHS = Object.keys(files).join(',');
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
};

const waitForTerminal = async (runId: string) => {
  const terminal = new Set(['completed', 'skipped', 'cancelled', 'error']);
  for (let i = 0; i < 100; i += 1) {
    const status = getStatus(runId);
    if (status && terminal.has(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ingest ${runId}`);
};

const buildDeps = () => {
  const embeddingModel = {
    embed: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    getContextLength: async () => 256,
    countTokens: async (text: string) =>
      text.split(/\s+/).filter(Boolean).length,
  };
  return {
    baseUrl: 'http://lmstudio.local',
    lmClientFactory: () =>
      ({
        embedding: {
          model: async () => embeddingModel,
        },
      }) as unknown as LMStudioClient,
  };
};

const mockParseAstSource = (
  impl: (
    input: ParseAstSourceInput,
  ) => Promise<AstParseResult> | AstParseResult = async () => baseAstResult,
) => {
  const calls: Array<{ arguments: [ParseAstSourceInput, unknown?] }> = [];
  const wrapper = async (input: ParseAstSourceInput, options?: unknown) => {
    calls.push({ arguments: [input, options] });
    return impl(input);
  };
  __setParseAstSourceForTest(wrapper);
  return { mock: { calls } };
};

const setupChromaMocks = () => {
  const vectors = {
    metadata: { lockedModelId: null as string | null },
    add: async () => {},
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    delete: async () => {},
    modify: async ({ metadata }: { metadata?: Record<string, unknown> }) => {
      vectors.metadata = {
        ...(vectors.metadata ?? {}),
        ...(metadata ?? {}),
      } as { lockedModelId: string | null };
    },
    count: async () => 0,
  };
  const roots = {
    get: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    add: async () => {},
    delete: async () => {},
  };

  mock.method(
    ChromaClient.prototype,
    'getOrCreateCollection',
    async (opts: { name?: string }) => {
      if (opts.name === 'ingest_roots') return roots as never;
      return vectors as never;
    },
  );
  mock.method(ChromaClient.prototype, 'deleteCollection', async () => {});

  return { vectors, roots };
};

const setupMongoMocks = () => {
  let ingestRows: Array<{ relPath: string; fileHash: string }> = [];

  const astSymbolsBulkWrite = mock.fn(async () => ({}));
  const astSymbolsDeleteMany = mock.fn(() => ({ exec: async () => ({}) }));
  const astEdgesBulkWrite = mock.fn(async () => ({}));
  const astEdgesDeleteMany = mock.fn(() => ({ exec: async () => ({}) }));
  const astReferencesBulkWrite = mock.fn(async () => ({}));
  const astReferencesDeleteMany = mock.fn(() => ({ exec: async () => ({}) }));
  const astModuleImportsBulkWrite = mock.fn(async () => ({}));
  const astModuleImportsDeleteMany = mock.fn(() => ({
    exec: async () => ({}),
  }));
  const astCoverageUpdateOne = mock.fn(() => ({ exec: async () => ({}) }));
  const astCoverageDeleteMany = mock.fn(() => ({ exec: async () => ({}) }));
  const ingestFilesBulkWrite = mock.fn(async () => ({}));
  const ingestFilesDeleteMany = mock.fn(() => ({ exec: async () => ({}) }));

  mock.method(AstSymbolModel, 'bulkWrite', astSymbolsBulkWrite);
  mock.method(AstSymbolModel, 'deleteMany', astSymbolsDeleteMany);
  mock.method(AstEdgeModel, 'bulkWrite', astEdgesBulkWrite);
  mock.method(AstEdgeModel, 'deleteMany', astEdgesDeleteMany);
  mock.method(AstReferenceModel, 'bulkWrite', astReferencesBulkWrite);
  mock.method(AstReferenceModel, 'deleteMany', astReferencesDeleteMany);
  mock.method(AstModuleImportModel, 'bulkWrite', astModuleImportsBulkWrite);
  mock.method(AstModuleImportModel, 'deleteMany', astModuleImportsDeleteMany);
  mock.method(AstCoverageModel, 'updateOne', astCoverageUpdateOne);
  mock.method(AstCoverageModel, 'deleteMany', astCoverageDeleteMany);
  mock.method(IngestFileModel, 'bulkWrite', ingestFilesBulkWrite);
  mock.method(IngestFileModel, 'deleteMany', ingestFilesDeleteMany);
  mock.method(IngestFileModel, 'find', () => ({
    select: () => ({
      lean: () => ({
        exec: async () => ingestRows,
      }),
    }),
  }));

  return {
    astSymbolsBulkWrite,
    astSymbolsDeleteMany,
    astEdgesBulkWrite,
    astEdgesDeleteMany,
    astReferencesBulkWrite,
    astReferencesDeleteMany,
    astModuleImportsBulkWrite,
    astModuleImportsDeleteMany,
    astCoverageUpdateOne,
    astCoverageDeleteMany,
    ingestFilesBulkWrite,
    ingestFilesDeleteMany,
    setIngestFileRows: (rows: Array<{ relPath: string; fileHash: string }>) => {
      ingestRows = rows;
    },
  };
};

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  resetStore();
  __resetIngestJobsForTest();
  release();
  mock.restoreAll();
  mock.reset();
  resetCollectionsForTests();
  setupChromaMocks();
  mongoMocks = setupMongoMocks();
  __setParseAstSourceForTest();
  (mongoose.connection as unknown as { readyState: number }).readyState = 1;
});

afterEach(() => {
  mock.restoreAll();
  mock.reset();
  __resetIngestJobsForTest();
  release();
  resetStore();
  resetCollectionsForTests();
  __setParseAstSourceForTest();
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_ENV;
  }
  if (ORIGINAL_READY_STATE === undefined) {
    delete (mongoose.connection as { readyState?: number }).readyState;
  } else {
    (mongoose.connection as unknown as { readyState: number }).readyState =
      ORIGINAL_READY_STATE;
  }
  delete process.env.INGEST_TEST_GIT_PATHS;
});

test('ingest tracks supported AST file count', async () => {
  const repoMocks = mongoMocks;
  mockParseAstSource();
  const { root, cleanup } = await createTempRepo({
    'src/a.ts': 'export const a = 1;\n',
    'src/b.tsx': 'export const b = 2;\n',
    'src/c.js': 'export const c = 3;\n',
    'src/d.jsx': 'export const d = 4;\n',
    'docs/readme.md': 'Hello',
  });

  try {
    const runId = await startIngest(
      {
        path: root,
        name: 'repo',
        model: 'embed-model',
      },
      buildDeps(),
    );
    await waitForTerminal(runId);

    const coverageCall = repoMocks.astCoverageUpdateOne.mock.calls.at(-1) as
      | { arguments: [unknown, { $set: Record<string, unknown> }] }
      | undefined;
    if (!coverageCall) throw new Error('Expected coverage upsert');
    const coverage = coverageCall.arguments[1].$set as {
      supportedFileCount: number;
      skippedFileCount: number;
      failedFileCount: number;
    };
    assert.equal(coverage.supportedFileCount, 4);
    assert.equal(coverage.skippedFileCount, 1);
    assert.equal(coverage.failedFileCount, 0);
  } finally {
    await cleanup();
  }
});

test('ingest persists new AST edge types', async () => {
  const repoMocks = mongoMocks;
  mockParseAstSource(async (input: ParseAstSourceInput) => ({
    ...baseAstResult,
    edges: [
      {
        root: input.root,
        relPath: input.relPath,
        fileHash: input.fileHash,
        fromSymbolId: 'from-extends',
        toSymbolId: 'to-extends',
        type: 'EXTENDS',
      },
      {
        root: input.root,
        relPath: input.relPath,
        fileHash: input.fileHash,
        fromSymbolId: 'from-implements',
        toSymbolId: 'to-implements',
        type: 'IMPLEMENTS',
      },
      {
        root: input.root,
        relPath: input.relPath,
        fileHash: input.fileHash,
        fromSymbolId: 'from-ref',
        toSymbolId: 'to-ref',
        type: 'REFERENCES_TYPE',
      },
    ],
  }));
  const { root, cleanup } = await createTempRepo({
    'src/edges.ts': 'export class EdgeCase {}\n',
  });

  try {
    const runId = await startIngest(
      {
        path: root,
        name: 'repo',
        model: 'embed-model',
      },
      buildDeps(),
    );
    await waitForTerminal(runId);

    const bulkCall = repoMocks.astEdgesBulkWrite.mock.calls.at(-1) as
      | {
          arguments: [Array<{ updateOne: { filter: { type: string } } }>];
        }
      | undefined;
    if (!bulkCall) throw new Error('Expected edge upsert');
    const types = bulkCall.arguments[0].map(
      (operation) => operation.updateOne.filter.type,
    );
    assert.deepEqual(
      new Set(types),
      new Set(['EXTENDS', 'IMPLEMENTS', 'REFERENCES_TYPE']),
    );
  } finally {
    await cleanup();
  }
});

test('ingest logs unsupported-language skips', async () => {
  mockParseAstSource();
  const { root, cleanup } = await createTempRepo({
    'docs/readme.md': 'Hello',
    'src/script.py': 'print("hi")',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model' },
      buildDeps(),
    );
    await waitForTerminal(runId);

    const warnings = query({ level: ['warn'], text: 'unsupported language' });
    assert.ok(warnings.length > 0);
    const context = warnings[0]?.context as
      | { skippedFileCount?: number; root?: string }
      | undefined;
    assert.equal(context?.skippedFileCount, 2);
    assert.equal(context?.root, root);
  } finally {
    await cleanup();
  }
});

test('ingest increments failed count for parse failures', async () => {
  const repoMocks = mongoMocks;
  mockParseAstSource(async () => ({
    status: 'failed' as const,
    language: 'typescript' as const,
    error: 'parse error',
  }));
  const { root, cleanup } = await createTempRepo({
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': 'export const b = 2;\n',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model' },
      buildDeps(),
    );
    await waitForTerminal(runId);

    const coverageCall = repoMocks.astCoverageUpdateOne.mock.calls.at(-1) as
      | { arguments: [unknown, { $set: Record<string, unknown> }] }
      | undefined;
    if (!coverageCall) throw new Error('Expected coverage upsert');
    const coverage = coverageCall.arguments[1].$set as {
      failedFileCount: number;
    };
    assert.equal(coverage.failedFileCount, 2);
  } finally {
    await cleanup();
  }
});

test('ingest dry-run parses without writes', async () => {
  const repoMocks = mongoMocks;
  const parseMock = mockParseAstSource();
  const { root, cleanup } = await createTempRepo({
    'src/a.ts': 'export const a = 1;\n',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model', dryRun: true },
      buildDeps(),
    );
    await waitForTerminal(runId);

    assert.equal(parseMock.mock.calls.length, 1);
    assert.equal(repoMocks.astSymbolsBulkWrite.mock.calls.length, 0);
    assert.equal(repoMocks.astCoverageUpdateOne.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test('ingest cancellation stops AST writes', async () => {
  const repoMocks = mongoMocks;
  let releaseParse!: () => void;
  let signalParseStart!: () => void;
  const parseStart = new Promise<void>((resolve) => {
    signalParseStart = resolve;
  });
  const parseGate = new Promise<void>((resolve) => {
    releaseParse = resolve;
  });
  const parseMock = mockParseAstSource(async () => {
    signalParseStart();
    await parseGate;
    return baseAstResult;
  });
  const { root, cleanup } = await createTempRepo({
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': 'export const b = 2;\n',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model' },
      buildDeps(),
    );
    await parseStart;
    await cancelRun(runId);
    releaseParse();
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'cancelled');
    assert.equal(parseMock.mock.calls.length, 1);
    assert.equal(repoMocks.astSymbolsBulkWrite.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test('mongo disconnect skips AST writes with warning', async () => {
  const repoMocks = mongoMocks;
  mockParseAstSource();
  (mongoose.connection as unknown as { readyState: number }).readyState = 0;
  const { root, cleanup } = await createTempRepo({
    'src/a.ts': 'export const a = 1;\n',
  });

  try {
    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model' },
      buildDeps(),
    );
    await waitForTerminal(runId);

    const warnings = query({ level: ['warn'], text: 'MongoDB is unavailable' });
    assert.ok(warnings.length > 0);
    assert.equal(repoMocks.astSymbolsBulkWrite.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test('delta reembed deletes and upserts AST records', async () => {
  const repoMocks = mongoMocks;
  const parseMock = mockParseAstSource(async (input: ParseAstSourceInput) => ({
    ...baseAstResult,
    symbols: [
      {
        root: input.root,
        relPath: input.relPath,
        fileHash: input.fileHash,
        language: 'typescript',
        kind: 'Function',
        name: 'fn',
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
        symbolId: `${input.relPath}-fn`,
      },
    ],
  }));
  const { root, cleanup } = await createTempRepo({
    'src/added.ts': 'export const added = 1;\n',
    'src/changed.ts': 'export const changed = 2;\n',
  });

  try {
    const changedHash = await hashFile(path.join(root, 'src/changed.ts'));
    repoMocks.setIngestFileRows([
      { relPath: 'src/changed.ts', fileHash: `${changedHash}-old` },
      { relPath: 'src/deleted.ts', fileHash: 'deleted-hash' },
    ]);

    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model', operation: 'reembed' },
      buildDeps(),
    );
    await waitForTerminal(runId);

    assert.equal(parseMock.mock.calls.length, 2);
    const deleteCall = repoMocks.astSymbolsDeleteMany.mock.calls.at(-1) as
      | { arguments: [{ relPath?: { $in?: string[] } }] }
      | undefined;
    if (!deleteCall) throw new Error('Expected delete call');
    const relPaths = deleteCall.arguments[0].relPath?.$in ?? [];
    assert.deepEqual(
      new Set(relPaths),
      new Set(['src/changed.ts', 'src/deleted.ts']),
    );
    const upsertSymbols = repoMocks.astSymbolsBulkWrite.mock.calls.at(-1) as
      | {
          arguments: [
            Array<{ updateOne: { update: { $set: { relPath: string } } } }>,
          ];
        }
      | undefined;
    if (!upsertSymbols) throw new Error('Expected symbols upsert');
    const operations = upsertSymbols.arguments[0];
    const symbolRelPaths = operations.map(
      (op) => op.updateOne.update.$set.relPath,
    );
    assert.deepEqual(
      new Set(symbolRelPaths),
      new Set(['src/added.ts', 'src/changed.ts']),
    );
    const coverageCall = repoMocks.astCoverageUpdateOne.mock.calls.at(-1) as
      | { arguments: [unknown, { $set: Record<string, unknown> }] }
      | undefined;
    if (!coverageCall) throw new Error('Expected coverage upsert');
    const coverage = coverageCall.arguments[1].$set as {
      supportedFileCount: number;
      skippedFileCount: number;
    };
    assert.equal(coverage.supportedFileCount, 2);
    assert.equal(coverage.skippedFileCount, 0);
  } finally {
    await cleanup();
  }
});

test('delta reembed skips unchanged files', async () => {
  const repoMocks = mongoMocks;
  const parseMock = mockParseAstSource(async (input: ParseAstSourceInput) => ({
    ...baseAstResult,
    symbols: [
      {
        root: input.root,
        relPath: input.relPath,
        fileHash: input.fileHash,
        language: 'typescript',
        kind: 'Function',
        name: 'fn',
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
        symbolId: `${input.relPath}-fn`,
      },
    ],
  }));
  const { root, cleanup } = await createTempRepo({
    'src/unchanged.ts': 'export const unchanged = 1;\n',
    'src/changed.ts': 'export const changed = 2;\n',
  });

  try {
    const unchangedHash = await hashFile(path.join(root, 'src/unchanged.ts'));
    repoMocks.setIngestFileRows([
      { relPath: 'src/unchanged.ts', fileHash: unchangedHash },
      { relPath: 'src/changed.ts', fileHash: 'old-hash' },
    ]);

    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model', operation: 'reembed' },
      buildDeps(),
    );
    await waitForTerminal(runId);

    assert.equal(parseMock.mock.calls.length, 1);
    const parsedRelPaths = parseMock.mock.calls.map(
      (call) => call.arguments[0].relPath,
    );
    assert.deepEqual(parsedRelPaths, ['src/changed.ts']);
  } finally {
    await cleanup();
  }
});

test('delta reembed skips when no changes', async () => {
  const repoMocks = mongoMocks;
  const parseMock = mockParseAstSource();
  const { root, cleanup } = await createTempRepo({
    'src/unchanged.ts': 'export const unchanged = 1;\n',
  });

  try {
    const unchangedHash = await hashFile(path.join(root, 'src/unchanged.ts'));
    repoMocks.setIngestFileRows([
      { relPath: 'src/unchanged.ts', fileHash: unchangedHash },
    ]);

    const runId = await startIngest(
      { path: root, name: 'repo', model: 'embed-model', operation: 'reembed' },
      buildDeps(),
    );
    const status = await waitForTerminal(runId);

    assert.equal(status.state, 'skipped');
    assert.equal(parseMock.mock.calls.length, 0);
    assert.equal(repoMocks.astSymbolsBulkWrite.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});
