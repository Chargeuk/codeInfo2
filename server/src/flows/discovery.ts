import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createAgentAvailabilityContext,
  evaluateAgentAvailability,
  toAgentListWarnings,
  type AgentAvailabilityWarning,
  type AgentDisabledReason,
} from '../agents/availability.js';
import { loadAgentCommandFile } from '../agents/commandsLoader.js';
import { discoverAgents } from '../agents/discovery.js';
import {
  resolveAgentHomeForRepository,
  resolveAgentHomeEnv,
  validateRepositoryBackedAgentType,
} from '../agents/roots.js';
import {
  listIngestedRepositories,
  resolveRepoEmbeddingIdentity,
} from '../lmstudio/toolService.js';
import { append } from '../logStore.js';
import { appendRepoBackedTransitiveConsumerLogs } from '../logging/transitiveConsumerMarkers.js';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';
import { parseFlowFile, type FlowFile, type FlowStep } from './flowSchema.js';
import {
  buildRepositoryCandidateOrder,
  normalizeRepositoryCandidateLabel,
} from './repositoryCandidateOrder.js';

export type FlowSummary = {
  name: string;
  description: string;
  disabled: boolean;
  error?: string;
  warnings?: string[];
  sourceId?: string;
  sourceLabel?: string;
  warningDetails?: AgentAvailabilityWarning[];
  disabledReason?: AgentDisabledReason;
};

const INVALID_DESCRIPTION = 'Invalid flow file';

const isJsonFile = (entry: string) => entry.toLowerCase().endsWith('.json');
const isSafeCommandName = (raw: string): boolean => {
  const trimmed = raw.trim();
  return (
    trimmed.length > 0 &&
    trimmed === path.posix.basename(trimmed) &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  );
};

const resolveFlowsDir = (baseDir?: string): string => {
  if (baseDir) return path.resolve(baseDir);
  const configuredFlowsDir = getScopedEnvValue('FLOWS_DIR');
  if (configuredFlowsDir) return path.resolve(configuredFlowsDir);
  const { codeInfoRoot } = resolveAgentHomeEnv();
  if (codeInfoRoot) return path.join(codeInfoRoot, 'flows');
  return path.resolve('flows');
};

const resolveFlowAgentLookupRoot = (flowsDir: string) => {
  const resolvedFlowsDir = path.resolve(flowsDir);
  if (path.basename(resolvedFlowsDir) === 'flows') {
    return path.dirname(resolvedFlowsDir);
  }

  // The shipped main stack keeps local bundled flow JSON files under
  // /app/flows-sandbox, but the runnable agent homes still live under the
  // configured app roots (/app/codeinfo_agents or /app/codex_agents). Treat
  // that sandbox as a flow storage directory, not as a self-contained repo.
  if (path.basename(resolvedFlowsDir) === 'flows-sandbox') {
    return resolveAgentHomeEnv().codeInfoRoot;
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
      case 'if':
        if (step.agentType?.trim()) {
          names.add(step.agentType);
        }
        collectAgentTypes(step.then, names);
        if (step.else) {
          collectAgentTypes(step.else, names);
        }
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
  discoveredAgentsByName: Map<
    string,
    Awaited<ReturnType<typeof discoverAgents>>[number]
  >;
}) => {
  if (!params.parsedFlow) return undefined;
  const warnings = new Set<string>();
  for (const agentName of collectAgentTypes(params.parsedFlow.steps)) {
    const discovered = params.discoveredAgentsByName.get(agentName);
    for (const warning of discovered?.warnings ?? []) {
      warnings.add(warning);
    }
  }
  return warnings.size > 0 ? [...warnings] : undefined;
};

