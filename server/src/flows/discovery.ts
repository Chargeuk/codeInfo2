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
import {
  getFlowDefinitionCatalog,
  resolveConfiguredFlowsRoot,
  type FlowDefinitionCatalog,
} from './flowDefinitionCatalog.js';
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

const isSafeCommandName = (raw: string): boolean => {
  const trimmed = raw.trim();
  return (
    trimmed.length > 0 &&
    trimmed === path.posix.basename(trimmed) &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  );
};

const isSafeFlowName = (raw: string): boolean => {
  const trimmed = raw.trim();
  return (
    trimmed.length > 0 &&
    trimmed === path.posix.basename(trimmed) &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\') &&
    !trimmed.includes('..')
  );
};

const resolveSafeChildFlowPath = (
  flowsDir: string,
  flowName: string,
): string => {
  if (!isSafeFlowName(flowName)) {
    throw new Error(`Subflow name "${flowName}" must be a valid flow name.`);
  }
  const resolvedFlowsDir = path.resolve(flowsDir);
  const childFlowPath = path.resolve(resolvedFlowsDir, `${flowName}.json`);
  const relativePath = path.relative(resolvedFlowsDir, childFlowPath);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Subflow name "${flowName}" must stay within flowsDir.`);
  }
  return childFlowPath;
};

const resolveFlowsDir = (baseDir?: string): string => {
  if (baseDir) return path.resolve(baseDir);
  return resolveConfiguredFlowsRoot();
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

const appendDiscoveryWarning = (params: {
  warnings: Set<string>;
  warningDetails: AgentAvailabilityWarning[];
  message: string;
  code?: AgentAvailabilityWarning['code'];
  providerId?: AgentAvailabilityWarning['providerId'];
}) => {
  params.warnings.add(params.message);
  if (
    params.warningDetails.some(
      (entry) =>
        entry.code === (params.code ?? 'discovery_warning') &&
        entry.message === params.message &&
        entry.providerId === params.providerId,
    )
  ) {
    return;
  }
  params.warningDetails.push({
    code: params.code ?? 'discovery_warning',
    message: params.message,
    visibility: 'details',
    ...(params.providerId ? { providerId: params.providerId } : {}),
  });
};

const collectSubflowReferenceWarnings = async (params: {
  flowName: string;
  steps: FlowStep[];
  flowsDir: string;
  catalog: FlowDefinitionCatalog;
  warnings?: Set<string>;
  warningDetails?: AgentAvailabilityWarning[];
  visited?: Set<string>;
}) => {
  const warnings = params.warnings ?? new Set<string>();
  const warningDetails = params.warningDetails ?? [];
  const visited = params.visited ?? new Set<string>();
  visited.add(params.flowName);

  for (const step of params.steps) {
    if (step.type === 'startLoop') {
      await collectSubflowReferenceWarnings({
        flowName: params.flowName,
        steps: step.steps,
        flowsDir: params.flowsDir,
        catalog: params.catalog,
        warnings,
        warningDetails,
        visited,
      });
      continue;
    }
    if (step.type !== 'subflow') {
      continue;
    }

    for (const childFlowName of step.flowNames) {
      if (visited.has(childFlowName)) {
        continue;
      }
      try {
        resolveSafeChildFlowPath(params.flowsDir, childFlowName);
      } catch (error) {
        appendDiscoveryWarning({
          warnings,
          warningDetails,
          message: error instanceof Error ? error.message : 'Invalid flow file',
        });
        continue;
      }
      const childFlow = params.catalog.get(childFlowName);
      if (!childFlow) {
        appendDiscoveryWarning({
          warnings,
          warningDetails,
          message: `Subflow "${childFlowName}" could not be read.`,
        });
        continue;
      }
      if (!childFlow.parsed?.ok) {
        appendDiscoveryWarning({
          warnings,
          warningDetails,
          message: `Subflow "${childFlowName}" is invalid.`,
        });
        continue;
      }
      await collectSubflowReferenceWarnings({
        flowName: childFlowName,
        steps: childFlow.parsed.flow.steps,
        flowsDir: params.flowsDir,
        catalog: params.catalog,
        warnings,
        warningDetails,
        visited: new Set(visited).add(childFlowName),
      });
    }
  }

  return { warnings, warningDetails };
};

const collectAgentTypes = (params: {
  flowName: string;
  steps: FlowStep[];
  flowsDir: string;
  names?: Set<string>;
}) => {
  const names = params.names ?? new Set<string>();

  for (const step of params.steps) {
    switch (step.type) {
      case 'llm':
      case 'break':
      case 'continue':
      case 'command':
        names.add(step.agentType);
        break;
      case 'startLoop':
        collectAgentTypes({
          flowName: params.flowName,
          steps: step.steps,
          flowsDir: params.flowsDir,
          names,
        });
        break;
      default:
        break;
    }
  }
  return names;
};

const collectFlowWarnings = async (params: {
  flowName: string;
  flowsDir: string;
  parsedFlow?: FlowFile;
  discoveredAgentsByName: Map<
    string,
    Awaited<ReturnType<typeof discoverAgents>>[number]
  >;
}) => {
  if (!params.parsedFlow) return undefined;
  const warnings = new Set<string>();
  for (const agentName of collectAgentTypes({
    flowName: params.flowName,
    steps: params.parsedFlow.steps,
    flowsDir: params.flowsDir,
  })) {
    const discovered = params.discoveredAgentsByName.get(agentName);
    for (const warning of discovered?.warnings ?? []) {
      warnings.add(warning);
    }
  }
  return warnings.size > 0 ? [...warnings] : undefined;
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
  flowName: string;
  flowsDir: string;
  codeInfo2Root: string;
  repos: Array<{ sourceId: string; sourceLabel: string }>;
  sourceId?: string;
  sourceLabel?: string;
  catalog: FlowDefinitionCatalog;
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

  for (const agentName of collectAgentTypes({
    flowName: params.flowName,
    steps: params.parsedFlow.steps,
    flowsDir: params.flowsDir,
  })) {
    const validatedAgentType = validateRepositoryBackedAgentType(agentName);
    if (!validatedAgentType.ok) {
      const message = `Flow agent "${agentName}" ${validatedAgentType.message}.`;
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

    const discovered = params.discoveredAgentsByName.get(agentName);
    if (!discovered) {
      const message = `Flow agent "${agentName}" is not available in the configured agent homes.`;
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
        configPath: discovered.configPath,
        discoveryWarnings: discovered.warnings,
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

  const commandSteps = collectCommandSteps({
    flowName: params.flowName,
    steps: params.parsedFlow.steps,
    flowsDir: params.flowsDir,
  });
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

  const subflowWarnings = await collectSubflowReferenceWarnings({
    flowName: params.flowName,
    steps: params.parsedFlow.steps,
    flowsDir: params.flowsDir,
    catalog: params.catalog,
  });
  for (const warning of subflowWarnings.warnings) {
    warnings.add(warning);
  }
  for (const warning of subflowWarnings.warningDetails) {
    if (
      !warningDetails.some(
        (entry) =>
          entry.code === warning.code &&
          entry.message === warning.message &&
          entry.providerId === warning.providerId,
      )
    ) {
      warningDetails.push(warning);
    }
  }

  return {
    warnings: warnings.size > 0 ? [...warnings] : undefined,
    warningDetails: warningDetails.length > 0 ? warningDetails : undefined,
    disabledReason,
  };
};

const collectCommandSteps = (params: {
  flowName: string;
  steps: FlowStep[];
  flowsDir: string;
}): Array<Extract<FlowStep, { type: 'command' }>> => {
  const collected: Array<Extract<FlowStep, { type: 'command' }>> = [];

  for (const step of params.steps) {
    if (step.type === 'command') {
      collected.push(step);
      continue;
    }
    if (step.type === 'startLoop') {
      collected.push(
        ...collectCommandSteps({
          flowName: params.flowName,
          steps: step.steps,
          flowsDir: params.flowsDir,
        }),
      );
      continue;
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
    const catalog = await getFlowDefinitionCatalog(params.flowsDir);

    const summaries: FlowSummary[] = [];
    for (const entry of catalog.values()) {
      const name = entry.name;
      if (!entry.parsed) {
        summaries.push(
          buildSummary({
            name,
            parsed: null,
            error: entry.readError ?? 'Unable to read flow file',
            sourceId: params.sourceId,
            sourceLabel: params.sourceLabel,
          }),
        );
        continue;
      }

      const parsed = entry.parsed;
      let listWarnings: string[] | undefined;
      let availability:
        | Awaited<ReturnType<typeof collectFlowAvailability>>
        | undefined;
      let discoveryError: string | undefined;
      try {
        listWarnings = await collectFlowWarnings({
          flowName: name,
          flowsDir: params.flowsDir,
          parsedFlow: parsed.ok ? parsed.flow : undefined,
          discoveredAgentsByName,
        });
        availability = await collectFlowAvailability({
          parsedFlow: parsed.ok ? parsed.flow : undefined,
          discoveredAgentsByName,
          availabilityContext,
          flowName: name,
          flowsDir: params.flowsDir,
          codeInfo2Root,
          repos: params.repos,
          sourceId: params.sourceId,
          sourceLabel: params.sourceLabel,
          catalog,
        });
      } catch (error) {
        discoveryError =
          error instanceof Error ? error.message : 'Invalid flow file';
      }
      const resolvedAvailability = availability ?? {
        warnings: undefined,
        warningDetails: undefined,
        disabledReason: discoveryError
          ? {
              code: 'agent_not_found' as const,
              message: discoveryError,
            }
          : undefined,
      };
      const mergedWarnings = [
        ...new Set([
          ...(listWarnings ?? []),
          ...(resolvedAvailability.warnings ?? []),
        ]),
      ];
      const warnings = mergedWarnings.length > 0 ? mergedWarnings : undefined;
      summaries.push(
        buildSummary({
          name,
          parsed,
          error: parsed.ok
            ? (discoveryError ?? resolvedAvailability.disabledReason?.message)
            : 'Invalid flow file',
          warnings,
          sourceId: params.sourceId,
          sourceLabel: params.sourceLabel,
        }),
      );
      const latest = summaries[summaries.length - 1];
      if (latest) {
        latest.warningDetails = resolvedAvailability.warningDetails;
        latest.disabledReason = resolvedAvailability.disabledReason;
        if (resolvedAvailability.disabledReason) {
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
