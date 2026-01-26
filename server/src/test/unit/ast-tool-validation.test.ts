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
