import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AstIndexRequiredError,
  astCallGraph,
  astFindDefinition,
  astFindReferences,
  astListSymbols,
  astModuleImports,
} from '../../ast/toolService.js';
import { IngestRequiredError } from '../../ingest/chromaClient.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import { RepoNotFoundError } from '../../lmstudio/toolService.js';

type Query = Record<string, unknown>;

const buildFindChain = <T>(rows: T[]) => ({
  limit: (value: number) => buildFindChain(rows.slice(0, value)),
  sort: () => buildFindChain(rows),
  lean: () => ({
    exec: async () => rows,
  }),
});

const buildFindOneChain = <T>(row: T | null) => ({
  lean: () => ({
    exec: async () => row,
  }),
});

const matchesQuery = (row: Record<string, unknown>, query: Query) =>
  Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) {
      const list = (value as { $in?: unknown[] }).$in ?? [];
      return list.includes(row[key]);
    }
    return row[key] === value;
  });

const buildModel = <T extends Record<string, unknown>>(
  rows: T[],
  onQuery?: (query: Query) => void,
) => ({
  find: (query: Query) => {
    onQuery?.(query);
    return buildFindChain(rows.filter((row) => matchesQuery(row, query)));
  },
  findOne: (query: Query) => {
    onQuery?.(query);
    const match = rows.find((row) => matchesQuery(row, query)) ?? null;
    return buildFindOneChain(match as T | null);
  },
});

const buildCoverageModel = (
  rows: Array<{ root: string }>,
  onQuery?: (query: Query) => void,
) => ({
  findOne: (query: Query) => {
    onQuery?.(query);
    const match = rows.find((row) => matchesQuery(row as Query, query)) ?? null;
    return buildFindOneChain(match);
  },
});

const buildRepos = (repos: Partial<RepoEntry>[]): RepoEntry[] =>
  repos.map((repo, index) => ({
    id: repo.id ?? `repo-${index}`,
    description: repo.description ?? null,
    containerPath: repo.containerPath ?? `/container/${index}`,
    hostPath: repo.hostPath ?? `/host/${index}`,
    lastIngestAt: repo.lastIngestAt ?? null,
    modelId: repo.modelId ?? 'model',
    counts: repo.counts ?? { files: 0, chunks: 0, embedded: 0 },
    lastError: repo.lastError ?? null,
    ...(repo.hostPathWarning ? { hostPathWarning: repo.hostPathWarning } : {}),
  }));

test('tool service returns INGEST_REQUIRED when no repos exist', async () => {
  await assert.rejects(
    () =>
      astListSymbols(
        { repository: 'repo' },
        {
          listIngestedRepositories: async () => ({
            repos: [],
            lockedModelId: null,
          }),
          astCoverageModel: buildCoverageModel([]),
          astSymbolModel: buildModel([]),
          astEdgeModel: buildModel([]),
          astReferenceModel: buildModel([]),
          astModuleImportModel: buildModel([]),
        },
      ),
    (error: unknown) => error instanceof IngestRequiredError,
  );
});

test('tool service errors when repo id is missing', async () => {
  await assert.rejects(
    () =>
      astListSymbols(
        { repository: 'missing' },
        {
          listIngestedRepositories: async () => ({
            repos: buildRepos([{ id: 'repo' }]),
            lockedModelId: null,
          }),
          astCoverageModel: buildCoverageModel([{ root: '/container/0' }]),
          astSymbolModel: buildModel([]),
          astEdgeModel: buildModel([]),
          astReferenceModel: buildModel([]),
          astModuleImportModel: buildModel([]),
        },
      ),
    (error: unknown) => error instanceof RepoNotFoundError,
  );
});

test('tool service errors when coverage is missing', async () => {
  await assert.rejects(
    () =>
      astListSymbols(
        { repository: 'repo' },
        {
          listIngestedRepositories: async () => ({
            repos: buildRepos([{ id: 'repo', containerPath: '/root' }]),
            lockedModelId: null,
          }),
          astCoverageModel: buildCoverageModel([]),
          astSymbolModel: buildModel([]),
          astEdgeModel: buildModel([]),
          astReferenceModel: buildModel([]),
          astModuleImportModel: buildModel([]),
        },
      ),
    (error: unknown) => error instanceof AstIndexRequiredError,
  );
});

