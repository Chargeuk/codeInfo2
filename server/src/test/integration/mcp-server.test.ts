import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  AstIndexRequiredError,
  validateAstCallGraph,
  validateAstFindDefinition,
  validateAstFindReferences,
  validateAstListSymbols,
  validateAstModuleImports,
} from '../../ast/toolService.js';
import { IngestRequiredError } from '../../ingest/chromaClient.js';
import {
  ValidationError,
  validateVectorSearch,
} from '../../lmstudio/toolService.js';
import { createMcpRouter } from '../../mcp/server.js';

const sampleRange = {
  start: { line: 1, column: 0 },
  end: { line: 1, column: 5 },
};

const sampleSymbol = {
  symbolId: 'symbol-1',
  root: '/data/repo-1',
  relPath: 'src/index.ts',
  fileHash: 'hash-1',
  language: 'typescript',
  kind: 'Function',
  name: 'hello',
  range: sampleRange,
};

const baseApp = (
  overrides: Partial<Parameters<typeof createMcpRouter>[0]> = {},
) => {
  const app = express();
  app.use(express.json());
  app.use(
    '/',
    createMcpRouter({
      listIngestedRepositories: async () => ({
        repos: [
          {
            id: 'repo-1',
            description: null,
            containerPath: '/data/repo-1',
            hostPath: '/host/repo-1',
            hostPathWarning: undefined,
            lastIngestAt: null,
            modelId: 'embed-model',
            counts: { files: 1, chunks: 2, embedded: 2 },
            lastError: null,
          },
        ],
        lockedModelId: 'embed-model',
      }),
      vectorSearch: async () => ({
        results: [
          {
            repo: 'repo-1',
            relPath: 'file.txt',
            containerPath: '/data/repo-1/file.txt',
            hostPath: '/host/repo-1/file.txt',
            hostPathWarning: undefined,
            score: 0.25,
            chunk: 'hello world',
            chunkId: 'chunk-1',
            modelId: 'embed-model',
            lineCount: 1,
          },
        ],
        modelId: 'embed-model',
        files: [],
      }),
      validateVectorSearch,
      astListSymbols: async () => ({ symbols: [sampleSymbol] }),
      validateAstListSymbols,
      astFindDefinition: async () => ({ symbol: sampleSymbol }),
      validateAstFindDefinition,
      astFindReferences: async () => ({
        references: [
          {
            relPath: 'src/index.ts',
            range: sampleRange,
            symbolId: 'symbol-1',
          },
        ],
      }),
      validateAstFindReferences,
      astCallGraph: async () => ({
        nodes: [sampleSymbol],
        edges: [
          {
            root: '/data/repo-1',
            relPath: 'src/index.ts',
            fileHash: 'hash-1',
            fromSymbolId: 'symbol-1',
            toSymbolId: 'symbol-2',
            type: 'CALLS',
          },
        ],
      }),
      validateAstCallGraph,
      astModuleImports: async () => ({
        modules: [
          {
            relPath: 'src/index.ts',
            imports: [{ source: './dep', names: ['dep'] }],
          },
        ],
      }),
      validateAstModuleImports,
      getRootsCollection: async () =>
        ({}) as unknown as import('chromadb').Collection,
      getVectorsCollection: async () =>
        ({}) as unknown as import('chromadb').Collection,
      getLockedModel: async () => 'embed-model',
      ...overrides,
    }),
  );
  return app;
};

test('initialize returns protocol and capabilities', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

  assert.equal(res.status, 200);
  assert.equal(res.body.jsonrpc, '2.0');
  assert.equal(res.body.id, 1);
  assert.equal(res.body.result.protocolVersion, '2024-11-05');
  assert.deepEqual(res.body.result.capabilities, {
    tools: { listChanged: false },
  });
});

test('tools/list returns MCP tool definitions', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

  assert.equal(res.status, 200);
  const tools = res.body.result.tools as { name: string }[];
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('ListIngestedRepositories'));
  assert.ok(names.includes('VectorSearch'));
  assert.ok(names.includes('AstListSymbols'));
  assert.ok(names.includes('AstFindDefinition'));
  assert.ok(names.includes('AstFindReferences'));
  assert.ok(names.includes('AstCallGraph'));
  assert.ok(names.includes('AstModuleImports'));
});

test('tools/call executes ListIngestedRepositories', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'ListIngestedRepositories', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.id, 3);
  const content = res.body.result.content[0];
  assert.equal(content.type, 'text');
  const parsed = JSON.parse(content.text as string);
  assert.equal(parsed.repos[0].id, 'repo-1');
});

test('tools/call validates VectorSearch arguments', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'VectorSearch', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'VALIDATION_FAILED');
  assert.ok(
    (res.body.error.data.details as string[]).includes('query is required'),
  );
});

