import crypto from 'crypto';
import fs from 'fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'path';
import TreeSitter from 'tree-sitter';
import csharpLanguage from 'tree-sitter-c-sharp';
import cppLanguage from 'tree-sitter-cpp';
import javascriptLanguage from 'tree-sitter-javascript';
import pythonLanguage from 'tree-sitter-python';
import rustLanguage from 'tree-sitter-rust';
import typescriptLanguage from 'tree-sitter-typescript';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import type {
  AstEdgeRecord,
  AstModuleImportRecord,
  AstReferenceRecord,
  AstSymbolRecord,
} from '../mongo/repo.js';
import type {
  AstLanguage,
  AstParseResult,
  AstSymbolKind,
  ParseAstSourceInput,
} from './types.js';

type Position = { row: number; column: number };

type SyntaxNode = {
  type: string;
  text: string;
  startPosition: Position;
  endPosition: Position;
  hasError?: boolean;
  parent: SyntaxNode | null;
  childForFieldName: (name: string) => SyntaxNode | null;
  descendantsOfType: (types: string | string[]) => SyntaxNode[];
};

type Tree = { rootNode: SyntaxNode };

type QueryCapture = { name: string; node: SyntaxNode };

type QueryMatch = { captures: QueryCapture[] };

type ParserInstance = {
  setLanguage: (language: unknown) => void;
  parse: (text: string) => Tree;
};

type ParserModule = {
  new (): ParserInstance;
  Query: new (
    language: unknown,
    source: string,
  ) => {
    matches: (node: SyntaxNode) => QueryMatch[];
  };
};

const Parser = TreeSitter as unknown as ParserModule;
const require = createRequire(import.meta.url);
const jsPackageRoot = path.dirname(
  require.resolve('tree-sitter-javascript/package.json'),
);
const tsPackageRoot = path.dirname(
  require.resolve('tree-sitter-typescript/package.json'),
);
const astDirectory = path.dirname(fileURLToPath(import.meta.url));
const astRoot = path.resolve(astDirectory, '..');
const serverRoot = path.resolve(astRoot, '..');
const queriesRoot =
  path.basename(astRoot) === 'dist'
    ? path.resolve(serverRoot, 'src', 'ast', 'queries')
    : path.resolve(astRoot, 'ast', 'queries');
const csharpPackageRoot = path.dirname(
  require.resolve('tree-sitter-c-sharp/package.json'),
);
const cppPackageRoot = path.dirname(
  require.resolve('tree-sitter-cpp/package.json'),
);
const pythonPackageRoot = path.dirname(
  require.resolve('tree-sitter-python/package.json'),
);
const rustPackageRoot = path.dirname(
  require.resolve('tree-sitter-rust/package.json'),
);
const astExtensionList = [
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'cs',
  'rs',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'hxx',
  'h',
];
const astLanguageList: AstLanguage[] = [
  'javascript',
  'typescript',
  'tsx',
  'python',
  'c_sharp',
  'rust',
  'cpp',
];

const definitionKindMap: Record<string, AstSymbolKind> = {
  'definition.class': 'Class',
  'definition.function': 'Function',
  'definition.method': 'Method',
  'definition.interface': 'Interface',
  'definition.type': 'TypeAlias',
  'definition.enum': 'Enum',
  'definition.property': 'Property',
  'definition.constant': 'Property',
  'definition.module': 'Module',
};

const referenceKindMap: Record<string, string> = {
  'reference.call': 'call',
  'reference.class': 'class',
  'reference.type': 'type',
  'local.reference': 'local',
};

let missingQueriesLogged = false;
let grammarLoadFailureLogged = false;
const queriesLoadedLogged = new Set<AstLanguage>();
let extensionMapLogged = false;
const grammarRegisteredLogged = new Set<AstLanguage>();
const localsQueryLoadedLogged = new Set<AstLanguage>();

type QueryBundle = { tags: string; locals: string };

type ParseAstSourceOptions = {
  queryBundleOverride?: QueryBundle | null;
  parserLanguageOverride?: unknown;
};

const queryCache = new Map<string, QueryBundle>();

function toRange(node: SyntaxNode) {
  return {
    start: {
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
    },
    end: {
      line: node.endPosition.row + 1,
      column: node.endPosition.column + 1,
    },
  };
}

