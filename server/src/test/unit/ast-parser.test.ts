import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import TreeSitter from 'tree-sitter';
import csharpLanguage from 'tree-sitter-c-sharp';
import cppLanguage from 'tree-sitter-cpp';
import pythonLanguage from 'tree-sitter-python';
import rustLanguage from 'tree-sitter-rust';
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

const heritageSource = [
  'interface Base {}',
  'interface Face {}',
  'class Child extends Base implements Face {',
  '  method(arg: Base): Face {',
  '    return {} as Face;',
  '  }',
  '}',
  '',
].join('\n');

const pythonSource = [
  'def greet():',
  '  name = "hi"',
  '  print(name)',
  '',
].join('\n');

const csharpSource = [
  'public class Greeter {',
  '  void Greet() {',
  '    var name = "hi";',
  '    System.Console.WriteLine(name);',
  '  }',
  '}',
  '',
].join('\n');

const rustSource = [
  'fn greet() {',
  '  let name = "hi";',
  '  println!("{}", name);',
  '}',
  '',
].join('\n');

const cppSource = [
  'int greet() {',
  '  int name = 0;',
  '  return name;',
  '}',
  '',
].join('\n');

const Parser = TreeSitter as unknown as {
  new (): {
    setLanguage: (language: unknown) => void;
    parse: (text: string) => { rootNode: unknown };
  };
  Query: new (
    language: unknown,
    source: string,
  ) => {
    matches: (node: unknown) => Array<{ captures: Array<{ name: string }> }>;
  };
};

const getLocalCaptures = async ({
  language,
  parserLanguage,
  source,
}: {
  language: 'python' | 'c_sharp' | 'rust' | 'cpp';
  parserLanguage: unknown;
  source: string;
}) => {
  const queryPath = path.resolve(
    'src',
    'ast',
    'queries',
    language,
    'locals.scm',
  );
  const localsQuery = await fs.readFile(queryPath, 'utf8');
  const parser = new Parser();
  parser.setLanguage(parserLanguage);
  const tree = parser.parse(source);
  const query = new Parser.Query(parserLanguage, localsQuery);
  const matches = query.matches(tree.rootNode);
  return matches.flatMap((match) =>
    match.captures.map((capture) => capture.name),
  );
};

const assertLocalCaptures = (captures: string[]) => {
  assert(captures.includes('local.definition'));
  assert(captures.includes('local.reference'));
};

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

test('ast parser captures locals for python', async () => {
  const captures = await getLocalCaptures({
    language: 'python',
    parserLanguage: pythonLanguage,
    source: pythonSource,
  });
  assertLocalCaptures(captures);

  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.py',
    fileHash: 'hash-py',
    text: pythonSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.language, 'python');
    const ref = result.references.find(
      (reference) => reference.kind === 'local' && reference.name === 'name',
    );
    assert(ref);
  }
});

test('ast parser captures locals for c_sharp', async () => {
  const captures = await getLocalCaptures({
    language: 'c_sharp',
    parserLanguage: csharpLanguage,
    source: csharpSource,
  });
  assertLocalCaptures(captures);

  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.cs',
    fileHash: 'hash-cs',
    text: csharpSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.language, 'c_sharp');
    const ref = result.references.find(
      (reference) => reference.kind === 'local' && reference.name === 'name',
    );
    assert(ref);
  }
});

test('ast parser captures locals for rust', async () => {
  const captures = await getLocalCaptures({
    language: 'rust',
    parserLanguage: rustLanguage,
    source: rustSource,
  });
  assertLocalCaptures(captures);

  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.rs',
    fileHash: 'hash-rs',
    text: rustSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.language, 'rust');
    const ref = result.references.find(
      (reference) => reference.kind === 'local' && reference.name === 'name',
    );
    assert(ref);
  }
});

test('ast parser captures locals for cpp', async () => {
  const captures = await getLocalCaptures({
    language: 'cpp',
    parserLanguage: cppLanguage,
    source: cppSource,
  });
  assertLocalCaptures(captures);

  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/sample.h',
    fileHash: 'hash-cpp',
    text: cppSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.language, 'cpp');
    const ref = result.references.find(
      (reference) => reference.kind === 'local' && reference.name === 'name',
    );
    assert(ref);
  }
});

test('ast parser returns failed for missing queries on python', async () => {
  const result = await parseAstSource(
    {
      root: '/repo',
      relPath: 'src/sample.py',
      fileHash: 'hash-missing-py',
      text: pythonSource,
    },
    { queryBundleOverride: null },
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /Missing Tree-sitter query files/);
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
  resetStore();
  const makeId = createSymbolIdFactory();
  const base = 'root|file|Function|same|1|1|1|1';
  const first = makeId(base);
  const second = makeId(base);
  const third = makeId(base);
  assert.notEqual(first, second);
  assert.equal(second, `${first}-2`);
  assert.equal(third, `${first}-3`);
  const entries = query({ text: 'DEV-0000032:T13:ast-symbolid-collision' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].context?.base, base);
  assert.equal(entries[0].context?.suffix, 2);
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

test('ast parser emits EXTENDS/IMPLEMENTS and REFERENCES_TYPE edges', async () => {
  const result = await parseAstSource({
    root: '/repo',
    relPath: 'src/heritage.ts',
    fileHash: 'hash-heritage',
    text: heritageSource,
  });

  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    const base = result.symbols.find((symbol) => symbol.name === 'Base');
    const face = result.symbols.find((symbol) => symbol.name === 'Face');
    const child = result.symbols.find((symbol) => symbol.name === 'Child');
    assert(base && face && child);
    const extendsEdge = result.edges.find(
      (edge) =>
        edge.type === 'EXTENDS' &&
        edge.fromSymbolId === child.symbolId &&
        edge.toSymbolId === base.symbolId,
    );
    const implementsEdge = result.edges.find(
      (edge) =>
        edge.type === 'IMPLEMENTS' &&
        edge.fromSymbolId === child.symbolId &&
        edge.toSymbolId === face.symbolId,
    );
    const referenceEdge = result.edges.find(
      (edge) =>
        edge.type === 'REFERENCES_TYPE' && edge.toSymbolId === base.symbolId,
    );
    assert(extendsEdge);
    assert(implementsEdge);
    assert(referenceEdge);
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

test('ast parser returns failed for missing grammar binding on rust', async () => {
  const result = await parseAstSource(
    {
      root: '/repo',
      relPath: 'src/sample.rs',
      fileHash: 'hash-missing-rs',
      text: rustSource,
    },
    { parserLanguageOverride: null },
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /Tree-sitter grammar unavailable/);
});
