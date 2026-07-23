import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveAgentHomeEnv } from '../agents/roots.js';
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

export const resolveConfiguredFlowsRoot = (): string => {
  if (process.env.FLOWS_DIR) return path.resolve(process.env.FLOWS_DIR);
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
  const resolvedRoot = path.resolve(flowsRoot);
  let catalog = catalogByRoot.get(resolvedRoot);
  if (!catalog) {
    catalog = loadCatalog(resolvedRoot);
    catalogByRoot.set(resolvedRoot, catalog);
  }
  return catalog;
};

export const initializeConfiguredFlowDefinitionCatalog = () =>
  getFlowDefinitionCatalog(resolveConfiguredFlowsRoot());

export const getFlowDefinitionCatalogEntry = async (params: {
  flowsRoot: string;
  flowName: string;
}) => (await getFlowDefinitionCatalog(params.flowsRoot)).get(params.flowName);

export const __resetFlowDefinitionCatalogForTests = () => {
  catalogByRoot.clear();
};
