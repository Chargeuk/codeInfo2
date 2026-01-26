import { IngestRequiredError } from '../ingest/chromaClient.js';
import {
  type RepoEntry,
  type ListReposResult,
  RepoNotFoundError,
  ValidationError,
  listIngestedRepositories,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { AstCoverageModel } from '../mongo/astCoverage.js';
import { type AstEdge, AstEdgeModel } from '../mongo/astEdge.js';
import {
  type AstModuleImport,
  AstModuleImportModel,
} from '../mongo/astModuleImport.js';
import { type AstReference, AstReferenceModel } from '../mongo/astReference.js';
import { type AstSymbol, AstSymbolModel } from '../mongo/astSymbol.js';

type AstSymbolRow = Pick<
  AstSymbol,
  | 'symbolId'
  | 'root'
  | 'relPath'
  | 'fileHash'
  | 'language'
  | 'kind'
  | 'name'
  | 'range'
  | 'container'
>;

type AstEdgeRow = Pick<
  AstEdge,
  | 'root'
  | 'relPath'
  | 'fileHash'
  | 'fromSymbolId'
  | 'toSymbolId'
  | 'type'
>;

type AstReferenceRow = Pick<AstReference, 'root' | 'relPath' | 'fileHash' | 'range'> &
  Partial<Pick<AstReference, 'symbolId' | 'name' | 'kind'>>;

type AstModuleImportRow = Pick<
  AstModuleImport,
  'root' | 'relPath' | 'fileHash' | 'imports'
>;

export type SymbolRecord = {
  symbolId: string;
  root: string;
  relPath: string;
  fileHash: string;
  language: string;
  kind: string;
  name: string;
  range: AstSymbol['range'];
  container?: string;
};

export type EdgeRecord = {
  root: string;
  relPath: string;
  fileHash: string;
  fromSymbolId: string;
  toSymbolId: string;
  type: string;
};

export type ReferenceRecord = {
  relPath: string;
  range: AstReference['range'];
  symbolId?: string;
};

export type ModuleImportsRecord = {
  relPath: string;
  imports: AstModuleImport['imports'];
};

export type AstListSymbolsParams = {
  repository?: unknown;
  kinds?: unknown;
  limit?: unknown;
};

export type AstFindDefinitionParams = {
  repository?: unknown;
  symbolId?: unknown;
  name?: unknown;
  kind?: unknown;
};

export type AstFindReferencesParams = AstFindDefinitionParams;

export type AstCallGraphParams = {
  repository?: unknown;
  symbolId?: unknown;
  depth?: unknown;
};

export type AstModuleImportsParams = {
  repository?: unknown;
  relPath?: unknown;
};

export type AstListSymbolsResult = { symbols: SymbolRecord[] };
export type AstFindDefinitionResult = { symbol: SymbolRecord | null };
export type AstFindReferencesResult = { references: ReferenceRecord[] };
export type AstCallGraphResult = { nodes: SymbolRecord[]; edges: EdgeRecord[] };
export type AstModuleImportsResult = { modules: ModuleImportsRecord[] };

export class AstIndexRequiredError extends Error {
  code = 'AST_INDEX_REQUIRED' as const;
  constructor(public repository: string) {
    super('AST_INDEX_REQUIRED');
    this.name = 'AstIndexRequiredError';
  }
}

type FindChain<T> = {
  limit: (value: number) => FindChain<T>;
  sort?: (spec: Record<string, 1 | -1>) => FindChain<T>;
  lean: () => { exec: () => Promise<T[]> };
};

type FindOneChain<T> = { lean: () => { exec: () => Promise<T | null> } };

type AstSymbolModelLike = {
  find: (query: Record<string, unknown>) => FindChain<AstSymbolRow>;
  findOne: (query: Record<string, unknown>) => FindOneChain<AstSymbolRow>;
};

type AstEdgeModelLike = {
  find: (query: Record<string, unknown>) => FindChain<AstEdgeRow>;
};

type AstReferenceModelLike = {
  find: (query: Record<string, unknown>) => FindChain<AstReferenceRow>;
};

type AstModuleImportModelLike = {
  find: (query: Record<string, unknown>) => FindChain<AstModuleImportRow>;
};

type AstCoverageModelLike = {
  findOne: (query: Record<string, unknown>) => FindOneChain<{
    root: string;
  }>;
};

export type AstToolDeps = {
  listIngestedRepositories: typeof listIngestedRepositories;
  astCoverageModel: AstCoverageModelLike;
  astSymbolModel: AstSymbolModelLike;
  astEdgeModel: AstEdgeModelLike;
  astReferenceModel: AstReferenceModelLike;
  astModuleImportModel: AstModuleImportModelLike;
};

function resolveDeps(partial: Partial<AstToolDeps>): AstToolDeps {
  return {
    listIngestedRepositories,
    astCoverageModel: AstCoverageModel,
    astSymbolModel: AstSymbolModel,
    astEdgeModel: AstEdgeModel,
    astReferenceModel: AstReferenceModel,
    astModuleImportModel: AstModuleImportModel,
    ...partial,
  } satisfies AstToolDeps;
}

function logToolRequest(tool: string, repository: string) {
  const context = {
    event: 'DEV-0000032:T7:ast-tool-service-request',
    tool,
    repository,
  };
  append({
    level: 'info',
    message: 'DEV-0000032:T7:ast-tool-service-request',
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
  baseLogger.info(context, 'AST tool service request');
}

function toSymbolRecord(symbol: AstSymbolRow): SymbolRecord {
  return {
    symbolId: symbol.symbolId,
    root: symbol.root,
    relPath: symbol.relPath,
    fileHash: symbol.fileHash,
    language: symbol.language,
    kind: symbol.kind,
    name: symbol.name,
    range: symbol.range,
    ...(symbol.container ? { container: symbol.container } : {}),
  };
}

function toEdgeRecord(edge: AstEdgeRow): EdgeRecord {
  return {
    root: edge.root,
    relPath: edge.relPath,
    fileHash: edge.fileHash,
    fromSymbolId: edge.fromSymbolId,
    toSymbolId: edge.toSymbolId,
    type: edge.type,
  };
}

function toReferenceRecord(reference: AstReferenceRow): ReferenceRecord {
  return {
    relPath: reference.relPath,
    range: reference.range,
    ...(reference.symbolId ? { symbolId: reference.symbolId } : {}),
  };
}

function parseIsoTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function selectRepo(repos: RepoEntry[], repository: string): RepoEntry | null {
  const matches = repos.filter((repo) => repo.id === repository);
  if (matches.length === 0) return null;
  return matches.reduce((best, current) => {
    const bestTs = parseIsoTimestamp(best.lastIngestAt);
    const currentTs = parseIsoTimestamp(current.lastIngestAt);
    if (currentTs === bestTs) return best;
    return currentTs > bestTs ? current : best;
  });
}

async function resolveRepoRoot(
  repository: string,
  deps: AstToolDeps,
): Promise<{ root: string; repo: RepoEntry }> {
  const { repos } = (await deps.listIngestedRepositories()) as ListReposResult;
  if (repos.length === 0) {
    throw new IngestRequiredError('No ingested repositories available');
  }
  const repo = selectRepo(repos, repository);
  if (!repo) {
    throw new RepoNotFoundError(repository);
  }
  const root = repo.containerPath;
  const coverage = await deps.astCoverageModel.findOne({ root }).lean().exec();
  if (!coverage) {
    throw new AstIndexRequiredError(repository);
  }
  return { root, repo };
}

function ensureNonEmptyString(value: unknown, field: string, errors: string[]) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${field} is required`);
    return '';
  }
  return value.trim();
}

function validateKinds(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push('kinds must be an array of strings');
    return undefined;
  }
  const kinds = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  if (value.length > 0 && kinds.length === 0) {
    errors.push('kinds must contain at least one non-empty string');
  }
  return kinds;
}

function validateLimit(value: unknown, errors: string[]) {
  if (value === undefined) return 50;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push('limit must be an integer');
    return 50;
  }
  if (value < 1) {
    errors.push('limit must be at least 1');
    return 50;
  }
  return Math.min(value, 200);
}

function validateName(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push('name must be a non-empty string when provided');
    return undefined;
  }
  return value.trim();
}

function validateKind(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push('kind must be a non-empty string when provided');
    return undefined;
  }
  return value.trim();
}

function validateSymbolId(value: unknown, errors: string[]) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push('symbolId must be a non-empty string when provided');
    return undefined;
  }
  return value.trim();
}

export function validateAstListSymbols(body: AstListSymbolsParams): {
  repository: string;
  kinds?: string[];
  limit: number;
} {
  const errors: string[] = [];
  const repository = ensureNonEmptyString(
    body.repository,
    'repository',
    errors,
  );
  const kinds = validateKinds(body.kinds, errors);
  const limit = validateLimit(body.limit, errors);

  if (errors.length) {
    throw new ValidationError(errors);
  }

  return {
    repository,
    ...(kinds && kinds.length > 0 ? { kinds } : {}),
    limit,
  };
}

function validateDefinitionInput(
  body: AstFindDefinitionParams,
  errors: string[],
) {
  const repository = ensureNonEmptyString(
    body.repository,
    'repository',
    errors,
  );
  const symbolId = validateSymbolId(body.symbolId, errors);
  const name = validateName(body.name, errors);
  const kind = validateKind(body.kind, errors);
  if (!symbolId && !name) {
    errors.push('symbolId or name is required');
  }
  return { repository, symbolId, name, kind };
}

export function validateAstFindDefinition(body: AstFindDefinitionParams): {
  repository: string;
  symbolId?: string;
  name?: string;
  kind?: string;
} {
  const errors: string[] = [];
  const values = validateDefinitionInput(body, errors);
  if (errors.length) {
    throw new ValidationError(errors);
  }
  return values;
}

export function validateAstFindReferences(body: AstFindReferencesParams): {
  repository: string;
  symbolId?: string;
  name?: string;
  kind?: string;
} {
  const errors: string[] = [];
  const values = validateDefinitionInput(body, errors);
  if (errors.length) {
    throw new ValidationError(errors);
  }
  return values;
}

export function validateAstCallGraph(body: AstCallGraphParams): {
  repository: string;
  symbolId: string;
  depth: number;
} {
  const errors: string[] = [];
  const repository = ensureNonEmptyString(
    body.repository,
    'repository',
    errors,
  );
  const symbolId = validateSymbolId(body.symbolId, errors);
  if (!symbolId) {
    errors.push('symbolId is required');
  }
  let depth = 1;
  if (body.depth !== undefined) {
    if (typeof body.depth !== 'number' || !Number.isInteger(body.depth)) {
      errors.push('depth must be an integer');
    } else if (body.depth < 1) {
      errors.push('depth must be at least 1');
    } else {
      depth = body.depth;
    }
  }

  if (errors.length) {
    throw new ValidationError(errors);
  }
  return { repository, symbolId: symbolId ?? '', depth };
}

export function validateAstModuleImports(body: AstModuleImportsParams): {
  repository: string;
  relPath?: string;
} {
  const errors: string[] = [];
  const repository = ensureNonEmptyString(
    body.repository,
    'repository',
    errors,
  );
  let relPath: string | undefined;
  if (body.relPath !== undefined) {
    if (typeof body.relPath === 'string' && body.relPath.trim()) {
      relPath = body.relPath.trim();
    } else {
      errors.push('relPath must be a non-empty string when provided');
    }
  }
  if (errors.length) {
    throw new ValidationError(errors);
  }
  return { repository, ...(relPath ? { relPath } : {}) };
}

export async function astListSymbols(
  params: AstListSymbolsParams,
  deps: Partial<AstToolDeps> = {},
): Promise<AstListSymbolsResult> {
  const validated = validateAstListSymbols(params);
  logToolRequest('AstListSymbols', validated.repository);
  const resolvedDeps = resolveDeps(deps);
  const { root } = await resolveRepoRoot(validated.repository, resolvedDeps);
  const query: Record<string, unknown> = { root };
  if (validated.kinds) {
    query.kind = { $in: validated.kinds };
  }
  const results = await resolvedDeps.astSymbolModel
    .find(query)
    .limit(validated.limit)
    .lean()
    .exec();
  return { symbols: results.map(toSymbolRecord) };
}

export async function astFindDefinition(
  params: AstFindDefinitionParams,
  deps: Partial<AstToolDeps> = {},
): Promise<AstFindDefinitionResult> {
  const validated = validateAstFindDefinition(params);
  logToolRequest('AstFindDefinition', validated.repository);
  const resolvedDeps = resolveDeps(deps);
  const { root } = await resolveRepoRoot(validated.repository, resolvedDeps);
  let symbol: AstSymbolRow | null = null;
  if (validated.symbolId) {
    symbol = await resolvedDeps.astSymbolModel
      .findOne({ root, symbolId: validated.symbolId })
      .lean()
      .exec();
  } else if (validated.name) {
    const query: Record<string, unknown> = { root, name: validated.name };
    if (validated.kind) query.kind = validated.kind;
    symbol = await resolvedDeps.astSymbolModel.findOne(query).lean().exec();
  }
  return { symbol: symbol ? toSymbolRecord(symbol) : null };
}

export async function astFindReferences(
  params: AstFindReferencesParams,
  deps: Partial<AstToolDeps> = {},
): Promise<AstFindReferencesResult> {
  const validated = validateAstFindReferences(params);
  logToolRequest('AstFindReferences', validated.repository);
  const resolvedDeps = resolveDeps(deps);
  const { root } = await resolveRepoRoot(validated.repository, resolvedDeps);
  const query: Record<string, unknown> = { root };
  if (validated.symbolId) {
    query.symbolId = validated.symbolId;
  } else if (validated.name) {
    query.name = validated.name;
    if (validated.kind) query.kind = validated.kind;
  }
  const references = await resolvedDeps.astReferenceModel
    .find(query)
    .lean()
    .exec();
  return { references: references.map(toReferenceRecord) };
}

export async function astCallGraph(
  params: AstCallGraphParams,
  deps: Partial<AstToolDeps> = {},
): Promise<AstCallGraphResult> {
  const validated = validateAstCallGraph(params);
  logToolRequest('AstCallGraph', validated.repository);
  const resolvedDeps = resolveDeps(deps);
  const { root } = await resolveRepoRoot(validated.repository, resolvedDeps);

  const seen = new Set<string>([validated.symbolId]);
  let frontier = new Set<string>([validated.symbolId]);
  const edges: AstEdgeRow[] = [];

  for (let depth = 0; depth < validated.depth; depth += 1) {
    if (frontier.size === 0) break;
    const frontierIds = Array.from(frontier);
    const batch = await resolvedDeps.astEdgeModel
      .find({ root, type: 'CALLS', fromSymbolId: { $in: frontierIds } })
      .lean()
      .exec();
    const nextFrontier = new Set<string>();
    for (const edge of batch) {
      edges.push(edge);
      if (!seen.has(edge.toSymbolId)) {
        seen.add(edge.toSymbolId);
        nextFrontier.add(edge.toSymbolId);
      }
    }
    frontier = nextFrontier;
  }

  const symbols = await resolvedDeps.astSymbolModel
    .find({ root, symbolId: { $in: Array.from(seen) } })
    .lean()
    .exec();

  return {
    nodes: symbols.map(toSymbolRecord),
    edges: edges.map(toEdgeRecord),
  };
}

export async function astModuleImports(
  params: AstModuleImportsParams,
  deps: Partial<AstToolDeps> = {},
): Promise<AstModuleImportsResult> {
  const validated = validateAstModuleImports(params);
  logToolRequest('AstModuleImports', validated.repository);
  const resolvedDeps = resolveDeps(deps);
  const { root } = await resolveRepoRoot(validated.repository, resolvedDeps);
  const query: Record<string, unknown> = { root };
  if (validated.relPath) query.relPath = validated.relPath;
  const modules = await resolvedDeps.astModuleImportModel
    .find(query)
    .lean()
    .exec();
  return {
    modules: modules.map((module) => ({
      relPath: module.relPath,
      imports: module.imports,
    })),
  };
}