function buildErrorDetails(node: SyntaxNode) {
  const rawSnippet = node.text ?? '';
  const normalizedSnippet = rawSnippet.replace(/\s+/g, ' ').trim();
  const snippet =
    normalizedSnippet.length > 160
      ? `${normalizedSnippet.slice(0, 157)}...`
      : normalizedSnippet;
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
    snippet,
    nodeType: node.type,
  };
}

function normalizeLanguage(ext: string): AstLanguage | null {
  const normalized = ext.toLowerCase();
  if (normalized === 'js' || normalized === 'jsx') return 'javascript';
  if (normalized === 'ts') return 'typescript';
  if (normalized === 'tsx') return 'tsx';
  if (normalized === 'py') return 'python';
  if (normalized === 'cs') return 'c_sharp';
  if (normalized === 'rs') return 'rust';
  if (
    normalized === 'cc' ||
    normalized === 'cpp' ||
    normalized === 'cxx' ||
    normalized === 'hpp' ||
    normalized === 'hxx' ||
    normalized === 'h'
  ) {
    return 'cpp';
  }
  return null;
}

function logAstExtensionMap() {
  if (extensionMapLogged) return;
  extensionMapLogged = true;
  const timestamp = new Date().toISOString();
  append({
    level: 'info',
    message: 'DEV-0000033:T1:ast-extension-map',
    timestamp,
    source: 'server',
    context: {
      extensions: astExtensionList,
      languages: astLanguageList,
    },
  });
  baseLogger.info(
    {
      event: 'DEV-0000033:T1:ast-extension-map',
      extensions: astExtensionList,
      languages: astLanguageList,
    },
    'AST extension map loaded',
  );
}

function sanitizeQuery(source: string) {
  return source
    .split('\n')
    .filter(
      (line) =>
        !line.includes('#strip!') && !line.includes('#select-adjacent!'),
    )
    .join('\n');
}

async function loadQueryFile(...segments: string[]) {
  const fullPath = path.join(...segments);
  try {
    return await fs.readFile(fullPath, 'utf8');
  } catch {
    return null;
  }
}

async function loadQueries(language: AstLanguage): Promise<QueryBundle | null> {
  if (queryCache.has(language)) return queryCache.get(language) ?? null;

  const jsTags = await loadQueryFile(jsPackageRoot, 'queries', 'tags.scm');
  const jsLocals = await loadQueryFile(jsPackageRoot, 'queries', 'locals.scm');

  if (language === 'javascript') {
    if (!jsTags || !jsLocals) return null;
    const bundle = {
      tags: sanitizeQuery(jsTags),
      locals: sanitizeQuery(jsLocals),
    };
    queryCache.set(language, bundle);
    if (!queriesLoadedLogged.has(language)) {
      queriesLoadedLogged.add(language);
      const timestamp = new Date().toISOString();
      append({
        level: 'info',
        message: 'DEV-0000032:T4:ast-parser-queries-loaded',
        timestamp,
        source: 'server',
        context: { language },
      });
      baseLogger.info(
        { event: 'DEV-0000032:T4:ast-parser-queries-loaded', language },
        'AST parser queries loaded',
      );
    }
    return bundle;
  }

  const tsTags = await loadQueryFile(tsPackageRoot, 'queries', 'tags.scm');
  const tsLocals = await loadQueryFile(tsPackageRoot, 'queries', 'locals.scm');

  if (language === 'typescript' || language === 'tsx') {
    if (!jsTags || !jsLocals || !tsTags || !tsLocals) return null;

    const bundle = {
      tags: [sanitizeQuery(tsTags), sanitizeQuery(jsTags)].join('\n'),
      locals: [sanitizeQuery(tsLocals), sanitizeQuery(jsLocals)].join('\n'),
    };
    queryCache.set(language, bundle);
    if (!queriesLoadedLogged.has(language)) {
      queriesLoadedLogged.add(language);
      const timestamp = new Date().toISOString();
      append({
        level: 'info',
        message: 'DEV-0000032:T4:ast-parser-queries-loaded',
        timestamp,
        source: 'server',
        context: { language },
      });
      baseLogger.info(
        { event: 'DEV-0000032:T4:ast-parser-queries-loaded', language },
        'AST parser queries loaded',
      );
    }
    return bundle;
  }

  const packageRoot =
    language === 'python'
      ? pythonPackageRoot
      : language === 'c_sharp'
        ? csharpPackageRoot
        : language === 'rust'
          ? rustPackageRoot
          : language === 'cpp'
            ? cppPackageRoot
            : null;
  if (!packageRoot) return null;

  const tags = await loadQueryFile(packageRoot, 'queries', 'tags.scm');
  const localsPath = path.resolve(queriesRoot, language, 'locals.scm');
  const locals = await loadQueryFile(localsPath);
  if (!tags || !locals) return null;

  const bundle = {
    tags: sanitizeQuery(tags),
    locals: sanitizeQuery(locals),
  };
  queryCache.set(language, bundle);
  if (!queriesLoadedLogged.has(language)) {
    queriesLoadedLogged.add(language);
    const timestamp = new Date().toISOString();
    append({
      level: 'info',
      message: 'DEV-0000032:T4:ast-parser-queries-loaded',
      timestamp,
      source: 'server',
      context: { language },
    });
    baseLogger.info(
      { event: 'DEV-0000032:T4:ast-parser-queries-loaded', language },
      'AST parser queries loaded',
    );
  }
  if (!localsQueryLoadedLogged.has(language)) {
    localsQueryLoadedLogged.add(language);
    const timestamp = new Date().toISOString();
    append({
      level: 'info',
      message: 'DEV-0000033:T3:ast-locals-query-loaded',
      timestamp,
      source: 'server',
      context: { language, localsPath },
    });
    baseLogger.info(
      { event: 'DEV-0000033:T3:ast-locals-query-loaded', language, localsPath },
      'AST locals query loaded',
    );
  }
  return bundle;
}