const resolveFlowAgentForDiscovery = async (params: {
  agentName: string;
  discoveredAgentsByName: Map<
    string,
    Awaited<ReturnType<typeof discoverAgents>>[number]
  >;
  flowSourceId?: string;
  flowSourceLabel?: string;
  codeInfo2Root: string;
  repos: Array<{ sourceId: string; sourceLabel: string }>;
}) => {
  const validatedAgentType = validateRepositoryBackedAgentType(params.agentName);
  if (!validatedAgentType.ok) {
    return {
      ok: false as const,
      message: `Flow agent "${params.agentName}" ${validatedAgentType.message}.`,
    };
  }

  const ownerRepositoryPath = params.flowSourceId?.trim()
    ? path.resolve(params.flowSourceId)
    : params.codeInfo2Root;
  const ownerRepositoryLabel = params.flowSourceId?.trim()
    ? params.flowSourceLabel
    : normalizeRepositoryCandidateLabel({ sourceId: params.codeInfo2Root });
  const orderedCandidates = buildRepositoryCandidateOrder({
    caller: 'flow-agent-discovery',
    codeInfo2Root: params.codeInfo2Root,
    ownerRepositoryPath,
    ownerRepositoryLabel,
    otherRepositoryRoots: params.repos,
  });

  for (const candidate of orderedCandidates.candidates) {
    const resolvedAgentHome = await resolveAgentHomeForRepository({
      repositoryRoot: candidate.sourceId,
      agentName: validatedAgentType.agentType,
    });
    if (!resolvedAgentHome.home) {
      continue;
    }

    const configPath = path.join(resolvedAgentHome.home, 'config.toml');
    const configStat = await fs.stat(configPath).catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      return error;
    });

    if (configStat instanceof Error) {
      return {
        ok: false as const,
        message: `Flow agent "${params.agentName}" runtime config could not be read.`,
      };
    }
    if (!configStat?.isFile()) {
      continue;
    }

    return {
      ok: true as const,
      configPath,
      warnings: resolvedAgentHome.warnings,
    };
  }

  const discovered = params.discoveredAgentsByName.get(
    validatedAgentType.agentType,
  );
  if (discovered) {
    return {
      ok: true as const,
      configPath: discovered.configPath,
      warnings: discovered.warnings,
    };
  }

  return {
    ok: false as const,
    message: `Flow agent "${params.agentName}" is not available in the configured agent homes.`,
  };
};

const resolveFlowCommandForDiscovery = async (params: {
  flowName: string;
  step: Extract<FlowStep, { type: 'command' }>;
  flowSourceId?: string;
  flowSourceLabel?: string;
  codeInfo2Root: string;
  repos: Array<{ sourceId: string; sourceLabel: string }>;
}) => {
  const validatedAgentType = validateRepositoryBackedAgentType(
    params.step.agentType,
  );
  if (!validatedAgentType.ok) {
    return {
      ok: false as const,
      message: `Flow agent "${params.step.agentType}" ${validatedAgentType.message}.`,
    };
  }
  if (!isSafeCommandName(params.step.commandName)) {
    return {
      ok: false as const,
      message: 'commandName must be a valid file name',
    };
  }

  const ownerRepositoryPath = params.flowSourceId?.trim()
    ? path.resolve(params.flowSourceId)
    : params.codeInfo2Root;
  const ownerRepositoryLabel = params.flowSourceId?.trim()
    ? params.flowSourceLabel
    : normalizeRepositoryCandidateLabel({ sourceId: params.codeInfo2Root });

  const orderedCandidates = buildRepositoryCandidateOrder({
    caller: 'flow-command-discovery',
    codeInfo2Root: params.codeInfo2Root,
    ownerRepositoryPath,
    ownerRepositoryLabel,
    otherRepositoryRoots: params.repos,
  });

  for (const candidate of orderedCandidates.candidates) {
    const resolvedAgentHome = await resolveAgentHomeForRepository({
      repositoryRoot: candidate.sourceId,
      agentName: validatedAgentType.agentType,
    });
    const agentHome =
      resolvedAgentHome.home ??
      path.join(
        candidate.sourceId,
        'codeinfo_agents',
        validatedAgentType.agentType,
      );
    const commandFilePath = path.join(
      agentHome,
      'commands',
      `${params.step.commandName.trim()}.json`,
    );
    const commandStat = await fs.stat(commandFilePath).catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      return error;
    });

    if (commandStat instanceof Error) {
      return {
        ok: false as const,
        message: `Flow command "${params.step.commandName}" for agent "${params.step.agentType}" could not be read.`,
      };
    }
    if (!commandStat?.isFile()) {
      continue;
    }

    const parsed = await loadAgentCommandFile({ filePath: commandFilePath });
    if (!parsed.ok) {
      return {
        ok: false as const,
        message: `Flow command "${params.step.commandName}" for agent "${params.step.agentType}" failed schema validation.`,
      };
    }

    return { ok: true as const };
  }

  return {
    ok: false as const,
    message: `Flow command "${params.step.commandName}" was not found for agent "${params.step.agentType}".`,
  };
};

