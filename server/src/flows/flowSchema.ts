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

export type FlowCommandStep = {
  type: 'command';
  label?: string;
  agentType: string;
  identifier: string;
  commandName: string;
};

export type FlowReingestStep = {
  type: 'reingest';
  label?: string;
  sourceId: string;
};

export type FlowStep =
  | FlowStartLoopStep
  | FlowLlmStep
  | FlowBreakStep
  | FlowCommandStep
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

const FlowStartLoopStepSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('startLoop'),
    label: trimmedNonEmptyString.optional(),
    steps: z.array(z.lazy(() => FlowStepSchema)).min(1),
  })
  .strict();

const FlowLlmMessagesStepSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('llm'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    messages: z.array(FlowMessageSchema).min(1),
  })
  .strict();

const FlowLlmMarkdownFileStepSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('llm'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    markdownFile: trimmedNonEmptyString,
  })
  .strict();

const FlowLlmStepSchema: z.ZodTypeAny = z.union([
  FlowLlmMessagesStepSchema,
  FlowLlmMarkdownFileStepSchema,
]);

const FlowBreakStepSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('break'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    question: trimmedNonEmptyString,
    breakOn: z.union([z.literal('yes'), z.literal('no')]),
  })
  .strict();

const FlowCommandStepSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('command'),
    label: trimmedNonEmptyString.optional(),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    commandName: trimmedNonEmptyString,
  })
  .strict();

const FlowReingestStepSchema: z.ZodTypeAny = z
  .object({
    type: z.literal('reingest'),
    label: trimmedNonEmptyString.optional(),
    sourceId: trimmedNonEmptyString,
  })
  .strict();

function flowStepUnionSchema() {
  return z.union([
    FlowStartLoopStepSchema,
    FlowLlmStepSchema,
    FlowBreakStepSchema,
    FlowCommandStepSchema,
    FlowReingestStepSchema,
  ]);
}

const FlowFileSchema: z.ZodTypeAny = z
  .object({
    description: trimmedNonEmptyString.optional(),
    steps: z.array(FlowStepSchema),
  })
  .strict();

export function parseFlowFile(
  jsonText: string,
  metadata?: { flowName?: string },
): { ok: true; flow: FlowFile } | { ok: false } {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false };
  }

  const parsed = FlowFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };

  const flowName = metadata?.flowName?.trim() || '(unknown)';
  for (const [stepIndex, step] of parsed.data.steps.entries()) {
    if (step.type !== 'llm' && step.type !== 'reingest') continue;
    const instructionSource =
      step.type === 'llm'
        ? 'messages' in step
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
        stepIndex,
        stepType: step.type,
        label: step.label ?? null,
        instructionSource,
      },
    });
  }

  return { ok: true, flow: parsed.data };
}