function getLanguageConfig(language: AstLanguage) {
  if (language === 'javascript') {
    return { language, parserLanguage: javascriptLanguage };
  }
  if (language === 'python') {
    return { language, parserLanguage: pythonLanguage };
  }
  if (language === 'c_sharp') {
    return { language, parserLanguage: csharpLanguage };
  }
  if (language === 'rust') {
    return { language, parserLanguage: rustLanguage };
  }
  if (language === 'cpp') {
    return { language, parserLanguage: cppLanguage };
  }
  const tsExports = typescriptLanguage as unknown as {
    typescript: unknown;
    tsx: unknown;
  };
  return {
    language,
    parserLanguage: language === 'tsx' ? tsExports.tsx : tsExports.typescript,
  };
}

function logGrammarRegistration(language: AstLanguage, packageName: string) {
  if (grammarRegisteredLogged.has(language)) return;
  grammarRegisteredLogged.add(language);
  const timestamp = new Date().toISOString();
  append({
    level: 'info',
    message: 'DEV-0000033:T2:ast-grammar-registered',
    timestamp,
    source: 'server',
    context: { language, package: packageName },
  });
  baseLogger.info(
    {
      event: 'DEV-0000033:T2:ast-grammar-registered',
      language,
      package: packageName,
    },
    'AST grammar registered',
  );
}

function logGrammarLoadFailure(language: AstLanguage, error: string) {
  if (grammarLoadFailureLogged) return;
  grammarLoadFailureLogged = true;
  const timestamp = new Date().toISOString();
  append({
    level: 'warn',
    message: 'DEV-0000032:T4:ast-parser-grammar-load-failed',
    timestamp,
    source: 'server',
    context: { language, error },
  });
  baseLogger.warn(
    { event: 'DEV-0000032:T4:ast-parser-grammar-load-failed', language, error },
    'AST parser failed to load grammar',
  );
}

function createSymbolIdBase(symbol: {
  root: string;
  relPath: string;
  kind: string;
  name: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}) {
  const { root, relPath, kind, name, range } = symbol;
  return [
    root,
    relPath,
    kind,
    name,
    range.start.line,
    range.start.column,
    range.end.line,
    range.end.column,
  ].join('|');
}

export function createSymbolIdFactory() {
  const seen = new Map<string, number>();
  return (base: string) => {
    const hash = crypto.createHash('sha256').update(base).digest('hex');
    const count = seen.get(hash) ?? 0;
    if (count === 0) {
      seen.set(hash, 1);
      return hash;
    }
    const next = count + 1;
    seen.set(hash, next);
    const timestamp = new Date().toISOString();
    append({
      level: 'warn',
      message: 'DEV-0000032:T13:ast-symbolid-collision',
      timestamp,
      source: 'server',
      context: { base, suffix: next },
    });
    baseLogger.warn(
      { event: 'DEV-0000032:T13:ast-symbolid-collision', base, suffix: next },
      'AST symbolId collision detected',
    );
    return `${hash}-${next}`;
  };
}

