import { z } from 'zod';

import { append } from '../logStore.js';
import type { FlowJsonValue } from './types.js';

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
  maxIterations?: number;
  steps: FlowStep[];
};

export type FlowLlmStep = {
  type: 'llm';
  label?: string;
  agentType: string;
  identifier: string;
  continueOnFailure?: boolean;
} & ({ messages: FlowMessage[] } | { markdownFile: string });

export type FlowBreakStep = {
  type: 'break';
  label?: string;
  agentType: string;
  identifier: string;
  question: string;
  breakOn: 'yes' | 'no';
  breakOnFailure?: boolean;
  haltFlow?: boolean;
  exitFlow?: boolean;
  decisionScript?: string;
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

export type FlowInitializeReviewCycleStep = {
  type: 'initializeReviewCycle';
  label?: string;
  mode: 'final' | 'diagnostic';
  outputKey: string;
};

export type FlowPrepareReviewTargetsStep = {
  type: 'prepareReviewTargets';
  label?: string;
  outputKey: string;
};

export type FlowSubflowStep = {
  type: 'subflow';
  label?: string;
  flowNames: string[];
};

export type FlowSubflowWaveBindings = {
  workingFolderFrom?: string;
  input?: Record<string, string>;
  inputValues?: Record<string, FlowJsonValue>;
};

export type FlowSubflowWaveMatrixGroup = {
  kind: 'matrix';
  id: string;
  itemsFrom: string;
  itemName: string;
  flowNames: string[];
  bindings?: FlowSubflowWaveBindings;
};

export type FlowSubflowWaveSingletonGroup = {
  kind: 'singleton';
  id: string;
  flowName: string;
  bindings?: FlowSubflowWaveBindings;
};

export type FlowSubflowWaveStep = {
  type: 'subflowWave';
  label?: string;
  groups?: Array<FlowSubflowWaveMatrixGroup | FlowSubflowWaveSingletonGroup>;
  groupsFrom?: string;
  failureMode?: 'best_effort';
  reviewWorkspace?: {
    snapshotFrom: string;
  };
};

export type FlowReingestStep = {
  type: 'reingest';
  label?: string;
} & ({ sourceId: string } | { target: 'working' | 'plan_scope' });

export type FlowStep =
  | FlowStartLoopStep
  | FlowLlmStep
  | FlowBreakStep
  | FlowContinueStep
  | FlowCommandStep
  | FlowResetStep
  | FlowInitializeReviewCycleStep
  | FlowPrepareReviewTargetsStep
  | FlowSubflowStep
  | FlowSubflowWaveStep
  | FlowReingestStep;

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
    maxIterations: z.number().int().positive().optional(),
    steps: z.array(z.lazy(() => FlowStepSchema)).min(1),
  })
  .strict();

const FlowLlmStepSchema = z
  .object({
    type: z.literal('llm'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    continueOnFailure: z.boolean().optional(),
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
    breakOnFailure: z.boolean().optional(),
    haltFlow: z.boolean().optional(),
    exitFlow: z.boolean().optional(),
    decisionScript: trimmedNonEmptyString.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.haltFlow && value.exitFlow) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exitFlow'],
        message: 'break steps cannot set both haltFlow and exitFlow.',
      });
    }
  });

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

const FlowInitializeReviewCycleStepSchema = z
  .object({
    type: z.literal('initializeReviewCycle'),
    label: trimmedNonEmptyString.optional(),
    mode: z.enum(['final', 'diagnostic']),
    outputKey: trimmedNonEmptyString,
  })
  .strict();

const FlowPrepareReviewTargetsStepSchema = z
  .object({
    type: z.literal('prepareReviewTargets'),
    label: trimmedNonEmptyString.optional(),
    outputKey: trimmedNonEmptyString,
  })
  .strict();

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

const flowWaveIdentifier = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/u);
const flowWaveBindingPath = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u);

const FlowJsonValueSchema: z.ZodType<FlowJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(FlowJsonValueSchema),
    z.record(z.string(), FlowJsonValueSchema),
  ]),
);

const FlowSubflowWaveBindingsSchema = z
  .object({
    workingFolderFrom: flowWaveBindingPath.optional(),
    input: z.record(flowWaveIdentifier, flowWaveBindingPath).optional(),
    inputValues: z.record(flowWaveIdentifier, FlowJsonValueSchema).optional(),
  })
  .strict();

const FlowSubflowWaveMatrixGroupSchema = z
  .object({
    kind: z.literal('matrix'),
    id: flowWaveIdentifier,
    itemsFrom: flowWaveBindingPath,
    itemName: flowWaveIdentifier,
    flowNames: z.array(trimmedNonEmptyString).min(1),
    bindings: FlowSubflowWaveBindingsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.flowNames.forEach((flowName, index) => {
      if (seen.has(flowName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['flowNames', index],
          message: `Duplicate wave subflow name "${flowName}" is not allowed.`,
        });
      }
      seen.add(flowName);
    });
  });

const FlowSubflowWaveSingletonGroupSchema = z
  .object({
    kind: z.literal('singleton'),
    id: flowWaveIdentifier,
    flowName: trimmedNonEmptyString,
    bindings: FlowSubflowWaveBindingsSchema.optional(),
  })
  .strict();

const FlowSubflowWaveStepSchema = z
  .object({
    type: z.literal('subflowWave'),
    label: trimmedNonEmptyString.optional(),
    groups: z
      .array(
        z.union([
          FlowSubflowWaveMatrixGroupSchema,
          FlowSubflowWaveSingletonGroupSchema,
        ]),
      )
      .min(1)
      .optional(),
    groupsFrom: flowWaveBindingPath.optional(),
    failureMode: z.literal('best_effort').optional(),
    reviewWorkspace: z
      .object({ snapshotFrom: trimmedNonEmptyString })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Boolean(value.groups) === Boolean(value.groupsFrom)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groups'],
        message: 'subflowWave requires exactly one of groups or groupsFrom.',
      });
    }
    const seen = new Set<string>();
    (value.groups ?? []).forEach((group, index) => {
      if (seen.has(group.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['groups', index, 'id'],
          message: `Duplicate wave group id "${group.id}" is not allowed.`,
        });
      }
      seen.add(group.id);
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

function flowStepUnionSchema() {
  return z.union([
    FlowStartLoopStepSchema,
    FlowLlmStepSchema,
    FlowBreakStepSchema,
    FlowContinueStepSchema,
    FlowCommandStepSchema,
    FlowResetStepSchema,
    FlowInitializeReviewCycleStepSchema,
    FlowPrepareReviewTargetsStepSchema,
    FlowSubflowStepSchema,
    FlowSubflowWaveStepSchema,
    FlowReingestSourceIdStepSchema,
    FlowReingestWorkingTargetStepSchema,
    FlowReingestPlanScopeTargetStepSchema,
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
