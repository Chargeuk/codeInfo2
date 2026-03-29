import path from 'path';
import { append } from '../logStore.js';

append({
  level: 'info',
  message: '0000020 ingest deltaPlan module ready',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: { module: 'server/src/ingest/deltaPlan.ts' },
});

export type IndexedFile = {
  relPath: string;
  fileHash: string;
};

export type DiscoveredFileHash = {
  absPath: string;
  relPath: string;
  fileHash: string;
  ext?: string;
  size?: number;
};

export type DeltaPlan = {
  unchanged: IndexedFile[];
  changed: DiscoveredFileHash[];
  added: DiscoveredFileHash[];
  deleted: IndexedFile[];
};

export type DeltaAstMode = 'ast_skip_non_ast_delta' | 'ast_full_rebuild';

export function resolveDeltaAstMode(params: {
  plan: DeltaPlan;
  isAstSupported: (ext: string) => boolean;
}): { mode: DeltaAstMode; astRelevantDeltaCount: number } {
  const hasAstSupport = (file: { relPath: string; ext?: string }) => {
    const ext = (file.ext ?? path.extname(file.relPath).slice(1)).toLowerCase();
    return ext.length > 0 && params.isAstSupported(ext);
  };

  const astRelevantDeltaCount = [
    ...params.plan.added,
    ...params.plan.changed,
    ...params.plan.deleted,
  ].filter(hasAstSupport).length;

  return {
    mode:
      astRelevantDeltaCount > 0 ? 'ast_full_rebuild' : 'ast_skip_non_ast_delta',
    astRelevantDeltaCount,
  };
}

function byRelPath(a: { relPath: string }, b: { relPath: string }) {
  return a.relPath.localeCompare(b.relPath);
}

export function buildDeltaPlan(params: {
  previous: IndexedFile[];
  discovered: DiscoveredFileHash[];
}): DeltaPlan {
  const previousByRelPath = new Map<string, IndexedFile>();
  for (const file of params.previous) {
    previousByRelPath.set(file.relPath, file);
  }

  const discoveredSorted = [...params.discovered].sort(byRelPath);
  const discoveredByRelPath = new Map<string, DiscoveredFileHash>();
  for (const file of discoveredSorted) {
    if (!discoveredByRelPath.has(file.relPath)) {
      discoveredByRelPath.set(file.relPath, file);
    }
  }

  const unchanged: IndexedFile[] = [];
  const changed: DiscoveredFileHash[] = [];
  const added: DiscoveredFileHash[] = [];

  for (const file of discoveredByRelPath.values()) {
    const previous = previousByRelPath.get(file.relPath);
    if (!previous) {
      added.push(file);
    } else if (previous.fileHash !== file.fileHash) {
      changed.push(file);
    } else {
      unchanged.push(previous);
    }
  }

  const deleted: IndexedFile[] = [];
  const previousSorted = [...params.previous].sort(byRelPath);
  for (const file of previousSorted) {
    if (!discoveredByRelPath.has(file.relPath)) {
      deleted.push(file);
    }
  }

  unchanged.sort(byRelPath);
  changed.sort(byRelPath);
  added.sort(byRelPath);
  deleted.sort(byRelPath);

  return { unchanged, changed, added, deleted };
}
