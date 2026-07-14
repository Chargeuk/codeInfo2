import { z } from 'zod';

import { append } from '../logStore.js';

append({
  level: 'info',
  message: 'flows.schema.loaded',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: { module: 'flows' },
});

const trimmedNonEmptyString = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0);

export type FlowMessage = {
  role: 'user';
  content: string[];
};

export type FlowStartLoopStep = {
  type: 'startLoop';
  label?: string;
  steps: FlowStep[];
};

export type FlowLlmStep = {
  type: 'llm';
  label?: string;
  agentType: string;
  identifier: string;
} & ({ messages: FlowMessage[] } | { markdownFile: string });

export type FlowBreakStep = {
  type: 'break';
  label?: string;
  agentType: string;
  identifier: string;
  question: string;
  breakOn: 'yes' | 'no';
};

export type FlowContinueStep = {
  type: 'continue';
  label?: string;
  agentType: string;
  identifier: string;
  question: string;
  continueOn: 'yes' | 'no';
};

export type FlowCommandStep = {
  type: 'command';
  label?: string;
  agentType: string;
  identifier: string;
  commandName: string;
};

export type FlowResetStep = {
  type: 'reset';
  label?: string;
  agentType: string;
  identifier: string;
};

export type FlowPrepareReviewBaseStep = {
  type: 'prepareReviewBase';
  label?: string;
  outputKey: string;
  basePolicy?: 'branched_from_or_default_if_merged';
  initializeReviewPointers?: boolean;
};

export type FlowCodexReviewStep = {
  type: 'codexReview';
  label?: string;
  outputKey: string;
  basePolicy?: 'branched_from_or_default_if_merged';
  modelSource?: 'flow_request_or_step' | 'flow_request_or_step_or_agent';
  agentType?: string;
  model?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};

export type FlowValidateReviewArtifactsStep = {
  type: 'validateReviewArtifacts';
  label?: string;
  pointerKeys: string[];
};

export type FlowSubflowStep = {
  type: 'subflow';
  label?: string;
  flowNames: string[];
};

export type FlowReingestStep = {
  type: 'reingest';
  label?: string;
} & ({ sourceId: string } | { target: 'working' | 'plan_scope' });

/** Story 60: conditional if step with then/else branches */
export type FlowIfStep = {
  type: 'if';
  label?: string;
  agentType?: string;
  identifier?: string;
  condition: string;
  then: FlowStep[];
  else?: FlowStep[];
};

/** Story 60: persisted timed wait step */
export type FlowWaitStep = {
  type: 'wait';
  label?: string;
  seconds: number;
};

/** Story 60: thin GitHub PR open step */
export type FlowGitHubOpenPrStep = {
  type: 'github_open_pr';
  label?: string;
};

/** Story 60: thin GitHub PR fetch-reviews step */
export type FlowGitHubFetchReviewsStep = {
  type: 'github_fetch_reviews';
  label?: string;
};

/** Story 60: thin GitHub PR close step */
export type FlowGitHubClosePrStep = {
  type: 'github_close_pr';
  label?: string;
};

export type FlowStep =
  | FlowStartLoopStep
  | FlowLlmStep
  | FlowBreakStep
  | FlowContinueStep
  | FlowCommandStep
  | FlowResetStep
  | FlowPrepareReviewBaseStep
  | FlowCodexReviewStep
  | FlowValidateReviewArtifactsStep
  | FlowSubflowStep
  | FlowReingestStep
  | FlowIfStep
  | FlowWaitStep
  | FlowGitHubOpenPrStep
  | FlowGitHubFetchReviewsStep
  | FlowGitHubClosePrStep;

export type FlowFile = {
  description?: string;
  steps: FlowStep[];
};

const FlowMessageSchema: z.ZodTypeAny = z
  .object({
    role: z.literal('user'),
    content: z.array(trimmedNonEmptyString).min(1),
  })
  .strict();

const FlowStepSchema: z.ZodTypeAny = z.lazy(() => flowStepUnionSchema());

const FlowStartLoopStepSchema = z
  .object({
    type: z.literal('startLoop'),
    label: trimmedNonEmptyString.optional(),
    steps: z.array(z.lazy(() => FlowStepSchema)).min(1),
  })
  .strict();

