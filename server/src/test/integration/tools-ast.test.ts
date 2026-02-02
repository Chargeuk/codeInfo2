import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  AstIndexRequiredError,
  type AstCallGraphParams,
  type AstCallGraphResult,
  type AstFindDefinitionParams,
  type AstFindDefinitionResult,
  type AstFindReferencesResult,
  type AstListSymbolsParams,
  type AstListSymbolsResult,
  type AstModuleImportsParams,
  type AstModuleImportsResult,
  validateAstCallGraph,
  validateAstFindDefinition,
  validateAstFindReferences,
  validateAstListSymbols,
  validateAstModuleImports,
} from '../../ast/toolService.js';
import { IngestRequiredError } from '../../ingest/chromaClient.js';
import { RepoNotFoundError } from '../../lmstudio/toolService.js';
import { createToolsAstCallGraphRouter } from '../../routes/toolsAstCallGraph.js';
import { createToolsAstFindDefinitionRouter } from '../../routes/toolsAstFindDefinition.js';
import { createToolsAstFindReferencesRouter } from '../../routes/toolsAstFindReferences.js';
import { createToolsAstListSymbolsRouter } from '../../routes/toolsAstListSymbols.js';
import { createToolsAstModuleImportsRouter } from '../../routes/toolsAstModuleImports.js';

type AstDeps = {
  astListSymbols: (
    params: AstListSymbolsParams,
  ) => Promise<AstListSymbolsResult>;
  astFindDefinition: (
    params: AstFindDefinitionParams,
  ) => Promise<AstFindDefinitionResult>;
  astFindReferences: (
    params: AstFindDefinitionParams,
  ) => Promise<AstFindReferencesResult>;
  astCallGraph: (params: AstCallGraphParams) => Promise<AstCallGraphResult>;
  astModuleImports: (
    params: AstModuleImportsParams,
  ) => Promise<AstModuleImportsResult>;
};

function buildApp(overrides: Partial<AstDeps> = {}) {
  const deps: AstDeps = {
    astListSymbols: async (params) => {
      void params;
      return {
        symbols: [
          {
            symbolId: 'sym-1',
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
          },
        ],
      };
    },
    astFindDefinition: async (params) => {
      void params;
      return {
        symbol: {
          symbolId: 'sym-1',
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
        },
      };
    },
    astFindReferences: async (params) => {
      void params;
      return {
        references: [
          {
            relPath: 'a.ts',
            range: {
              start: { line: 2, column: 1 },
              end: { line: 2, column: 2 },
            },
            symbolId: 'sym-1',
          },
        ],
      };
    },
    astCallGraph: async (params) => {
      void params;
      return {
        nodes: [
          {
            symbolId: 'sym-1',
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
          },
        ],
        edges: [
          {
            root: '/root',
            relPath: 'a.ts',
            fileHash: 'hash',
            fromSymbolId: 'sym-1',
            toSymbolId: 'sym-2',
            type: 'CALLS',
          },
        ],
      };
    },
    astModuleImports: async (params) => {
      void params;
      return {
        modules: [
          {
            relPath: 'a.ts',
            imports: [{ source: 'lib', names: ['foo'] }],
          },
        ],
      };
    },
    ...overrides,
  };

  const app = express();
  app.use(express.json());
  app.use(
    createToolsAstListSymbolsRouter({
      astListSymbols: deps.astListSymbols,
      validateAstListSymbols,
    }),
  );
  app.use(
    createToolsAstFindDefinitionRouter({
      astFindDefinition: deps.astFindDefinition,
      validateAstFindDefinition,
    }),
  );
  app.use(
    createToolsAstFindReferencesRouter({
      astFindReferences: deps.astFindReferences,
      validateAstFindReferences,
    }),
  );
  app.use(
    createToolsAstCallGraphRouter({
      astCallGraph: deps.astCallGraph,
      validateAstCallGraph,
    }),
  );
  app.use(
    createToolsAstModuleImportsRouter({
      astModuleImports: deps.astModuleImports,
      validateAstModuleImports,
    }),
  );
  return app;
}

