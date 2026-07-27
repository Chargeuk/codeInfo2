import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateAstCallGraph,
  validateAstFindDefinition,
  validateAstFindReferences,
  validateAstListSymbols,
  validateAstModuleImports,
} from '../../ast/toolService.js';
import { ValidationError } from '../../lmstudio/toolService.js';

test('AST tool validation requires repository + required fields', () => {
  assert.throws(() => validateAstListSymbols({}), ValidationError);
  assert.throws(() => validateAstFindDefinition({}), ValidationError);
  assert.throws(() => validateAstFindReferences({}), ValidationError);
  assert.throws(() => validateAstCallGraph({}), ValidationError);
  assert.throws(() => validateAstModuleImports({}), ValidationError);
});

test('AST tool validation enforces required identifier fields', () => {
  assert.throws(
    () => validateAstFindDefinition({ repository: 'repo' }),
    ValidationError,
  );
  assert.throws(
    () => validateAstFindReferences({ repository: 'repo' }),
    ValidationError,
  );
  assert.throws(
    () => validateAstCallGraph({ repository: 'repo' }),
    ValidationError,
  );
});

test('AST tool validation defaults and caps list limits', () => {
  const defaulted = validateAstListSymbols({ repository: 'repo' });
  assert.equal(defaulted.limit, 50);

  const capped = validateAstListSymbols({ repository: 'repo', limit: 999 });
  assert.equal(capped.limit, 200);
});

test('AST tool validation normalizes kinds casing', () => {
  const list = validateAstListSymbols({
    repository: 'repo',
    kinds: ['function', ' CLASS '],
  });
  assert.deepEqual(list.kinds, ['Function', 'Class']);

  const def = validateAstFindDefinition({
    repository: 'repo',
    name: 'Widget',
    kind: 'interface',
  });
  assert.equal(def.kind, 'Interface');
});

test('AST tool validation rejects unsupported kinds', () => {
  assert.throws(
    () => validateAstListSymbols({ repository: 'repo', kinds: ['mystery'] }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.details.some((detail) => detail.includes('Supported kinds')),
  );

  assert.throws(
    () =>
      validateAstFindDefinition({
        repository: 'repo',
        name: 'Widget',
        kind: 'unknown',
      }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.details.some((detail) => detail.includes('Supported kinds')),
  );
});