function getNodeText(node: SyntaxNode | null | undefined) {
  if (!node) return '';
  return node.text ?? '';
}

function findContainerName(node: SyntaxNode) {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'class' ||
      current.type === 'class_declaration' ||
      current.type === 'interface_declaration'
    ) {
      const nameNode = current.childForFieldName('name');
      return getNodeText(nameNode) || undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function isPositionWithinRange(
  position: { line: number; column: number },
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  },
) {
  if (position.line < range.start.line) return false;
  if (position.line > range.end.line) return false;
  if (
    position.line === range.start.line &&
    position.column < range.start.column
  )
    return false;
  if (position.line === range.end.line && position.column > range.end.column)
    return false;
  return true;
}

function rangeSpan(range: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}) {
  return (
    (range.end.line - range.start.line) * 10000 +
    (range.end.column - range.start.column)
  );
}

function distanceFromPosition(
  position: { line: number; column: number },
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  },
) {
  return (
    Math.abs(range.start.line - position.line) * 10000 +
    Math.abs(range.start.column - position.column)
  );
}

function findEnclosingSymbol(
  symbols: AstSymbolRecord[],
  position: { line: number; column: number },
  moduleSymbolId: string,
) {
  const candidates = symbols.filter(
    (symbol) =>
      symbol.symbolId !== moduleSymbolId &&
      isPositionWithinRange(position, symbol.range),
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => rangeSpan(a.range) - rangeSpan(b.range))[0];
}

function findClosestSymbolByName(
  symbols: AstSymbolRecord[],
  name: string,
  position: { line: number; column: number },
  moduleSymbolId: string,
  allowedKinds?: AstSymbolKind[],
) {
  const candidates = symbols.filter((symbol) => {
    if (symbol.symbolId === moduleSymbolId) return false;
    if (symbol.name !== name) return false;
    if (allowedKinds && !allowedKinds.includes(symbol.kind as AstSymbolKind))
      return false;
    return true;
  });
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) =>
      distanceFromPosition(position, a.range) -
      distanceFromPosition(position, b.range),
  )[0];
}

function buildCallEdges(
  references: AstReferenceRecord[],
  symbols: AstSymbolRecord[],
  moduleSymbolId: string,
  root: string,
  relPath: string,
  fileHash: string,
): AstEdgeRecord[] {
  const edges: AstEdgeRecord[] = [];
  for (const reference of references) {
    if (reference.kind !== 'call') continue;
    const callee = symbols.find(
      (symbol) =>
        symbol.symbolId !== moduleSymbolId && symbol.name === reference.name,
    );
    if (!callee) continue;
    const caller =
      findEnclosingSymbol(symbols, reference.range.start, moduleSymbolId) ??
      symbols.find((symbol) => symbol.symbolId === moduleSymbolId) ??
      null;
    if (!caller) continue;
    edges.push({
      root,
      relPath,
      fileHash,
      fromSymbolId: caller.symbolId,
      toSymbolId: callee.symbolId,
      type: 'CALLS',
    });
  }
  return edges;
}

function buildExportEdges(
  tree: Tree,
  symbols: AstSymbolRecord[],
  moduleSymbolId: string,
  root: string,
  relPath: string,
  fileHash: string,
): AstEdgeRecord[] {
  const exportStatements = tree.rootNode.descendantsOfType('export_statement');
  const edges: AstEdgeRecord[] = [];

  for (const statement of exportStatements) {
    const nameNodes = statement.descendantsOfType([
      'identifier',
      'property_identifier',
      'type_identifier',
    ]);
    const names = Array.from(
      new Set(nameNodes.map((node) => getNodeText(node)).filter(Boolean)),
    );
    for (const name of names) {
      const target = symbols.find(
        (symbol) => symbol.symbolId !== moduleSymbolId && symbol.name === name,
      );
      if (!target) continue;
      edges.push({
        root,
        relPath,
        fileHash,
        fromSymbolId: moduleSymbolId,
        toSymbolId: target.symbolId,
        type: 'EXPORTS',
      });
    }
  }

  return edges;
}

