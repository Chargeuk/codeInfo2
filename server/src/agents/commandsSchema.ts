import { z } from 'zod';

const trimmedNonEmptyString = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0);

const AgentCommandMessageItemSchema = z
  .object({
    type: z.literal('message'),
    role: z.literal('user'),
    content: z.array(trimmedNonEmptyString).min(1),
  })
  .strict();

const AgentCommandFileSchema = z
  .object({
    Description: trimmedNonEmptyString,
    items: z.array(AgentCommandMessageItemSchema).min(1),
  })
  .strict();

export type AgentCommandItem = z.infer<typeof AgentCommandMessageItemSchema>;
export type AgentCommandFile = z.infer<typeof AgentCommandFileSchema>;

export function parseAgentCommandFile(
  jsonText: string,
): { ok: true; command: AgentCommandFile } | { ok: false } {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false };
  }

  const parsed = AgentCommandFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };

  return { ok: true, command: parsed.data };
}
