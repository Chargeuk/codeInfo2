import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDeltaAstMode, type DeltaPlan } from '../../ingest/deltaPlan.js';

const astSupportedExtensions = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'cs',
  'rs',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'hxx',
  'h',
]);

const isAstSupported = (ext: string) => astSupportedExtensions.has(ext);

function createPlan(overrides: Partial<DeltaPlan>): DeltaPlan {
  return {
    unchanged: [],
    changed: [],
    added: [],
    deleted: [],
    ...overrides,
  };
}

test('delete-plus-add move within AST-supported files chooses full rebuild mode', () => {
  const decision = resolveDeltaAstMode({
    plan: createPlan({
      added: [
        {
          absPath: '/repo/src/new-name.ts',
          relPath: 'src/new-name.ts',
          fileHash: 'new',
          ext: 'ts',
        },
      ],
      deleted: [{ relPath: 'src/old-name.ts', fileHash: 'old' }],
    }),
    isAstSupported,
  });

  assert.deepEqual(decision, {
    mode: 'ast_full_rebuild',
    astRelevantDeltaCount: 2,
  });
});

test('move from AST-supported to unsupported still chooses full rebuild mode', () => {
  const decision = resolveDeltaAstMode({
    plan: createPlan({
      added: [
        {
          absPath: '/repo/docs/moved.md',
          relPath: 'docs/moved.md',
          fileHash: 'new',
          ext: 'md',
        },
      ],
      deleted: [{ relPath: 'src/moved.ts', fileHash: 'old' }],
    }),
    isAstSupported,
  });

  assert.deepEqual(decision, {
    mode: 'ast_full_rebuild',
    astRelevantDeltaCount: 1,
  });
});

test('move from unsupported to AST-supported still chooses full rebuild mode', () => {
  const decision = resolveDeltaAstMode({
    plan: createPlan({
      added: [
        {
          absPath: '/repo/src/moved.ts',
          relPath: 'src/moved.ts',
          fileHash: 'new',
          ext: 'ts',
        },
      ],
      deleted: [{ relPath: 'docs/moved.md', fileHash: 'old' }],
    }),
    isAstSupported,
  });

  assert.deepEqual(decision, {
    mode: 'ast_full_rebuild',
    astRelevantDeltaCount: 1,
  });
});

test('non-AST-only delta work chooses skip mode', () => {
  const decision = resolveDeltaAstMode({
    plan: createPlan({
      changed: [
        {
          absPath: '/repo/docs/guide.md',
          relPath: 'docs/guide.md',
          fileHash: 'changed',
          ext: 'md',
        },
      ],
      added: [
        {
          absPath: '/repo/notes/todo.txt',
          relPath: 'notes/todo.txt',
          fileHash: 'added',
          ext: 'txt',
        },
      ],
      deleted: [{ relPath: 'docs/old.md', fileHash: 'deleted' }],
    }),
    isAstSupported,
  });

  assert.deepEqual(decision, {
    mode: 'ast_skip_non_ast_delta',
    astRelevantDeltaCount: 0,
  });
});