function collectClauseTypeNames(node: SyntaxNode) {
  const nameNodes = node.descendantsOfType([
    'identifier',
    'type_identifier',
    'property_identifier',
  ]);
  return Array.from(
    new Set(nameNodes.map((nameNode) => getNodeText(nameNode)).filter(Boolean)),
  );
}

function buildHeritageEdges(
  tree: Tree,
  symbols: AstSymbolRecord[],
  moduleSymbolId: string,
  root: string,
  relPath: string,
  fileHash: string,
): AstEdgeRecord[] {
  const edges: AstEdgeRecord[] = [];
  const declarations = tree.rootNode.descendantsOfType([
    'class_declaration',
    'interface_declaration',
  ]);

  for (const declaration of declarations) {
    const name = getNodeText(declaration.childForFieldName('name'));
    if (!name) continue;
    const allowedKinds: AstSymbolKind[] =
      declaration.type === 'interface_declaration' ? ['Interface'] : ['Class'];
    const sourceSymbol = findClosestSymbolByName(
      symbols,
      name,
      toRange(declaration).start,
      moduleSymbolId,
      allowedKinds,
    );
    if (!sourceSymbol) continue;

    const clauseNodes = declaration.descendantsOfType([
      'extends_clause',
      'implements_clause',
    ]);
    for (const clause of clauseNodes) {
      const edgeType =
        clause.type === 'implements_clause' ? 'IMPLEMENTS' : 'EXTENDS';
      const clauseNames = collectClauseTypeNames(clause);
      for (const clauseName of clauseNames) {
        const targetSymbol = findClosestSymbolByName(
          symbols,
          clauseName,
          toRange(clause).start,
          moduleSymbolId,
        );
        if (!targetSymbol) continue;
        if (targetSymbol.symbolId === sourceSymbol.symbolId) continue;
        edges.push({
          root,
          relPath,
          fileHash,
          fromSymbolId: sourceSymbol.symbolId,
          toSymbolId: targetSymbol.symbolId,
          type: edgeType,
        });
      }
    }
  }

  return edges;
}

function buildTypeReferenceEdges(
  references: AstReferenceRecord[],
  symbols: AstSymbolRecord[],
  moduleSymbolId: string,
  root: string,
  relPath: string,
  fileHash: string,
): AstEdgeRecord[] {
  const edges: AstEdgeRecord[] = [];
  const moduleSymbol = symbols.find(
    (symbol) => symbol.symbolId === moduleSymbolId,
  );
  for (const reference of references) {
    if (reference.kind !== 'type') continue;
    const target = findClosestSymbolByName(
      symbols,
      reference.name,
      reference.range.start,
      moduleSymbolId,
    );
    if (!target) continue;
    const source =
      findEnclosingSymbol(symbols, reference.range.start, moduleSymbolId) ??
      moduleSymbol ??
      null;
    if (!source) continue;
    edges.push({
      root,
      relPath,
      fileHash,
      fromSymbolId: source.symbolId,
      toSymbolId: target.symbolId,
      type: 'REFERENCES_TYPE',
    });
  }
  return edges;
}

function collectDefinitions(
  matches: QueryMatch[],
  root: string,
  relPath: string,
  fileHash: string,
  language: AstLanguage,
  symbolIdForBase: (base: string) => string,
): AstSymbolRecord[] {
  const symbols: AstSymbolRecord[] = [];
  for (const match of matches) {
    const definitionCapture = match.captures.find((capture) =>
      capture.name.startsWith('definition.'),
    );
    if (!definitionCapture) continue;
    const kind = definitionKindMap[definitionCapture.name];
    if (!kind) continue;
    const nameCapture = match.captures.find(
      (capture) => capture.name === 'name',
    );
    const name =
      getNodeText(nameCapture?.node) || getNodeText(definitionCapture.node);
    if (!name) continue;
    const range = toRange(definitionCapture.node);
    const container = findContainerName(definitionCapture.node);
    const base = createSymbolIdBase({
      root,
      relPath,
      kind,
      name,
      range,
    });
    const symbolId = symbolIdForBase(base);
    symbols.push({
      root,
      relPath,
      fileHash,
      language,
      kind,
      name,
      range,
      container,
      symbolId,
    });
  }
  return symbols;
}