test('tools/call executes AST tools', async () => {
  const app = baseApp();

  const listRes = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'AstListSymbols', arguments: { repository: 'repo-1' } },
    });

  assert.equal(listRes.status, 200);
  const listPayload = JSON.parse(listRes.body.result.content[0].text as string);
  assert.equal(listPayload.symbols[0].symbolId, 'symbol-1');

  const defRes = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'AstFindDefinition',
        arguments: { repository: 'repo-1', symbolId: 'symbol-1' },
      },
    });

  assert.equal(defRes.status, 200);
  const defPayload = JSON.parse(defRes.body.result.content[0].text as string);
  assert.equal(defPayload.symbol.symbolId, 'symbol-1');

  const refsRes = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'AstFindReferences',
        arguments: { repository: 'repo-1', name: 'hello' },
      },
    });

  assert.equal(refsRes.status, 200);
  const refsPayload = JSON.parse(refsRes.body.result.content[0].text as string);
  assert.equal(refsPayload.references.length, 1);

  const graphRes = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'AstCallGraph',
        arguments: { repository: 'repo-1', symbolId: 'symbol-1', depth: 2 },
      },
    });

  assert.equal(graphRes.status, 200);
  const graphPayload = JSON.parse(
    graphRes.body.result.content[0].text as string,
  );
  assert.equal(graphPayload.nodes.length, 1);
  assert.equal(graphPayload.edges.length, 1);

  const importsRes = await request(app)
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'AstModuleImports',
        arguments: { repository: 'repo-1' },
      },
    });

  assert.equal(importsRes.status, 200);
  const importsPayload = JSON.parse(
    importsRes.body.result.content[0].text as string,
  );
  assert.equal(importsPayload.modules.length, 1);
});

test('tools/call returns validation errors for AST tools', async () => {
  const missingRepo = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'AstListSymbols', arguments: {} },
    });

  assert.equal(missingRepo.status, 200);
  assert.equal(missingRepo.body.error.code, -32602);
  assert.equal(missingRepo.body.error.message, 'VALIDATION_FAILED');

  const missingSymbol = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: { name: 'AstCallGraph', arguments: { repository: 'repo-1' } },
    });

  assert.equal(missingSymbol.status, 200);
  assert.equal(missingSymbol.body.error.code, -32602);
  assert.equal(missingSymbol.body.error.message, 'VALIDATION_FAILED');
});

test('tools/call maps AST_INDEX_REQUIRED', async () => {
  const res = await request(
    baseApp({
      astListSymbols: async () => {
        throw new AstIndexRequiredError('repo-1');
      },
    }),
  )
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: { name: 'AstListSymbols', arguments: { repository: 'repo-1' } },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, 409);
  assert.equal(res.body.error.message, 'AST_INDEX_REQUIRED');
  assert.equal(res.body.error.data.repository, 'repo-1');
});

test('tools/call maps INGEST_REQUIRED', async () => {
  const res = await request(
    baseApp({
      astFindDefinition: async () => {
        throw new IngestRequiredError('No repos');
      },
    }),
  )
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        name: 'AstFindDefinition',
        arguments: { repository: 'repo-1', symbolId: 'symbol-1' },
      },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, 409);
  assert.equal(res.body.error.message, 'INGEST_REQUIRED');
});

test('unknown tool returns invalid params error', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'Nope', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'Unknown tool Nope');
});

test('method not found returns -32601', async () => {
  const res = await request(baseApp())
    .post('/mcp')
    .send({ jsonrpc: '2.0', id: 6, method: 'unknown' });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32601);
  assert.equal(res.body.error.message, 'Method not found');
});

test('invalid request shape returns -32600', async () => {
  const res = await request(baseApp()).post('/mcp').send({ wrong: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.id, undefined);
  assert.equal(res.body.error.code, -32600);
  assert.equal(res.body.error.message, 'Invalid Request');
});

test('tools/call surfaces internal errors', async () => {
  const res = await request(
    baseApp({
      vectorSearch: async () => {
        throw new Error('boom');
      },
      validateVectorSearch: () => ({ query: 'hi', limit: 5 }),
    }),
  )
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'VectorSearch', arguments: { query: 'hi' } },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32603);
  assert.equal(res.body.error.message, 'Internal error');
  assert.deepEqual(res.body.error.data, { message: 'Error: boom' });
});

test('tools/call propagates validation error instances', async () => {
  const res = await request(
    baseApp({
      validateVectorSearch: () => {
        throw new ValidationError(['bad']);
      },
    }),
  )
    .post('/mcp')
    .send({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'VectorSearch', arguments: {} },
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, -32602);
  assert.equal(res.body.error.message, 'VALIDATION_FAILED');
  assert.deepEqual(res.body.error.data, { details: ['bad'] });
});
