import type {
  AstEdgeRecord,
  AstModuleImportRecord,
  AstReferenceRecord,
  AstSymbolRecord,
} from '../mongo/repo.js';

export type AstLanguage = 'javascript' | 'typescript' | 'tsx';

export type AstSymbolKind =
  | 'Module'
  | 'Class'
  | 'Function'
  | 'Method'
  | 'Interface'
  | 'TypeAlias'
  | 'Enum'
  | 'Property';

export type AstEdgeType =
  | 'DEFINES'
  | 'CALLS'
  | 'IMPORTS'
  | 'EXPORTS'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'REFERENCES_TYPE';

export type ParseAstSourceInput = {
  root: string;
  text: string;
  relPath: string;
  fileHash: string;
};

export type AstParseSuccess = {
  status: 'ok';
  language: AstLanguage;
  symbols: AstSymbolRecord[];
  edges: AstEdgeRecord[];
  references: AstReferenceRecord[];
  imports: AstModuleImportRecord[];
};

export type AstParseFailure = {
  status: 'failed';
  language?: AstLanguage;
  error: string;
  details?: {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    snippet: string;
    nodeType?: string;
  };
};

export type AstParseResult = AstParseSuccess | AstParseFailure;