test('tool service selects newest repo root and uses containerPath', async () => {
  let lastSymbolRoot = '';
  let lastCoverageRoot = '';
  const repos = buildRepos([
    {
      id: 'Repo',
      containerPath: '/container/old',
      hostPath: '/host/old',
      lastIngestAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'REPO',
      containerPath: '/container/new',
      hostPath: '/host/new',
      lastIngestAt: '2025-02-01T00:00:00.000Z',
    },
  ]);

  const result = await astListSymbols(
    { repository: 'RePo', limit: 1 },
    {
      listIngestedRepositories: async () => ({ repos, lockedModelId: null }),
      astCoverageModel: buildCoverageModel(
        [{ root: '/container/new' }],
        (q) => {
          lastCoverageRoot = q.root as string;
        },
      ),
      astSymbolModel: buildModel(
        [
          {
            root: '/container/new',
            relPath: 'a.ts',
            fileHash: 'hash',
            language: 'typescript',
            kind: 'Function',
            name: 'fn',
            range: {
              start: { line: 1, column: 1 },
              end: { line: 1, column: 2 },
            },
            symbolId: 'sym-1',
          },
        ],
        (q) => {
          lastSymbolRoot = q.root as string;
        },
      ),
      astEdgeModel: buildModel([]),
      astReferenceModel: buildModel([]),
      astModuleImportModel: buildModel([]),
    },
  );

  assert.equal(lastCoverageRoot, '/container/new');
  assert.equal(lastSymbolRoot, '/container/new');
  assert.equal(result.symbols.length, 1);
});

test('tool service lists symbols with kinds filter', async () => {
  const symbols = [
    {
      root: '/root',
      relPath: 'a.ts',
      fileHash: 'hash-a',
      language: 'typescript',
      kind: 'Function',
      name: 'fn',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 },
      },
      symbolId: 'sym-a',
    },
    {
      root: '/root',
      relPath: 'b.ts',
      fileHash: 'hash-b',
      language: 'typescript',
      kind: 'Class',
      name: 'Cls',
      range: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 2 },
      },
      symbolId: 'sym-b',
    },
  ];

  const result = await astListSymbols(
    { repository: 'repo', kinds: ['function'], limit: 50 },
    {
      listIngestedRepositories: async () => ({
        repos: buildRepos([{ id: 'repo', containerPath: '/root' }]),
        lockedModelId: null,
      }),
      astCoverageModel: buildCoverageModel([{ root: '/root' }]),
      astSymbolModel: buildModel(symbols),
      astEdgeModel: buildModel([]),
      astReferenceModel: buildModel([]),
      astModuleImportModel: buildModel([]),
    },
  );

  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0]?.kind, 'Function');
});

test('tool service finds definition by symbolId', async () => {
  const result = await astFindDefinition(
    { repository: 'repo', symbolId: 'sym-a' },
    {
      listIngestedRepositories: async () => ({
        repos: buildRepos([{ id: 'repo', containerPath: '/root' }]),
        lockedModelId: null,
      }),
      astCoverageModel: buildCoverageModel([{ root: '/root' }]),
      astSymbolModel: buildModel([
        {
          root: '/root',
          relPath: 'a.ts',
          fileHash: 'hash',
          language: 'typescript',
          kind: 'Function',
          name: 'fn',
          range: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 2 },
          },
          symbolId: 'sym-a',
        },
      ]),
      astEdgeModel: buildModel([]),
      astReferenceModel: buildModel([]),
      astModuleImportModel: buildModel([]),
    },
  );

  assert.equal(result.symbol?.symbolId, 'sym-a');
});

test('tool service returns references by symbolId', async () => {
  const result = await astFindReferences(
    { repository: 'repo', symbolId: 'sym-a' },
    {
      listIngestedRepositories: async () => ({
        repos: buildRepos([{ id: 'repo', containerPath: '/root' }]),
        lockedModelId: null,
      }),
      astCoverageModel: buildCoverageModel([{ root: '/root' }]),
      astSymbolModel: buildModel([]),
      astEdgeModel: buildModel([]),
      astReferenceModel: buildModel([
        {
          root: '/root',
          relPath: 'a.ts',
          fileHash: 'hash',
          symbolId: 'sym-a',
          name: 'fn',
          kind: 'Function',
          range: {
            start: { line: 3, column: 1 },
            end: { line: 3, column: 2 },
          },
        },
      ]),
      astModuleImportModel: buildModel([]),
    },
  );

  assert.equal(result.references.length, 1);
  assert.equal(result.references[0]?.symbolId, 'sym-a');
});