const collectFlowAvailability = async (params: {
  parsedFlow?: FlowFile;
  discoveredAgentsByName: Map<
    string,
    Awaited<ReturnType<typeof discoverAgents>>[number]
  >;
  availabilityContext: Awaited<
    ReturnType<typeof createAgentAvailabilityContext>
  >;
  codeInfo2Root: string;
  repos: Array<{ sourceId: string; sourceLabel: string }>;
  sourceId?: string;
  sourceLabel?: string;
}) => {
  if (!params.parsedFlow) {
    return {
      warnings: undefined,
      warningDetails: undefined,
      disabledReason: undefined,
    };
  }

  const warnings = new Set<string>();
  const warningDetails: AgentAvailabilityWarning[] = [];
  let disabledReason: AgentDisabledReason | undefined;

  for (const agentName of collectAgentTypes(params.parsedFlow.steps)) {
    const resolvedAgent = await resolveFlowAgentForDiscovery({
      agentName,
      discoveredAgentsByName: params.discoveredAgentsByName,
      flowSourceId: params.sourceId,
      flowSourceLabel: params.sourceLabel,
      codeInfo2Root: params.codeInfo2Root,
      repos: params.repos,
    });
    if (!resolvedAgent.ok) {
      const message = resolvedAgent.message;
      warningDetails.push({
        code: 'discovery_warning',
        message,
        visibility: 'details',
      });
      disabledReason ??= {
        code: 'agent_not_found',
        message,
      };
      continue;
    }

    let availability;
    try {
      availability = await evaluateAgentAvailability({
        agentName,
        configPath: resolvedAgent.configPath,
        discoveryWarnings: resolvedAgent.warnings,
        entrypoint: 'flows.service',
        context: params.availabilityContext,
      });
    } catch (error) {
      const message = `Flow agent "${agentName}" runtime config could not be resolved: ${(error as Error).message}`;
      warningDetails.push({
        code: 'discovery_warning',
        message,
        visibility: 'details',
      });
      disabledReason ??= {
        code: 'agent_not_found',
        message,
      };
      continue;
    }

    for (const warning of toAgentListWarnings(availability)) {
      warnings.add(warning);
    }
    for (const warning of availability.warnings) {
      if (
        !warningDetails.some(
          (entry) =>
            entry.code === warning.code && entry.message === warning.message,
        )
      ) {
        warningDetails.push(warning);
      }
    }

    if (availability.disabledReason && !disabledReason) {
      disabledReason = {
        code: availability.disabledReason.code,
        providerId: availability.disabledReason.providerId,
        message: `Flow agent "${agentName}" is unavailable: ${availability.disabledReason.message}`,
      };
    }
  }

  const commandSteps = collectCommandSteps(params.parsedFlow.steps);
  for (const step of commandSteps) {
    const resolved = await resolveFlowCommandForDiscovery({
      flowName: '(flow)',
      step,
      flowSourceId: params.sourceId,
      flowSourceLabel: params.sourceLabel,
      codeInfo2Root: params.codeInfo2Root,
      repos: params.repos,
    });
    if (resolved.ok) continue;
    warningDetails.push({
      code: 'discovery_warning',
      message: resolved.message,
      visibility: 'details',
    });
    disabledReason ??= {
      code: 'agent_not_found',
      message: resolved.message,
    };
  }

  return {
    warnings: warnings.size > 0 ? [...warnings] : undefined,
    warningDetails: warningDetails.length > 0 ? warningDetails : undefined,
    disabledReason,
  };
};