test('AST tool routes return contract payloads', async () => {
  const app = buildApp();

  const listRes = await request(app)
    .post('/tools/ast-list-symbols')
    .send({ repository: 'repo' });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.symbols.length, 1);

  const defRes = await request(app)
    .post('/tools/ast-find-definition')
    .send({ repository: 'repo', symbolId: 'sym-1' });
  assert.equal(defRes.status, 200);
  assert.equal(defRes.body.symbol?.symbolId, 'sym-1');

  const refsRes = await request(app)
    .post('/tools/ast-find-references')
    .send({ repository: 'repo', symbolId: 'sym-1' });
  assert.equal(refsRes.status, 200);
  assert.equal(refsRes.body.references.length, 1);

  const graphRes = await request(app)
    .post('/tools/ast-call-graph')
    .send({ repository: 'repo', symbolId: 'sym-1' });
  assert.equal(graphRes.status, 200);
  assert.equal(graphRes.body.nodes.length, 1);
  assert.equal(graphRes.body.edges.length, 1);

  const importsRes = await request(app)
    .post('/tools/ast-module-imports')
    .send({ repository: 'repo' });
  assert.equal(importsRes.status, 200);
  assert.equal(importsRes.body.modules.length, 1);
});

test('AST tool routes validate request payloads', async () => {
  const app = buildApp();

  const listRes = await request(app).post('/tools/ast-list-symbols').send({});
  assert.equal(listRes.status, 400);
  assert.equal(listRes.body.error, 'VALIDATION_FAILED');

  const defRes = await request(app).post('/tools/ast-find-definition').send({});
  assert.equal(defRes.status, 400);
  assert.equal(defRes.body.error, 'VALIDATION_FAILED');

  const refsRes = await request(app)
    .post('/tools/ast-find-references')
    .send({});
  assert.equal(refsRes.status, 400);
  assert.equal(refsRes.body.error, 'VALIDATION_FAILED');

  const graphRes = await request(app).post('/tools/ast-call-graph').send({});
  assert.equal(graphRes.status, 400);
  assert.equal(graphRes.body.error, 'VALIDATION_FAILED');

  const importsRes = await request(app)
    .post('/tools/ast-module-imports')
    .send({});
  assert.equal(importsRes.status, 400);
  assert.equal(importsRes.body.error, 'VALIDATION_FAILED');
});

test('AST tool routes map repo and ingest errors', async () => {
  const repoApp = buildApp({
    astListSymbols: async (params) => {
      void params;
      throw new RepoNotFoundError('repo');
    },
  });
  const repoRes = await request(repoApp)
    .post('/tools/ast-list-symbols')
    .send({ repository: 'repo' });
  assert.equal(repoRes.status, 404);
  assert.equal(repoRes.body.error, 'REPO_NOT_FOUND');

  const ingestApp = buildApp({
    astListSymbols: async (params) => {
      void params;
      throw new IngestRequiredError('Run ingest first');
    },
  });
  const ingestRes = await request(ingestApp)
    .post('/tools/ast-list-symbols')
    .send({ repository: 'repo' });
  assert.equal(ingestRes.status, 409);
  assert.equal(ingestRes.body.error, 'INGEST_REQUIRED');

  const coverageApp = buildApp({
    astListSymbols: async (params) => {
      void params;
      throw new AstIndexRequiredError('repo');
    },
  });
  const coverageRes = await request(coverageApp)
    .post('/tools/ast-list-symbols')
    .send({ repository: 'repo' });
  assert.equal(coverageRes.status, 409);
  assert.equal(coverageRes.body.error, 'AST_INDEX_REQUIRED');
  assert.equal(coverageRes.body.repository, 'repo');
});