test('tool service call graph respects depth', async () => {
  const edges = [
    {
      root: '/root',
      relPath: 'a.ts',
      fileHash: 'hash',
      fromSymbolId: 'A',
      toSymbolId: 'B',
      type: 'CALLS',
    },
    {
      root: '/root',
      relPath: 'b.ts',
      fileHash: 'hash',
      fromSymbolId: 'B',
      toSymbolId: 'C',
      type: 'CALLS',
    },
    {
      root: '/root',
      relPath: 'c.ts',
      fileHash: 'hash',
      fromSymbolId: 'C',
      toSymbolId: 'D',
      type: 'CALLS',
    },
  ];
  const symbols = ['A', 'B', 'C', 'D'].map((id, index) => ({
    root: '/root',
    relPath: `file-${index}.ts`,
    fileHash: 'hash',
    language: 'typescript',
    kind: 'Function',
    name: id,
    range: {
      start: { line: 1, column: 1 },
      end: { line: 1, column: 2 },
    },
    symbolId: id,
  }));

  const result = await astCallGraph(
    { repository: 'repo', symbolId: 'A', depth: 2 },
    {
      listIngestedRepositories: async () => ({
        repos: buildRepos([{ id: 'repo', containerPath: '/root' }]),
        lockedModelId: null,
      }),
      astCoverageModel: buildCoverageModel([{ root: '/root' }]),
      astSymbolModel: buildModel(symbols),
      astEdgeModel: buildModel(edges),
      astReferenceModel: buildModel([]),
      astModuleImportModel: buildModel([]),
    },
  );

  assert.equal(result.edges.length, 2);
  assert.ok(result.nodes.some((node) => node.symbolId === 'A'));
  assert.ok(result.nodes.some((node) => node.symbolId === 'B'));
  assert.ok(result.nodes.some((node) => node.symbolId === 'C'));
  assert.ok(!result.nodes.some((node) => node.symbolId === 'D'));
});

test('tool service module imports mapping preserves shape', async () => {
  const modules = await astModuleImports(
    { repository: 'repo' },
    {
      listIngestedRepositories: async () => ({
        repos: buildRepos([{ id: 'repo', containerPath: '/root' }]),
        lockedModelId: null,
      }),
      astCoverageModel: buildCoverageModel([{ root: '/root' }]),
      astSymbolModel: buildModel([]),
      astEdgeModel: buildModel([]),
      astReferenceModel: buildModel([]),
      astModuleImportModel: buildModel([
        {
          root: '/root',
          relPath: 'a.ts',
          fileHash: 'hash',
          imports: [{ source: 'lib', names: ['foo', 'bar'] }],
        },
      ]),
    },
  );

  assert.equal(modules.modules.length, 1);
  assert.equal(modules.modules[0]?.relPath, 'a.ts');
  assert.deepEqual(modules.modules[0]?.imports, [
    { source: 'lib', names: ['foo', 'bar'] },
  ]);
});

test('tool service reference fallback uses name + kind', async () => {
  const refs = await astFindReferences(
    { repository: 'repo', name: 'Widget', kind: 'Class' },
    {
      listIngestedRepositories: async () => ({
        repos: buildRepos([{ id: 'repo', containerPath: '/root' }]),
        lockedModelId: null,
      }),
      astCoverageModel: buildCoverageModel([{ root: '/root' }]),
      astSymbolModel: buildModel([]),
      astEdgeModel: buildModel([]),
      astReferenceModel: buildModel([
        {
          root: '/root',
          relPath: 'b.ts',
          fileHash: 'hash',
          symbolId: undefined,
          name: 'Widget',
          kind: 'Class',
          range: {
            start: { line: 4, column: 1 },
            end: { line: 4, column: 2 },
          },
        },
      ]),
      astModuleImportModel: buildModel([]),
    },
  );

  assert.equal(refs.references.length, 1);
  assert.equal(refs.references[0]?.relPath, 'b.ts');
});
