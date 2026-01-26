import assert from 'node:assert/strict';
import test from 'node:test';
import { createSymbolIdFactory, parseAstSource } from '../../ast/parser.js';
import { query, resetStore } from '../../logStore.js';

const tsSource = [
  'export class Greeter {',
  '  greet() {}',
  '}',
  'export function hello() {}',
  '',
].join('\n');

const tsxSource = [
  'export function Widget() {',
  '  return <div>Hello</div>;',
  '}',
  '',
].join('\n');

const callSource = [
  'function foo() {',
  '  bar();',
  '}',
  'function bar() {}',
  '',
].join('\n');

const importSource = [
  "import { bar } from './bar';",
  'export function foo() {}',
  '',
].join('\n');

test('ast parser extracts symbols for ts and tsx', async () => {
  const tsResult = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.ts',
    fileHash: 'hash-ts',
    text: tsSource,
  });

  assert.equal(tsResult.status, 'ok');
  if (tsResult.status === 'ok') {
    const kinds = tsResult.symbols.map((symbol) => symbol.kind);
    assert(kinds.includes('Module'));
    assert(kinds.includes('Class'));
    assert(kinds.includes('Function'));
    const greet = tsResult.symbols.find((symbol) => symbol.name === 'greet');
    assert(greet);
    assert.equal(greet.range.start.line, 2);
    assert.equal(greet.range.start.column, 3);
  }

  const tsxResult = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.tsx',
    fileHash: 'hash-tsx',
    text: tsxSource,
  });

  assert.equal(tsxResult.status, 'ok');
  if (tsxResult.status === 'ok') {
    const widget = tsxResult.symbols.find(
      (symbol) => symbol.name === 'Widget' && symbol.kind === 'Function',
    );
    assert(widget);
    assert.equal(widget.range.start.line, 1);
  }
});

test('ast parser returns stable symbol ids', async () => {
  const first = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.ts',
    fileHash: 'hash-ts',
    text: tsSource,
  });
  const second = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.ts',
    fileHash: 'hash-ts',
    text: tsSource,
  });

  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'ok');
  if (first.status === 'ok' && second.status === 'ok') {
    const firstIds = [...first.symbols.map((symbol) => symbol.symbolId)].sort();
    const secondIds = [
      ...second.symbols.map((symbol) => symbol.symbolId),
    ].sort();
    assert.deepEqual(firstIds, secondIds);
  }
});

test('ast parser disambiguates symbolId collisions', () => {
  const makeId = createSymbolIdFactory();
  const base = 'root|file|Function|same|1|1|1|1';
  const first = makeId(base);
  const second = makeId(base);
  const third = makeId(base);
  assert.notEqual(first, second);
  assert.equal(second, `${first}-2`);
  assert.equal(third, `${first}-3`);
});

test('ast parser emits CALLS edges', async () => {
  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/calls.ts',
    fileHash: 'hash-calls',
    text: callSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const foo = result.symbols.find((symbol) => symbol.name === 'foo');
    const bar = result.symbols.find((symbol) => symbol.name === 'bar');
    assert(foo && bar);
    const callEdge = result.edges.find(
      (edge) =>
        edge.type === 'CALLS' &&
        edge.fromSymbolId === foo.symbolId &&
        edge.toSymbolId === bar.symbolId,
    );
    assert(callEdge);
  }
});

test('ast parser emits reference ranges for call sites', async () => {
  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/calls.ts',
    fileHash: 'hash-calls',
    text: callSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const ref = result.references.find(
      (reference) => reference.name === 'bar' && reference.kind === 'call',
    );
    assert(ref);
    assert.equal(ref.range.start.line, 2);
    assert.equal(ref.range.start.column, 3);
  }
});

test('ast parser emits IMPORTS and EXPORTS edges', async () => {
  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/imports.ts',
    fileHash: 'hash-imports',
    text: importSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const moduleSymbol = result.symbols.find(
      (symbol) => symbol.kind === 'Module' && symbol.name === 'src/imports.ts',
    );
    const importSymbol = result.symbols.find(
      (symbol) => symbol.kind === 'Module' && symbol.name === './bar',
    );
    const exportSymbol = result.symbols.find(
      (symbol) => symbol.kind === 'Function' && symbol.name === 'foo',
    );
    assert(moduleSymbol && importSymbol && exportSymbol);
    const importEdge = result.edges.find(
      (edge) =>
        edge.type === 'IMPORTS' &&
        edge.fromSymbolId === moduleSymbol.symbolId &&
        edge.toSymbolId === importSymbol.symbolId,
    );
    const exportEdge = result.edges.find(
      (edge) =>
        edge.type === 'EXPORTS' &&
        edge.fromSymbolId === moduleSymbol.symbolId &&
        edge.toSymbolId === exportSymbol.symbolId,
    );
    assert(importEdge);
    assert(exportEdge);
  }
});

test('ast parser maps module imports', async () => {
  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/imports.ts',
    fileHash: 'hash-imports',
    text: importSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.imports.length, 1);
    const entry = result.imports[0].imports[0];
    assert.equal(entry.source, './bar');
    assert(entry.names.includes('bar'));
  }
});

test('ast parser returns failed for unsupported extensions', async () => {
  const result = await parseAstSource({
    root: '/repo',
    relPath: 'README.md',
    fileHash: 'hash-md',
    text: '# hello',
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /Unsupported extension/);
});

test('ast parser returns failed when query files are missing', async () => {
  const result = await parseAstSource(
    {
      root: '/repo',
      relPath: 'src/sample.ts',
      fileHash: 'hash-ts',
      text: tsSource,
    },
    { queryBundleOverride: null },
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /Missing Tree-sitter query files/);
});

test('ast parser returns failed for error trees', async () => {
  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/bad.ts',
    fileHash: 'hash-bad',
    text: 'function {',
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /parse error/i);
});

test('ast parser logs grammar load failures once', async () => {
  resetStore();
  const resultOne = await parseAstSource(
    {
      root: '/repo',
      relPath: 'src/sample.ts',
      fileHash: 'hash-ts',
      text: tsSource,
    },
    { parserLanguageOverride: null },
  );
  const resultTwo = await parseAstSource(
    {
      root: '/repo',
      relPath: 'src/sample.ts',
      fileHash: 'hash-ts',
      text: tsSource,
    },
    { parserLanguageOverride: null },
  );

  assert.equal(resultOne.status, 'failed');
  assert.equal(resultTwo.status, 'failed');
  const entries = query({
    text: 'DEV-0000032:T4:ast-parser-grammar-load-failed',
  });
  assert.equal(entries.length, 1);
});
