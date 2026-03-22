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

const AgentCommandReingestCurrentTargetItemSchema = z
  .object({
    type: z.literal('reingest'),
    target: z.literal('current'),
  })
  .strict();

const AgentCommandReingestAllTargetItemSchema = z
  .object({
    type: z.literal('reingest'),
    target: z.literal('all'),
  })
  .strict();

const AgentCommandReingestItemSchema = z.union([
  AgentCommandReingestSourceIdItemSchema,
  AgentCommandReingestCurrentTargetItemSchema,
  AgentCommandReingestAllTargetItemSchema,
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
