import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveAgentHomeEnv } from '../agents/roots.js';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';
import { parseFlowFile } from './flowSchema.js';

export type FlowDefinitionCatalogEntry = {
  name: string;
  filePath: string;
  parsed: ReturnType<typeof parseFlowFile> | null;
  readError?: string;
};

export type FlowDefinitionCatalog = ReadonlyMap<
  string,
  FlowDefinitionCatalogEntry
>;

const catalogByRoot = new Map<
  string,
  Promise<Map<string, FlowDefinitionCatalogEntry>>
>();

const isSafeFlowName = (raw: string): boolean => {
  const name = raw.trim();
  return (
    Boolean(name) &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..')
  );
};

export const resolveSafeFlowFilePath = (
  flowsRoot: string,
  flowName: string,
) => {
  if (!isSafeFlowName(flowName)) throw new Error('Invalid flow name');
  const root = path.resolve(flowsRoot);
  const filePath = path.resolve(root, `${flowName}.json`);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid flow path');
  }
  return filePath;
};

export const canonicalFlowRoot = async (root: string): Promise<string> => {
  try {
    return await fs.realpath(path.resolve(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return path.resolve(root);
    throw error;
  }
};

const childFlowRootCandidates = (workingRepositoryPath?: string) => [
  ...(workingRepositoryPath
    ? [
        {
          flowsRoot: path.join(workingRepositoryPath, 'flows'),
          sourceId: workingRepositoryPath,
        },
      ]
    : []),
  { flowsRoot: resolveConfiguredFlowsRoot(), sourceId: undefined },
];

export const resolveChildFlowDefinition = async (params: {
  flowName: string;
  workingRepositoryPath?: string;
}) => {
  // Validate before touching either directory. Absence alone permits fallback.
  resolveSafeFlowFilePath('.', params.flowName);
  const visited = new Set<string>();
  for (const candidate of childFlowRootCandidates(
    params.workingRepositoryPath,
  )) {
    const flowsRoot = await canonicalFlowRoot(candidate.flowsRoot);
    if (visited.has(flowsRoot)) continue;
    visited.add(flowsRoot);
    const entry = await getFlowDefinitionCatalogEntry({
      flowsRoot,
      flowName: params.flowName,
    });
    if (entry) return { ...candidate, flowsRoot, entry };
  }
  return undefined;
};

export const resolveConfiguredFlowsRoot = (): string => {
  const configuredFlowsDir = getScopedEnvValue('FLOWS_DIR');
  if (configuredFlowsDir) return path.resolve(configuredFlowsDir);
  const { codeInfoRoot } = resolveAgentHomeEnv();
  if (codeInfoRoot) return path.join(codeInfoRoot, 'flows');
  return path.resolve('flows');
};

const loadCatalog = async (
  flowsRoot: string,
): Promise<Map<string, FlowDefinitionCatalogEntry>> => {
  const entries = await fs
    .readdir(flowsRoot, { withFileTypes: true })
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
  const flowFiles = entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const loaded = await Promise.all(
    flowFiles.map(async (entry): Promise<FlowDefinitionCatalogEntry> => {
      const name = entry.name.replace(/\.json$/iu, '');
      const filePath = path.join(flowsRoot, entry.name);
      try {
        const jsonText = await fs.readFile(filePath, 'utf8');
        return {
          name,
          filePath,
          parsed: parseFlowFile(jsonText, {
            flowName: name,
            emitSchemaParseLogs: true,
          }),
        };
      } catch (error) {
        return {
          name,
          filePath,
          parsed: null,
          readError:
            error instanceof Error ? error.message : 'Unable to read flow file',
        };
      }
    }),
  );
  return new Map(loaded.map((entry) => [entry.name, entry]));
};

export const getFlowDefinitionCatalog = async (
  flowsRoot: string,
): Promise<FlowDefinitionCatalog> => {
  const resolvedRoot = await canonicalFlowRoot(flowsRoot);
  let catalog = catalogByRoot.get(resolvedRoot);
  if (!catalog) {
    catalog = loadCatalog(resolvedRoot);
    catalogByRoot.set(resolvedRoot, catalog);
  }
  return catalog;
};

export const initializeFlowDefinitionCatalogs = async (
  flowsRoots: Iterable<string>,
) => {
  const resolvedRoots = [
    ...new Set([...flowsRoots].map((flowsRoot) => path.resolve(flowsRoot))),
  ];
  await Promise.all(
    resolvedRoots.map((flowsRoot) => getFlowDefinitionCatalog(flowsRoot)),
  );
};

export const initializeConfiguredFlowDefinitionCatalog = () =>
  initializeFlowDefinitionCatalogs([resolveConfiguredFlowsRoot()]);

export const getFlowDefinitionCatalogEntry = async (params: {
  flowsRoot: string;
  flowName: string;
}) => (await getFlowDefinitionCatalog(params.flowsRoot)).get(params.flowName);

export const __resetFlowDefinitionCatalogForTests = () => {
  catalogByRoot.clear();
};