const FlowLlmStepSchema = z
  .object({
    type: z.literal('llm'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    messages: z.array(FlowMessageSchema).min(1).optional(),
    markdownFile: trimmedNonEmptyString.optional(),
  })
  .strict();

const FlowBreakStepSchema = z
  .object({
    type: z.literal('break'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    question: trimmedNonEmptyString,
    breakOn: z.union([z.literal('yes'), z.literal('no')]),
  })
  .strict();

const FlowContinueStepSchema = z
  .object({
    type: z.literal('continue'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    question: trimmedNonEmptyString,
    continueOn: z.union([z.literal('yes'), z.literal('no')]),
  })
  .strict();

const FlowCommandStepSchema = z
  .object({
    type: z.literal('command'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    commandName: trimmedNonEmptyString,
  })
  .strict();

const FlowResetStepSchema = z
  .object({
    type: z.literal('reset'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
  })
  .strict();

const FlowPrepareReviewBaseStepSchema = z
  .object({
    type: z.literal('prepareReviewBase'),
    label: trimmedNonEmptyString.optional(),
    outputKey: trimmedNonEmptyString,
    basePolicy: z.literal('branched_from_or_default_if_merged').optional(),
    initializeReviewPointers: z.boolean().optional(),
  })
  .strict();

const FlowCodexReviewStepSchema = z
  .object({
    type: z.literal('codexReview'),
    label: trimmedNonEmptyString.optional(),
    outputKey: trimmedNonEmptyString,
    basePolicy: z.literal('branched_from_or_default_if_merged').optional(),
    modelSource: z
      .enum(['flow_request_or_step', 'flow_request_or_step_or_agent'])
      .optional(),
    agentType: trimmedNonEmptyString.optional(),
    model: trimmedNonEmptyString.optional(),
    reasoningEffort: z
      .enum(['minimal', 'low', 'medium', 'high', 'xhigh'])
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.modelSource === 'flow_request_or_step_or_agent' &&
      !value.agentType
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agentType'],
        message:
          'agentType is required when modelSource is flow_request_or_step_or_agent',
      });
    }
    if (
      value.agentType &&
      value.modelSource !== 'flow_request_or_step_or_agent'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modelSource'],
        message:
          'modelSource must be flow_request_or_step_or_agent when agentType is set',
      });
    }
  });

const FlowValidateReviewArtifactsStepSchema = z
  .object({
    type: z.literal('validateReviewArtifacts'),
    label: trimmedNonEmptyString.optional(),
    pointerKeys: z.array(trimmedNonEmptyString).min(2),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.pointerKeys.forEach((pointerKey, index) => {
      if (seen.has(pointerKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pointerKeys', index],
          message: `Duplicate review pointer key "${pointerKey}" is not allowed.`,
        });
      }
      seen.add(pointerKey);
    });
  });

const FlowSubflowStepSchema = z
  .object({
    type: z.literal('subflow'),
    label: trimmedNonEmptyString.optional(),
    flowNames: z.array(trimmedNonEmptyString).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.flowNames.forEach((flowName, index) => {
      if (!seen.has(flowName)) {
        seen.add(flowName);
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['flowNames', index],
        message: `Duplicate subflow name "${flowName}" is not allowed.`,
      });
    });
  });

const FlowReingestSourceIdStepSchema = z
  .object({
    type: z.literal('reingest'),
    label: trimmedNonEmptyString.optional(),
    sourceId: trimmedNonEmptyString,
  })
  .strict();

const FlowReingestWorkingTargetStepSchema = z
  .object({
    type: z.literal('reingest'),
    label: trimmedNonEmptyString.optional(),
    target: z.literal('working'),
  })
  .strict();

const FlowReingestPlanScopeTargetStepSchema = z
  .object({
    type: z.literal('reingest'),
    label: trimmedNonEmptyString.optional(),
    target: z.literal('plan_scope'),
  })
  .strict();

// Story 60: if step schema
const FlowIfStepSchema = z
  .object({
    type: z.literal('if'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString.optional(),
    identifier: trimmedNonEmptyString.optional(),
    condition: trimmedNonEmptyString,
    then: z.array(z.lazy(() => FlowStepSchema)).min(1),
    else: z.array(z.lazy(() => FlowStepSchema)).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAgentType = typeof value.agentType === 'string';
    const hasIdentifier = typeof value.identifier === 'string';
    if (hasAgentType !== hasIdentifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'if steps must provide both agentType and identifier together.',
      });
    }
  });

// Story 60: wait step schema – positive whole seconds within one safe Node timer.
export const MAX_FLOW_WAIT_SECONDS = 2_147_483;
const FlowWaitStepSchema = z
  .object({
    type: z.literal('wait'),
    label: trimmedNonEmptyString.optional(),
    seconds: z.number().int().positive().max(MAX_FLOW_WAIT_SECONDS),
  })
  .strict();

// Story 60: GitHub PR step schemas
const FlowGitHubOpenPrStepSchema = z
  .object({
    type: z.literal('github_open_pr'),
    label: trimmedNonEmptyString.optional(),
  })
  .strict();

const FlowGitHubFetchReviewsStepSchema = z
  .object({
    type: z.literal('github_fetch_reviews'),
    label: trimmedNonEmptyString.optional(),
  })
  .strict();

const FlowGitHubClosePrStepSchema = z
  .object({
    type: z.literal('github_close_pr'),
    label: trimmedNonEmptyString.optional(),
  })
  .strict();