function collectReferences(
  matches: QueryMatch[],
  root: string,
  relPath: string,
  fileHash: string,
): AstReferenceRecord[] {
  const references: AstReferenceRecord[] = [];
  for (const match of matches) {
    for (const capture of match.captures) {
      const kind = referenceKindMap[capture.name];
      if (!kind) continue;
      const nameCapture = match.captures.find((item) => item.name === 'name');
      const name = getNodeText(nameCapture?.node) || getNodeText(capture.node);
      if (!name) continue;
      references.push({
        root,
        relPath,
        fileHash,
        name,
        kind,
        range: toRange(capture.node),
      });
    }
  }
  return references;
}

type ImportStatementInfo = {
  source: string;
  names: string[];
  range: ReturnType<typeof toRange>;
};

function collectImportStatements(tree: Tree): ImportStatementInfo[] {
  const importStatements = tree.rootNode.descendantsOfType('import_statement');
  const imports: ImportStatementInfo[] = [];

  for (const statement of importStatements) {
    const sourceNode = statement.childForFieldName('source');
    const sourceText = getNodeText(sourceNode).replace(/^['"]|['"]$/g, '');
    const importClause = statement.descendantsOfType([
      'import_clause',
      'named_imports',
      'namespace_import',
    ])[0];
    const nameNodes = importClause
      ? importClause.descendantsOfType([
          'identifier',
          'property_identifier',
          'type_identifier',
        ])
      : [];
    const names = Array.from(
      new Set(nameNodes.map((node) => getNodeText(node)).filter(Boolean)),
    );
    if (!sourceText) continue;
    imports.push({ source: sourceText, names, range: toRange(statement) });
  }

  return imports;
}

function buildImportRecords(
  statements: ImportStatementInfo[],
  root: string,
  relPath: string,
  fileHash: string,
): AstModuleImportRecord[] {
  if (statements.length === 0) return [];
  return [
    {
      root,
      relPath,
      fileHash,
      imports: statements.map((statement) => ({
        source: statement.source,
        names: statement.names,
      })),
    },
  ];
}

type ParseAstSourceFn = (
  input: ParseAstSourceInput,
  inputOptions?: ParseAstSourceOptions,
) => Promise<AstParseResult>;

async function parseAstSourceInternal(
  input: ParseAstSourceInput,
  inputOptions?: ParseAstSourceOptions,
): Promise<AstParseResult> {
  const { root, text, relPath, fileHash } = input;
  const ext = path.extname(relPath).replace('.', '').toLowerCase();
  const language = normalizeLanguage(ext);
  if (!language) {
    return { status: 'failed', error: `Unsupported extension: ${ext}` };
  }

  const queries =
    inputOptions && 'queryBundleOverride' in inputOptions
      ? inputOptions.queryBundleOverride
      : await loadQueries(language);
  if (!queries) {
    if (!missingQueriesLogged) {
      missingQueriesLogged = true;
      const timestamp = new Date().toISOString();
      append({
        level: 'warn',
        message: 'DEV-0000032:T4:ast-queries-missing',
        timestamp,
        source: 'server',
        context: { language },
      });
      baseLogger.warn(
        { event: 'DEV-0000032:T4:ast-queries-missing', language },
        'Tree-sitter query files missing; skipping AST parse',
      );
    }
    return {
      status: 'failed',
      language,
      error: 'Missing Tree-sitter query files',
    };
  }

  try {
    const { parserLanguage: configuredLanguage } = getLanguageConfig(language);
    const parserLanguage =
      inputOptions && 'parserLanguageOverride' in inputOptions
        ? inputOptions.parserLanguageOverride
        : configuredLanguage;
    if (!parserLanguage) {
      logGrammarLoadFailure(language, 'missing grammar binding');
      return {
        status: 'failed',
        language,
        error: 'Tree-sitter grammar unavailable',
      };
    }
    const parser = new Parser();
    try {
      parser.setLanguage(parserLanguage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logGrammarLoadFailure(language, message);
      return {
        status: 'failed',
        language,
        error: 'Tree-sitter failed to load grammar',
      };
    }
    const tree = parser.parse(text);
    if (tree.rootNode.hasError) {
      const errorNode = tree.rootNode.descendantsOfType('ERROR')[0];
      return {
        status: 'failed',
        language,
        error: 'Tree-sitter parse error',
        ...(errorNode ? { details: buildErrorDetails(errorNode) } : {}),
      };
    }

    const tagsQuery = new Parser.Query(parserLanguage, queries.tags);
    const localsQuery = new Parser.Query(parserLanguage, queries.locals);
    const tagMatches = tagsQuery.matches(tree.rootNode);
    const localMatches = localsQuery.matches(tree.rootNode);
    const symbolIdForBase = createSymbolIdFactory();
    const moduleRange = toRange(tree.rootNode);
    const moduleBase = createSymbolIdBase({
      root,
      relPath,
      kind: 'Module',
      name: relPath,
      range: moduleRange,
    });
    const moduleSymbolId = symbolIdForBase(moduleBase);
    const moduleSymbol: AstSymbolRecord = {
      root,
      relPath,
      fileHash,
      language,
      kind: 'Module',
      name: relPath,
      range: moduleRange,
      symbolId: moduleSymbolId,
    };

    const definitionSymbols = collectDefinitions(
      tagMatches,
      root,
      relPath,
      fileHash,
      language,
      symbolIdForBase,
    );
    const importStatements = collectImportStatements(tree);
    const importSymbols = importStatements.map((statement) => {
      const importBase = createSymbolIdBase({
        root,
        relPath,
        kind: 'Module',
        name: statement.source,
        range: statement.range,
      });
      return {
        root,
        relPath,
        fileHash,
        language,
        kind: 'Module',
        name: statement.source,
        range: statement.range,
        symbolId: symbolIdForBase(importBase),
      };
    });

    const symbols = [moduleSymbol, ...definitionSymbols, ...importSymbols];

    const defineEdges: AstEdgeRecord[] = definitionSymbols.map((symbol) => ({
      root,
      relPath,
      fileHash,
      fromSymbolId: moduleSymbolId,
      toSymbolId: symbol.symbolId,
      type: 'DEFINES',
    }));

    const importEdges: AstEdgeRecord[] = importSymbols.map((symbol) => ({
      root,
      relPath,
      fileHash,
      fromSymbolId: moduleSymbolId,
      toSymbolId: symbol.symbolId,
      type: 'IMPORTS',
    }));

    const tagReferences = collectReferences(
      tagMatches,
      root,
      relPath,
      fileHash,
    );
    const localReferences = collectReferences(
      localMatches,
      root,
      relPath,
      fileHash,
    );
    const references = [...tagReferences, ...localReferences];

    const callEdges = buildCallEdges(
      tagReferences,
      symbols,
      moduleSymbolId,
      root,
      relPath,
      fileHash,
    );

    const exportEdges = buildExportEdges(
      tree,
      symbols,
      moduleSymbolId,
      root,
      relPath,
      fileHash,
    );

    const heritageEdges = buildHeritageEdges(
      tree,
      symbols,
      moduleSymbolId,
      root,
      relPath,
      fileHash,
    );

    const typeReferenceEdges = buildTypeReferenceEdges(
      references,
      symbols,
      moduleSymbolId,
      root,
      relPath,
      fileHash,
    );

    const imports = buildImportRecords(
      importStatements,
      root,
      relPath,
      fileHash,
    );

    return {
      status: 'ok',
      language,
      symbols,
      edges: [
        ...defineEdges,
        ...importEdges,
        ...callEdges,
        ...exportEdges,
        ...heritageEdges,
        ...typeReferenceEdges,
      ],
      references,
      imports,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', language, error: message };
  }
}

let parseAstSourceImpl: ParseAstSourceFn = parseAstSourceInternal;

export async function parseAstSource(
  input: ParseAstSourceInput,
  inputOptions?: ParseAstSourceOptions,
) {
  return parseAstSourceImpl(input, inputOptions);
}

export function __setParseAstSourceForTest(override?: ParseAstSourceFn | null) {
  parseAstSourceImpl = override ?? parseAstSourceInternal;
}

export async function warmAstParserQueries() {
  logAstExtensionMap();
  logGrammarRegistration('python', 'tree-sitter-python');
  logGrammarRegistration('c_sharp', 'tree-sitter-c-sharp');
  logGrammarRegistration('rust', 'tree-sitter-rust');
  logGrammarRegistration('cpp', 'tree-sitter-cpp');
  const languages: AstLanguage[] = [...astLanguageList];
  await Promise.all(
    languages.map(async (language) => {
      try {
        await loadQueries(language);
      } catch {
        return null;
      }
      return null;
    }),
  );
}
