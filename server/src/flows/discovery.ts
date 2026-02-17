import fs from 'node:fs/promises';
import path from 'node:path';

import { listIngestedRepositories } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { parseFlowFile } from './flowSchema.js';

export type FlowSummary = {
  name: string;
  description: string;
  disabled: boolean;
  error?: string;
  sourceId?: string;
  sourceLabel?: string;
};

const INVALID_DESCRIPTION = 'Invalid flow file';

const isJsonFile = (entry: string) => entry.toLowerCase().endsWith('.json');

const resolveFlowsDir = (baseDir?: string): string => {
  if (baseDir) return path.resolve(baseDir);
  if (process.env.FLOWS_DIR) return path.resolve(process.env.FLOWS_DIR);
  const agentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  if (agentsHome) return path.resolve(agentsHome, '..', 'flows');
  return path.resolve('flows');
};

const buildSummary = (params: {
  name: string;
  parsed: ReturnType<typeof parseFlowFile> | null;
  error?: string;
  sourceId?: string;
  sourceLabel?: string;
}): FlowSummary => {
  if (!params.parsed?.ok) {
    const base: FlowSummary = {
      name: params.name,
      description: INVALID_DESCRIPTION,
      disabled: true,
      error: params.error ?? INVALID_DESCRIPTION,
    };
    if (params.sourceId && params.sourceLabel) {
      return {
        ...base,
        sourceId: params.sourceId,
        sourceLabel: params.sourceLabel,
      };
    }
    return base;
  }

  const base: FlowSummary = {
    name: params.name,
    description: params.parsed.flow.description ?? '',
    disabled: false,
  };
  if (params.sourceId && params.sourceLabel) {
    return {
      ...base,
      sourceId: params.sourceId,
      sourceLabel: params.sourceLabel,
    };
  }
  return base;
};

export async function discoverFlows(params?: {
  baseDir?: string;
  listIngestedRepositories?: typeof listIngestedRepositories;
}): Promise<FlowSummary[]> {
  const flowsDir = resolveFlowsDir(params?.baseDir);

  const listFlowsFromDir = async (params: {
    flowsDir: string;
    sourceId?: string;
    sourceLabel?: string;
  }): Promise<FlowSummary[]> => {
    const entries = await fs
      .readdir(params.flowsDir, { withFileTypes: true })
      .catch((error) => {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        throw error;
      });

    if (!entries) return [];

    const summaries: FlowSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!isJsonFile(entry.name)) continue;

      const name = entry.name.replace(/\.json$/i, '');
      const filePath = path.join(params.flowsDir, entry.name);
      const jsonText = await fs.readFile(filePath, 'utf-8').catch(() => null);
      if (!jsonText) {
        summaries.push(
          buildSummary({
            name,
            parsed: null,
            error: 'Unable to read flow file',
            sourceId: params.sourceId,
            sourceLabel: params.sourceLabel,
          }),
        );
        continue;
      }

      const parsed = parseFlowFile(jsonText);
      summaries.push(
        buildSummary({
          name,
          parsed,
          error: parsed.ok ? undefined : 'Invalid flow file',
          sourceId: params.sourceId,
          sourceLabel: params.sourceLabel,
        }),
      );
    }

    return summaries;
  };

  const localFlows = await listFlowsFromDir({ flowsDir });

  let ingestedFlows: FlowSummary[] = [];
  const resolvedListIngestedRepositories =
    params?.listIngestedRepositories ?? listIngestedRepositories;
  const ingestRoots = await resolvedListIngestedRepositories()
    .then((result) => result.repos)
    .catch(() => null);

  if (!ingestRoots) {
    const localSorted = sortFlows(localFlows);
    append({
      level: 'info',
      message: 'flows.discovery.scan',
      timestamp: new Date().toISOString(),
      source: 'server',
      context: {
        totalFlows: localSorted.length,
        disabledFlows: localSorted.filter((flow) => flow.disabled).length,
      },
    });
    return localSorted;
  }

  if (ingestRoots.length > 0) {
    const ingestResults = await Promise.all(
      ingestRoots.map(async (repo) => {
        const sourceId = repo.containerPath;
        const sourceLabel =
          repo.id?.trim() || path.posix.basename(sourceId.replace(/\\/g, '/'));
        if (!sourceLabel) return [];
        const flowsRoot = path.join(sourceId, 'flows');
        return await listFlowsFromDir({
          flowsDir: flowsRoot,
          sourceId,
          sourceLabel,
        });
      }),
    );
    ingestedFlows = ingestResults.flat();
  }

  const flows = sortFlows([...localFlows, ...ingestedFlows]);
  append({
    level: 'info',
    message: 'flows.discovery.scan',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      totalFlows: flows.length,
      disabledFlows: flows.filter((flow) => flow.disabled).length,
    },
  });
  append({
    level: 'info',
    message: 'DEV-0000034:T3:flows_listed',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      localCount: localFlows.length,
      ingestedCount: ingestedFlows.length,
      totalCount: flows.length,
    },
  });

  return flows;
}

const displayLabel = (flow: FlowSummary) =>
  flow.sourceLabel ? `${flow.name} - [${flow.sourceLabel}]` : flow.name;

const sortFlows = (flows: FlowSummary[]) =>
  flows.sort((a, b) => displayLabel(a).localeCompare(displayLabel(b)));