const collectCommandSteps = (
  steps: FlowStep[],
  collected: Array<Extract<FlowStep, { type: 'command' }>> = [],
) => {
  for (const step of steps) {
    if (step.type === 'command') {
      collected.push(step);
      continue;
    }
    if (step.type === 'if') {
      collectCommandSteps(step.then, collected);
      if (step.else) {
        collectCommandSteps(step.else, collected);
      }
      continue;
    }
    if (step.type === 'startLoop') {
      collectCommandSteps(step.steps, collected);
    }
  }
  return collected;
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
    disabled: Boolean(params.error),
    ...(params.error ? { error: params.error } : {}),
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
  const discoveredAgents = await discoverAgents({ seedAuth: false });
  const discoveredAgentsByName = new Map(
    discoveredAgents.map((agent) => [agent.name, agent]),
  );
  const availabilityContext = await createAgentAvailabilityContext();
  const codeInfo2Root = resolveAgentHomeEnv().codeInfoRoot;

  const listFlowsFromDir = async (params: {
    flowsDir: string;
    repositoryRoot: string;
    sourceId?: string;
    sourceLabel?: string;
    repos: Array<{ sourceId: string; sourceLabel: string }>;
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
      const listWarnings = await collectFlowWarnings({
        parsedFlow: parsed.ok ? parsed.flow : undefined,
        discoveredAgentsByName,
      });
      const availability = await collectFlowAvailability({
        parsedFlow: parsed.ok ? parsed.flow : undefined,
        discoveredAgentsByName,
        availabilityContext,
        codeInfo2Root,
        repos: params.repos,
        sourceId: params.sourceId,
        sourceLabel: params.sourceLabel,
      });
      const mergedWarnings = [
        ...new Set([...(listWarnings ?? []), ...(availability.warnings ?? [])]),
      ];
      const warnings = mergedWarnings.length > 0 ? mergedWarnings : undefined;
      summaries.push(
        buildSummary({
          name,
          parsed,
          error: parsed.ok
            ? availability.disabledReason?.message
            : 'Invalid flow file',
          warnings,
          sourceId: params.sourceId,
          sourceLabel: params.sourceLabel,
        }),
      );
      const latest = summaries[summaries.length - 1];
      if (latest) {
        latest.warningDetails = availability.warningDetails;
        latest.disabledReason = availability.disabledReason;
        if (availability.disabledReason) {
          latest.disabled = true;
        }
      }
    }

    return summaries;
  };

  const localFlows = await listFlowsFromDir({
    flowsDir,
    repositoryRoot: resolveFlowAgentLookupRoot(flowsDir),
    repos: [],
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
    const normalizedRepos = ingestRoots.map((repo) => ({
      sourceId: path.resolve(repo.containerPath),
      sourceLabel:
        repo.id?.trim() ||
        path.posix.basename(repo.containerPath.replace(/\\/g, '/')),
    }));
    const ingestResults = await Promise.all(
      ingestRoots.map(async (repo) => {
        const sourceId = repo.containerPath;
        const sourceLabel =
          repo.id?.trim() || path.posix.basename(sourceId.replace(/\\/g, '/'));
        if (!sourceLabel) return [];
        appendRepoBackedTransitiveConsumerLogs({
          consumer: 'flows.discovery',
          subjectKind: 'repository',
          subjectId: repo.containerPath,
          sourceId,
          containerPath: repo.containerPath,
          repoIdentity: resolveRepoEmbeddingIdentity(repo),
        });
        const flowsRoot = path.join(sourceId, 'flows');
        return await listFlowsFromDir({
          flowsDir: flowsRoot,
          repositoryRoot: sourceId,
          sourceId,
          sourceLabel,
          repos: normalizedRepos,
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
