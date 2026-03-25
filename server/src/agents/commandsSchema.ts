import { z } from 'zod';

import { append } from '../logStore.js';

const trimmedNonEmptyString = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0);

const AgentCommandMessageContentItemSchema = z
  .object({
    type: z.literal('message'),
    role: z.literal('user'),
    content: z.array(trimmedNonEmptyString).min(1),
  })
  .strict();

const AgentCommandMessageMarkdownFileItemSchema = z
  .object({
    type: z.literal('message'),
    role: z.literal('user'),
    markdownFile: trimmedNonEmptyString,
  })
  .strict();

const AgentCommandMessageItemSchema = z.union([
  AgentCommandMessageContentItemSchema,
  AgentCommandMessageMarkdownFileItemSchema,
]);

const AgentCommandReingestSourceIdItemSchema = z
  .object({
    type: z.literal('reingest'),
    sourceId: trimmedNonEmptyString,
  })
  .strict();

const AgentCommandReingestWorkingTargetItemSchema = z
  .object({
    type: z.literal('reingest'),
    target: z.literal('working'),
  })
  .strict();

const AgentCommandReingestPlanScopeTargetItemSchema = z
  .object({
    type: z.literal('reingest'),
    target: z.literal('plan_scope'),
  })
  .strict();

const AgentCommandReingestItemSchema = z.union([
  AgentCommandReingestSourceIdItemSchema,
  AgentCommandReingestWorkingTargetItemSchema,
  AgentCommandReingestPlanScopeTargetItemSchema,
]);

const AgentCommandItemSchema = z.union([
  AgentCommandMessageItemSchema,
  AgentCommandReingestItemSchema,
]);

const AgentCommandFileSchema = z
  .object({
    Description: trimmedNonEmptyString,
    items: z.array(AgentCommandItemSchema).min(1),
  })
  .strict();

export type AgentCommandMessageItem = z.infer<
  typeof AgentCommandMessageItemSchema
>;
export type AgentCommandReingestItem = z.infer<
  typeof AgentCommandReingestItemSchema
>;
export type AgentCommandItem = z.infer<typeof AgentCommandItemSchema>;
export type AgentCommandFile = z.infer<typeof AgentCommandFileSchema>;

function emitReingestTargetContractLogs(params: {
  commandName: string;
  raw: unknown;
  parsedOk: boolean;
}) {
  if (
    !params.parsedOk &&
    typeof params.raw === 'object' &&
    params.raw !== null
  ) {
    const items = (params.raw as { items?: unknown }).items;
    if (!Array.isArray(items)) return;

    for (const [itemIndex, item] of items.entries()) {
      if (typeof item !== 'object' || item === null) continue;
      const target = (item as { target?: unknown; type?: unknown }).target;
      const type = (item as { target?: unknown; type?: unknown }).type;
      if (type === 'reingest' && (target === 'current' || target === 'all')) {
        append({
          level: 'info',
          message: 'DEV-0000052:T1:reingest-target-contract',
          timestamp: new Date().toISOString(),
          source: 'server',
          context: {
            commandName: params.commandName,
            itemIndex,
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
    !Array.isArray((params.raw as { items?: unknown }).items)
  ) {
    return;
  }

  const items = (params.raw as { items: unknown[] }).items;
  for (const [itemIndex, item] of items.entries()) {
    if (typeof item !== 'object' || item === null) continue;
    const target = (item as { target?: unknown; type?: unknown }).target;
    const type = (item as { target?: unknown; type?: unknown }).type;
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
          commandName: params.commandName,
          itemIndex,
          outcome: 'accepted_supported_target',
          supportedTarget: target,
        },
      });
    }
  }
}

export function parseAgentCommandFile(
  jsonText: string,
  metadata?: { commandName?: string; emitSchemaParseLogs?: boolean },
): { ok: true; command: AgentCommandFile } | { ok: false } {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false };
  }

  const parsed = AgentCommandFileSchema.safeParse(raw);
  if (metadata?.emitSchemaParseLogs) {
    emitReingestTargetContractLogs({
      commandName: metadata.commandName?.trim() || '(unknown)',
      raw,
      parsedOk: parsed.success,
    });
  }
  if (!parsed.success) return { ok: false };

  if (metadata?.emitSchemaParseLogs) {
    const commandName = metadata.commandName?.trim() || '(unknown)';
    for (const [itemIndex, item] of parsed.data.items.entries()) {
      const instructionSource =
        item.type === 'message'
          ? 'markdownFile' in item
            ? 'markdownFile'
            : 'content'
          : 'reingest';
      append({
        level: 'info',
        message: 'DEV-0000045:T1:command_schema_item_parsed',
        timestamp: new Date().toISOString(),
        source: 'server',
        context: {
          commandName,
          itemIndex,
          itemType: item.type,
          instructionSource,
        },
      });
    }
  }

  return { ok: true, command: parsed.data };
}
