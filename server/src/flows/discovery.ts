import fs from 'node:fs/promises';
import path from 'node:path';

import {
  resolveAgentHomeForRepository,
  resolveAgentHomeEnv,
} from '../agents/roots.js';
import {
  listIngestedRepositories,
  resolveRepoEmbeddingIdentity,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { parseFlowFile, type FlowFile, type FlowStep } from './flowSchema.js';

export type FlowSummary = {
  name: string;
  description: string;
  disabled: boolean;
  error?: string;
  warnings?: string[];
  sourceId?: string;
  sourceLabel?: string;
};

const INVALID_DESCRIPTION = 'Invalid flow file';

const isJsonFile = (entry: string) => entry.toLowerCase().endsWith('.json');

const resolveFlowsDir = (baseDir?: string): string => {
  if (baseDir) return path.resolve(baseDir);
  if (process.env.FLOWS_DIR) return path.resolve(process.env.FLOWS_DIR);
  const { codeInfoRoot } = resolveAgentHomeEnv();
  if (codeInfoRoot) return path.join(codeInfoRoot, 'flows');
  return path.resolve('flows');
};

const resolveFlowsRepositoryRoot = (flowsDir: string) => {
  const resolvedFlowsDir = path.resolve(flowsDir);
  if (path.basename(resolvedFlowsDir) === 'flows') {
    return path.dirname(resolvedFlowsDir);
  }
  return resolvedFlowsDir;
};

const collectAgentTypes = (steps: FlowStep[], names = new Set<string>()) => {
  for (const step of steps) {
    switch (step.type) {
      case 'llm':
      case 'break':
      case 'continue':
      case 'command':
        names.add(step.agentType);
        break;
      case 'startLoop':
        collectAgentTypes(step.steps, names);
        break;
      default:
        break;
    }
  }
  return names;
};

const collectFlowWarnings = async (params: {
  parsedFlow?: FlowFile;
  repositoryRoot: string;
}) => {
  if (!params.parsedFlow) return undefined;
  const warnings = new Set<string>();
  for (const agentName of collectAgentTypes(params.parsedFlow.steps)) {
    const resolved = await resolveAgentHomeForRepository({
      repositoryRoot: params.repositoryRoot,
      agentName,
    });
    for (const warning of resolved.warnings) {
      warnings.add(warning);
    }
  }
  return warnings.size > 0 ? [...warnings] : undefined;
};

const buildSummary = (params: {
  name: string;
  parsed: ReturnType<typeof parseFlowFile> | null;
  error?: string;
  warnings?: string[];
  sourceId?: string;
  sourceLabel?: string;
}): FlowSummary => {
  if (!params.parsed?.ok) {
    const base: FlowSummary = {
      name: params.name,
      description: INVALID_DESCRIPTION,
      disabled: true,
      error: params.error ?? INVALID_DESCRIPTION,
      ...(params.warnings ? { warnings: params.warnings } : {}),
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
    ...(params.warnings ? { warnings: params.warnings } : {}),
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
    repositoryRoot: string;
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

      const parsed = parseFlowFile(jsonText, { flowName: name });
      const warnings = await collectFlowWarnings({
        parsedFlow: parsed.ok ? parsed.flow : undefined,
        repositoryRoot: params.repositoryRoot,
      });
      summaries.push(
        buildSummary({
          name,
          parsed,
          error: parsed.ok ? undefined : 'Invalid flow file',
          warnings,
          sourceId: params.sourceId,
          sourceLabel: params.sourceLabel,
        }),
      );
    }

    return summaries;
  };

  const localFlows = await listFlowsFromDir({
    flowsDir,
    repositoryRoot: resolveFlowsRepositoryRoot(flowsDir),
  });

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
        const resolved = resolveRepoEmbeddingIdentity(repo);
        append({
          level: 'info',
          message: 'DEV-0000036:T11:transitive_consumer_contract_read',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            consumer: 'flows.discovery',
            sourceId,
            embeddingProvider: resolved.embeddingProvider,
            embeddingModel: resolved.embeddingModel,
            embeddingDimensions: resolved.embeddingDimensions,
            modelId: resolved.modelId,
          },
        });
        append({
          level: 'info',
          message: 'DEV-0000036:T11:transitive_consumer_alias_fallback',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            consumer: 'flows.discovery',
            sourceId,
            aliasFallbackUsed: resolved.aliasFallbackUsed,
          },
        });
        const flowsRoot = path.join(sourceId, 'flows');
        return await listFlowsFromDir({
          flowsDir: flowsRoot,
          repositoryRoot: sourceId,
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