function flowStepUnionSchema() {
  return z.union([
    FlowStartLoopStepSchema,
    FlowLlmStepSchema,
    FlowBreakStepSchema,
    FlowContinueStepSchema,
    FlowCommandStepSchema,
    FlowResetStepSchema,
    FlowPrepareReviewBaseStepSchema,
    FlowCodexReviewStepSchema,
    FlowValidateReviewArtifactsStepSchema,
    FlowSubflowStepSchema,
    FlowReingestSourceIdStepSchema,
    FlowReingestWorkingTargetStepSchema,
    FlowReingestPlanScopeTargetStepSchema,
    FlowIfStepSchema,
    FlowWaitStepSchema,
    FlowGitHubOpenPrStepSchema,
    FlowGitHubFetchReviewsStepSchema,
    FlowGitHubClosePrStepSchema,
  ]);
}

function emitReingestTargetContractLogs(params: {
  flowName: string;
  raw: unknown;
  parsedOk: boolean;
}) {
  if (
    !params.parsedOk &&
    typeof params.raw === 'object' &&
    params.raw !== null
  ) {
    const steps = (params.raw as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) return;

    for (const [stepIndex, step] of steps.entries()) {
      if (typeof step !== 'object' || step === null) continue;
      const target = (step as { target?: unknown; type?: unknown }).target;
      const type = (step as { target?: unknown; type?: unknown }).type;
      if (type === 'reingest' && (target === 'current' || target === 'all')) {
        append({
          level: 'info',
          message: 'DEV-0000052:T1:reingest-target-contract',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            surface: 'flow',
            definitionName: params.flowName,
            definitionIndex: stepIndex,
            outcome: 'rejected_removed_target',
            removedTarget: target,
          },
        });
      }
    }
    return;
  }

  if (
    !params.parsedOk ||
    typeof params.raw !== 'object' ||
    params.raw === null ||
    !Array.isArray((params.raw as { steps?: unknown }).steps)
  ) {
    return;
  }

  const steps = (params.raw as { steps: unknown[] }).steps;
  for (const [stepIndex, step] of steps.entries()) {
    if (typeof step !== 'object' || step === null) continue;
    const target = (step as { target?: unknown; type?: unknown }).target;
    const type = (step as { target?: unknown; type?: unknown }).type;
    if (
      type === 'reingest' &&
      (target === 'working' || target === 'plan_scope')
    ) {
      append({
        level: 'info',
        message: 'DEV-0000052:T1:reingest-target-contract',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          surface: 'flow',
          definitionName: params.flowName,
          definitionIndex: stepIndex,
          outcome: 'accepted_supported_target',
          supportedTarget: target,
        },
      });
    }
  }
}

const FlowFileSchema = z
  .object({
    description: trimmedNonEmptyString.optional(),
    steps: z.array(FlowStepSchema),
  })
  .strict()
  .superRefine((flow, ctx) => {
    const validateSteps = (
      steps: FlowStep[],
      pathPrefix: Array<string | number>,
    ) => {
      steps.forEach((step, index) => {
        const stepPath = [...pathPrefix, index];
        if (step.type === 'startLoop') {
          validateSteps(step.steps, [...stepPath, 'steps']);
          return;
        }
        if (step.type !== 'llm') return;

        const hasMessages = 'messages' in step && Array.isArray(step.messages);
        const hasMarkdownFile =
          'markdownFile' in step && typeof step.markdownFile === 'string';
        if (hasMessages === hasMarkdownFile) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'llm steps must provide exactly one instruction source: messages or markdownFile',
            path: stepPath,
          });
        }
      });
    };

    validateSteps(flow.steps, ['steps']);
  });

export function parseFlowFile(
  jsonText: string,
  metadata?: { flowName?: string; emitSchemaParseLogs?: boolean },
): { ok: true; flow: FlowFile } | { ok: false } {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false };
  }

  const parsed = FlowFileSchema.safeParse(raw);
  if (metadata?.emitSchemaParseLogs) {
    emitReingestTargetContractLogs({
      flowName: metadata.flowName?.trim() || '(unknown)',
      raw,
      parsedOk: parsed.success,
    });
  }
  if (!parsed.success) return { ok: false };

  if (metadata?.emitSchemaParseLogs) {
    const flowName = metadata.flowName?.trim() || '(unknown)';
    for (const [stepIndex, step] of parsed.data.steps.entries()) {
      if (step.type !== 'llm' && step.type !== 'reingest') continue;
      const instructionSource =
        step.type === 'llm'
          ? Array.isArray(step.messages)
            ? 'messages'
            : 'markdownFile'
          : 'reingest';
      append({
        level: 'info',
        message: 'DEV-0000045:T2:flow_schema_step_parsed',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          flowName,
          stepIndex: stepIndex + 1,
          stepType: step.type,
          label: step.label ?? null,
          instructionSource,
        },
      });
    }
  }

  return { ok: true, flow: parsed.data };
}
