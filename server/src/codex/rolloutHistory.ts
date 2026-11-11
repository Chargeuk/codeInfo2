import fs from 'node:fs/promises';
import {
  SYSTEM_CONTEXT,
  VECTORSEARCH_PROTOCOL_REMINDER,
} from '@codeinfo2/common';

export type CodexRolloutTurn = {
  id: string;
  completed: boolean;
  user: string;
  userMessages: string[];
  assistant: string;
  finalAssistant: string;
  startOffset: number;
};

export type CodexRolloutCheckpoint = {
  path: string;
  bytes: number;
  dev: number;
  ino: number;
};

export async function checkpointCodexRollout(
  path: string,
): Promise<CodexRolloutCheckpoint> {
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error('Codex canonical history is not a file');
  return { path, bytes: stat.size, dev: stat.dev, ino: stat.ino };
}

export async function readCodexRollout(path: string, sessionId: string) {
  const file = await fs.open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile())
      throw new Error('Codex canonical history is unavailable');
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const result = await file.read(bytes, read, bytes.length - read, read);
      if (!result.bytesRead)
        throw new Error('Codex canonical history was truncated');
      read += result.bytesRead;
    }
    const turns: CodexRolloutTurn[] = [];
    const ids = new Set<string>();
    let sessionVerified = false;
    let active: CodexRolloutTurn | undefined;
    let messages: Array<{ id?: string; text: string }> = [];
    let offset = 0;
    const raw = bytes.toString('utf8');
    for (const line of raw.split('\n')) {
      const startOffset = offset;
      offset += Buffer.byteLength(line) + 1;
      if (!line && startOffset === bytes.length) continue;
      // Materialization only consumes newline-terminated records. A valid JSON
      // tail can still be part of an unfinished append and is not committed yet.
      if (offset > bytes.length) break;
      const record = JSON.parse(line);
      const payload = record?.payload;
      if (!sessionVerified) {
        if (record?.type !== 'session_meta' || payload?.id !== sessionId)
          throw new Error('Codex canonical history session does not match');
        sessionVerified = true;
        continue;
      }
      if (record.type === 'session_meta')
        throw new Error(
          'Codex canonical history has conflicting session metadata',
        );
      if (record.type === 'event_msg' && payload?.type === 'task_started') {
        if (typeof payload.turn_id !== 'string' || ids.has(payload.turn_id))
          throw new Error(
            'Codex canonical history has an invalid task identity',
          );
        ids.add(payload.turn_id);
        active = {
          id: payload.turn_id,
          completed: false,
          user: '',
          userMessages: [],
          assistant: '',
          finalAssistant: '',
          startOffset,
        };
        turns.push(active);
        messages = [];
      }
      // Typed item_completed events can repeat these records. Only canonical
      // response_item messages contribute text, in their recorded item order.
      if (
        active &&
        record.type === 'response_item' &&
        payload?.type === 'message'
      ) {
        if (!['user', 'assistant'].includes(payload.role)) continue;
        if (!Array.isArray(payload.content))
          throw new Error('Codex canonical message content is unavailable');
        const text = payload.content
          .map((part: { text?: string }) => part.text ?? '')
          .join('\n');
        if (payload.role === 'user') {
          active.userMessages.push(text);
          active.user += `${active.user ? '\n' : ''}${text}`;
        } else {
          const previous =
            typeof payload.id === 'string'
              ? messages.find((message) => message.id === payload.id)
              : undefined;
          if (previous) previous.text = text;
          else
            messages.push({
              id: typeof payload.id === 'string' ? payload.id : undefined,
              text,
            });
          active.assistant = messages.map((message) => message.text).join('');
          active.finalAssistant = messages.at(-1)?.text ?? '';
        }
      }
      if (record.type === 'event_msg' && payload?.type === 'task_complete') {
        if (!active || active.id !== payload.turn_id)
          throw new Error('Codex canonical completion has no matching task');
        active.completed =
          typeof payload.last_agent_message === 'string' &&
          payload.last_agent_message.trim() === active.finalAssistant.trim() &&
          active.finalAssistant.trim().length > 0;
        active = undefined;
      }
      if (
        record.type === 'event_msg' &&
        ['turn_aborted', 'task_failed', 'error'].includes(payload?.type)
      ) {
        const failed =
          typeof payload.turn_id === 'string'
            ? turns.find((turn) => turn.id === payload.turn_id)
            : (active ?? turns.at(-1));
        if (failed) failed.completed = false;
      }
    }
    if (!sessionVerified)
      throw new Error('Codex canonical session metadata is unavailable');
    return { turns, path, bytes: stat.size, dev: stat.dev, ino: stat.ino };
  } finally {
    await file.close();
  }
}

export function matchesCodexStoredPrompt(actual: string, stored: string) {
  const expected = [
    stored.trim(),
    `${stored}\n- ${VECTORSEARCH_PROTOCOL_REMINDER}`.trim(),
  ];
  if (expected.includes(actual.trim())) return true;
  const marker = '\n\nUser:\n';
  const index = actual.lastIndexOf(marker);
  if (
    index < 0 ||
    !expected.includes(actual.slice(index + marker.length).trim())
  )
    return false;
  const prefix = actual.slice(0, index);
  const context = `Context:\n${SYSTEM_CONTEXT}`;
  return (
    prefix === context ||
    (prefix.startsWith(`${context}\n\nSystem:\n`) &&
      prefix.length > context.length + 10) ||
    (prefix.startsWith('System:\n') && prefix.length > 8)
  );
}
