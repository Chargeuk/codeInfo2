import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import {
  parseCopilotReviewModels,
  resolveCopilotReviewModels,
  type CopilotReviewAvailabilityDeps,
  type CopilotReviewConfigurationWarning,
  type ResolvedCopilotReviewSpec,
} from './copilotReviewModels.js';
import {
  parseFlowSubflowWaveGroups,
  type FlowSubflowWaveStep,
} from './flowSchema.js';
import type { FlowJsonValue } from './types.js';

export type PreparedCopilotReviewGroups = {
  effectiveReviewGroups: NonNullable<FlowSubflowWaveStep['groups']>;
  resolvedSpecs: ResolvedCopilotReviewSpec[];
  repositoryCount: number;
  modelCount: number;
  copilotJobCount: number;
  configurationWarnings: CopilotReviewConfigurationWarning[];
};

const displayLabel = (spec: ResolvedCopilotReviewSpec): string => {
  const identity =
    spec.mode === 'external'
      ? `${spec.endpointLabel}/${spec.modelId}`
      : spec.modelId;
  return `Copilot: ${identity} (${spec.reasoningEffort})`;
};

export async function prepareCopilotReviewGroups(
  params: {
    reviewGroups: FlowJsonValue;
    repositoryTargets: FlowJsonValue;
    targetItemsFrom: string;
    reviewWaveFrom: string;
    env?: NodeJS.ProcessEnv;
  },
  deps: Partial<CopilotReviewAvailabilityDeps> = {},
): Promise<PreparedCopilotReviewGroups> {
  const existingGroups = parseFlowSubflowWaveGroups(params.reviewGroups);
  if (!Array.isArray(params.repositoryTargets)) {
    throw new Error(
      'prepareCopilotReviewGroups repository targets must resolve to an array.',
    );
  }
  const env = params.env ?? process.env;
  const configurationWarnings: CopilotReviewConfigurationWarning[] = [];
  const parsed = parseCopilotReviewModels(env.CODEINFO_COPILOT_REVIEW_MODELS, {
    onWarning: (warning) => configurationWarnings.push(warning),
  });
  const resolvedSpecs = await resolveCopilotReviewModels(parsed, {
    env,
    deps,
  });
  for (const warning of configurationWarnings) {
    const context = {
      entryNumber: warning.entryNumber,
      warningCode: warning.code,
      duplicateOfEntryNumber: warning.duplicateOfEntryNumber,
    };
    append({
      level: 'warn',
      message: 'flows.copilot_review_matrix.configuration_warning',
      timestamp: new Date().toISOString(),
      source: 'server',
      context,
    });
    baseLogger.warn(
      context,
      'flows.copilot_review_matrix.configuration_warning',
    );
  }
  for (const spec of resolvedSpecs.filter(
    (candidate) => !candidate.available,
  )) {
    const context = {
      stableId: spec.stableId,
      mode: spec.mode,
      endpointLabel: spec.endpointLabel,
      unavailableReason: spec.unavailableReason,
    };
    append({
      level: 'warn',
      message: 'flows.copilot_review_matrix.model_unavailable',
      timestamp: new Date().toISOString(),
      source: 'server',
      context,
    });
    baseLogger.warn(context, 'flows.copilot_review_matrix.model_unavailable');
  }
  const copilotGroups = resolvedSpecs.map(
    (spec): NonNullable<FlowSubflowWaveStep['groups']>[number] => ({
      kind: 'matrix',
      id: `copilot-${spec.stableId}`,
      displayName: displayLabel(spec),
      itemsFrom: params.targetItemsFrom,
      itemName: 'target',
      flowNames: ['copilot_review'],
      bindings: {
        workingFolderFrom: 'target.repo_root',
        input: {
          target: 'target',
          review_wave: params.reviewWaveFrom,
        },
        inputValues: {
          copilot_review_spec: spec,
        },
      },
    }),
  );
  const effectiveReviewGroups = [...existingGroups, ...copilotGroups];
  const repositoryCount = params.repositoryTargets.length;
  const modelCount = resolvedSpecs.length;
  const copilotJobCount = repositoryCount * modelCount;
  const context = {
    repositoryCount,
    modelCount,
    copilotJobCount,
    configurationWarningCount: configurationWarnings.length,
    availableModelCount: resolvedSpecs.filter((spec) => spec.available).length,
  };
  append({
    level: 'info',
    message: 'flows.copilot_review_matrix.prepared',
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
  baseLogger.info(context, 'flows.copilot_review_matrix.prepared');

  return {
    effectiveReviewGroups,
    resolvedSpecs,
    repositoryCount,
    modelCount,
    copilotJobCount,
    configurationWarnings,
  };
}
