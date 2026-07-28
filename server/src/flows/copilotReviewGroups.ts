import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import {
  parseFlowSubflowWaveGroups,
  type FlowSubflowWaveStep,
} from './flowSchema.js';
import {
  parseCopilotReviewModels,
  resolveCopilotReviewModels,
  type CopilotReviewAvailabilityDeps,
  type ResolvedCopilotReviewSpec,
} from './copilotReviewModels.js';
import type { FlowJsonValue } from './types.js';

export type PreparedCopilotReviewGroups = {
  effectiveReviewGroups: NonNullable<FlowSubflowWaveStep['groups']>;
  resolvedSpecs: ResolvedCopilotReviewSpec[];
  repositoryCount: number;
  modelCount: number;
  copilotJobCount: number;
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
  const parsed = parseCopilotReviewModels(env.CODEINFO_COPILOT_REVIEW_MODELS);
  const resolvedSpecs = await resolveCopilotReviewModels(parsed, {
    env,
    deps,
  });
  const copilotGroups = resolvedSpecs.map(
    (spec): NonNullable<FlowSubflowWaveStep['groups']>[number] => ({
      kind: 'matrix',
      id: `copilot-${spec.stableId}`,
      displayName: displayLabel(spec),
      itemsFrom: 'review_batch_targets.targets',
      itemName: 'target',
      flowNames: ['copilot_review'],
      bindings: {
        workingFolderFrom: 'target.repo_root',
        input: {
          target: 'target',
          review_wave: 'review_batch_targets',
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
  };
}
