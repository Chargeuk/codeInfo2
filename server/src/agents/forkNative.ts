import fs from 'node:fs/promises';
import path from 'node:path';
import { CopilotClient, type SessionEvent } from '@github/copilot-sdk';
import {
  CodexAppServer,
  withCodexAppServer,
  type NativeCodexThread,
} from '../codex/appServer.js';
import { buildCopilotClientOptions } from '../config/copilotConfig.js';
import { ForkError, last, type NativeForkTurn } from './forkHistory.js';

export type ForkNativeSession = {
  turns: NativeForkTurn[];
  fork: (
    boundary: NativeForkTurn,
    config: Record<string, unknown>,
    model: string,
    cwd?: string,
  ) => Promise<string>;
  inject: (sessionId: string, text: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  hasInjected: (sessionId: string, text: string) => Promise<boolean>;
  close: () => Promise<void>;
  isWriterTerminated?: () => boolean;
};

export function mapCopilotForkTurns(events: SessionEvent[]): NativeForkTurn[] {
  const persisted = events.filter((event) => !event.ephemeral);
  const turns: NativeForkTurn[] = [];
  let prompt = '';
  for (let index = 0; index < persisted.length; index++) {
    const event = persisted[index];
    if (event.agentId) continue;
    if (event.type === 'user.message') prompt = event.data.content;
    if (event.type === 'assistant.turn_start') {
      turns.push({
        id: event.data.turnId,
        completed: false,
        user: prompt,
        assistant: '',
        timestamp: event.timestamp,
      });
    }
    const current = turns.at(-1);
    if (
      current &&
      event.type === 'assistant.message' &&
      event.data.content.trim()
    ) {
      current.assistant = event.data.content;
    }
    if (current && event.type === 'assistant.turn_end') {
      current.completed = true;
      current.eventId = event.id;
      current.nextEventId = persisted[index + 1]?.id;
    }
  }
  return turns;
}

export async function openForkNative(
  provider: 'codex' | 'copilot',
  sessionId: string,
): Promise<ForkNativeSession> {
  if (provider === 'codex') {
    // Keep this connection alive until the child is persisted and its handover
    // injected. Fork/inject never call turn/start or rewrite instructions.
    const rpc = new CodexAppServer();
    try {
      await rpc.initialize();
      const { thread } = await rpc.request<{ thread: NativeCodexThread }>(
        'thread/read',
        { threadId: sessionId, includeTurns: true },
      );
      const rolloutPaths = new Map<string, string>();
      if (thread.path) rolloutPaths.set(sessionId, thread.path);
      return {
        turns: thread.turns.map((turn) => ({
          id: turn.id,
          completed: turn.status === 'completed',
          user: turn.items
            .filter((item) => item.type === 'userMessage')
            .flatMap((item) => item.content ?? [])
            .map((item) => item.text ?? '')
            .join('\n'),
          assistant:
            turn.items
              .filter((item) => item.type === 'agentMessage')
              .map((item) => item.text ?? '')
              .at(-1) ?? '',
        })),
        fork: async (boundary, config, model, cwd) => {
          const result = await rpc.request<{ thread: NativeCodexThread }>(
            'thread/fork',
            {
              threadId: sessionId,
              lastTurnId: boundary.id,
              model,
              cwd,
              config,
            },
          );
          if (result.thread.path)
            rolloutPaths.set(result.thread.id, result.thread.path);
          return result.thread.id;
        },
        inject: async (childId, text) => {
          await rpc.request('thread/resume', { threadId: childId });
          await rpc.request('thread/inject_items', {
            threadId: childId,
            items: [
              {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text }],
              },
            ],
          });
        },
        hasInjected: async (childId, text) => {
          let rolloutPath = rolloutPaths.get(childId);
          if (!rolloutPath) {
            const result = await rpc.request<{ thread: NativeCodexThread }>(
              'thread/read',
              { threadId: childId, includeTurns: false },
            );
            rolloutPath = result.thread.path;
            if (rolloutPath) rolloutPaths.set(childId, rolloutPath);
          }
          if (!rolloutPath)
            throw new Error('Codex child rollout path is unavailable');
          // The cached owned path also permits a durable read after closing
          // app-server, when no child writer can hide an unflushed injection.
          const rollout = await fs.readFile(rolloutPath, 'utf8');
          return rollout
            .split('\n')
            .filter(Boolean)
            .some((line) => {
              const record = JSON.parse(line) as {
                type?: string;
                payload?: { role?: string; content?: Array<{ text?: string }> };
              };
              return (
                record.type === 'response_item' &&
                record.payload?.role === 'user' &&
                record.payload.content?.some((item) => item.text === text)
              );
            });
        },
        remove: async (childId) => {
          // Only a child returned by this connection is owned by this operation.
          // Archiving is reversible and avoids deleting arbitrary rollout paths.
          if (childId === sessionId) throw new Error('Refusing source cleanup');
          await rpc.request('thread/archive', { threadId: childId });
        },
        close: () => rpc.close(),
        isWriterTerminated: () => rpc.isWriterTerminated(),
      };
    } catch (error) {
      await rpc.close();
      throw new ForkError(
        'FORK_NATIVE_UNAVAILABLE',
        `Codex native history is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const options = buildCopilotClientOptions();
  const client = new CopilotClient(options.clientOptions);
  try {
    await client.start();
    // Reading persisted events from disk avoids resuming/reconfiguring a
    // source whose later turn may still be running in another client.
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId))
      throw new Error('Invalid native session identity');
    const raw = await fs.readFile(
      path.join(options.configDir, 'session-state', sessionId, 'events.jsonl'),
      'utf8',
    );
    // The writer may be appending a later run. Only consume complete JSONL records.
    const lines = raw.split('\n').filter(Boolean);
    const events = lines.flatMap((line, index) => {
      try {
        return [JSON.parse(line) as SessionEvent];
      } catch (error) {
        if (index === lines.length - 1) return [];
        throw error;
      }
    });
    const turns = mapCopilotForkTurns(events);
    return {
      turns,
      fork: async (boundary) => {
        const result = await client.rpc.sessions.fork({
          sessionId,
          toEventId: boundary.nextEventId,
        });
        return result.sessionId;
      },
      hasInjected: async () => false,
      inject: async () => undefined, // Copilot receives the pending handover with the next instruction.
      remove: async (childId) => {
        if (childId === sessionId) throw new Error('Refusing source cleanup');
        await client.deleteSession(childId);
      },
      close: async () => {
        await client.stop();
      },
    };
  } catch (error) {
    await client.stop();
    throw new ForkError(
      'FORK_NATIVE_UNAVAILABLE',
      `Copilot native history is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// SDK exec JSONL does not expose native turn IDs. Read after a completed run,
// while the caller still owns its run lock; failure keeps old-history support.
export async function readCompletedCodexTurn(sessionId: string) {
  return withCodexAppServer(async (rpc) => {
    const { thread } = await rpc.request<{ thread: NativeCodexThread }>(
      'thread/read',
      { threadId: sessionId, includeTurns: true },
    );
    const turn = last(thread.turns, (item) => item.status === 'completed');
    return turn ? { sessionId, turnId: turn.id } : undefined;
  });
}

/** The caller must establish ownership from a persisted incomplete operation. */
export async function removeOwnedNativeFork(
  provider: 'codex' | 'copilot',
  childId: string,
) {
  if (provider === 'codex') {
    await withCodexAppServer(async (rpc) => {
      await rpc.request('thread/archive', { threadId: childId });
    });
    return;
  }
  const client = new CopilotClient(buildCopilotClientOptions().clientOptions);
  try {
    await client.start();
    await client.deleteSession(childId);
  } finally {
    await client.stop();
  }
}
