import fs from 'node:fs/promises';
import path from 'node:path';
import { CopilotClient, type SessionEvent } from '@github/copilot-sdk';
import {
  CodexAppServer,
  withCodexAppServer,
  type NativeCodexThread,
} from '../codex/appServer.js';
import {
  checkpointCodexRollout,
  matchesCodexStoredPrompt,
  readCodexRollout,
  type CodexRolloutCheckpoint,
  type CodexRolloutTurn,
} from '../codex/rolloutHistory.js';
import { buildCopilotClientOptions } from '../config/copilotConfig.js';
import type { TurnSummary } from '../mongo/repo.js';
import {
  ForkError,
  last,
  lastIndex,
  resolveForkBoundary,
  resolveVerifiedCodexBoundary,
  type NativeForkTurn,
} from './forkHistory.js';

export type ForkNativeSession = {
  turns: NativeForkTurn[];
  recoverBoundary?: (
    snapshot: TurnSummary[],
  ) => Promise<{ turn: NativeForkTurn; estimated: boolean }>;
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

export function hasCodexRolloutInjected(raw: string, text: string): boolean {
  const lines = raw.split('\n');
  const hasTrailingNewline = raw.endsWith('\n');
  type RolloutRecord = {
    type?: string;
    payload?: { role?: string; content?: Array<{ text?: string }> };
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    let record: RolloutRecord;
    try {
      record = JSON.parse(line) as RolloutRecord;
    } catch (error) {
      // A writer may still be flushing only the final unterminated fragment.
      if (!hasTrailingNewline && index === lines.length - 1) continue;
      throw error;
    }
    if (
      record.type === 'response_item' &&
      record.payload?.role === 'user' &&
      record.payload.content?.some((item) => item.text === text)
    ) {
      return true;
    }
  }
  return false;
}

export async function openForkNative(
  provider: 'codex' | 'copilot',
  sessionId: string,
  readHistory = true,
  createServer = () => new CodexAppServer(),
): Promise<ForkNativeSession> {
  if (provider === 'codex') {
    // Native fork creation does not run inference. Legacy operation recovery
    // can still inspect/inject history; new handovers use normal agent runs.
    const rpc = createServer();
    try {
      await rpc.initialize();
      const thread: NativeCodexThread = { id: sessionId, turns: [] };
      let canonical: CodexRolloutTurn[] | undefined;
      const canonicalTurns = async () =>
        (canonical ??= (
          await readCodexRollout(
            await readCodexRolloutPath(rpc, sessionId),
            sessionId,
          )
        ).turns);
      if (readHistory) {
        try {
          let cursor: string | undefined;
          do {
            const page = await rpc.request<{
              data: NativeCodexThread['turns'];
              nextCursor: string | null;
            }>('thread/turns/list', {
              threadId: sessionId,
              cursor,
              sortDirection: 'asc',
              itemsView: 'full',
            });
            if (page.nextCursor && page.nextCursor === cursor)
              throw new ForkError(
                'FORK_NATIVE_UNAVAILABLE',
                'Codex native history cursor did not advance',
              );
            thread.turns.push(...page.data);
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
        } catch (error) {
          if (error instanceof ForkError) throw error;
          await canonicalTurns();
        }
      }
      const rolloutPaths = new Map<string, string>();
      if (thread.path) rolloutPaths.set(sessionId, thread.path);
      const indexedTurns = canonical
        ? []
        : thread.turns.map((turn) => ({
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
          }));
      return {
        turns: canonical ?? indexedTurns,
        recoverBoundary: async (snapshot) => {
          try {
            const responseIndex = lastIndex(
              snapshot,
              (turn) =>
                turn.role === 'assistant' &&
                ['ok', 'warning'].includes(turn.status),
            );
            const response = snapshot[responseIndex];
            const prompt = last(
              snapshot.slice(0, responseIndex),
              (turn) => turn.role === 'user' && !turn.fork?.handover,
            );
            // The indexed child view includes inherited turns which need not
            // exist in its local history_base rollout. Preserve that resolver's
            // estimated ordering, excluding local child tasks for inherited rows.
            if (indexedTurns.length) {
              let indexed: ReturnType<typeof resolveForkBoundary> | undefined;
              try {
                indexed = resolveForkBoundary(snapshot, indexedTurns);
              } catch {
                // Unusable index evidence must be verified canonically.
              }
              if (indexed?.turn.completed && response?.fork?.sourceTurnId) {
                const local = await canonicalTurns();
                if (!local.some((turn) => turn.id === indexed?.turn.id))
                  return indexed;
              }
              if (
                !response?.fork?.sourceTurnId &&
                indexed?.turn.completed &&
                response?.content.trim() &&
                prompt?.content.trim() &&
                indexed.turn.assistant.trim() === response.content.trim() &&
                matchesCodexStoredPrompt(indexed.turn.user, prompt.content)
              )
                return indexed;
            }
            if (response?.fork?.sourceTurnId)
              throw new ForkError(
                'FORK_HISTORY_UNAVAILABLE',
                'The inherited native boundary is unavailable in indexed history.',
              );
            return resolveVerifiedCodexBoundary(
              snapshot,
              await canonicalTurns(),
            );
          } catch (error) {
            if (error instanceof ForkError) throw error;
            throw new ForkError(
              'FORK_HISTORY_UNAVAILABLE',
              `Codex canonical history is unavailable: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
        fork: async (boundary, config, model, cwd) => {
          const result = await rpc.request<{ thread: NativeCodexThread }>(
            'thread/fork',
            {
              threadId: sessionId,
              lastTurnId: boundary.id,
              excludeTurns: true,
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
          return hasCodexRolloutInjected(rollout, text);
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

async function readCodexRolloutPath(rpc: CodexAppServer, sessionId: string) {
  const { thread } = await rpc.request<{ thread: NativeCodexThread }>(
    'thread/read',
    { threadId: sessionId, includeTurns: false },
  );
  if (thread.id !== sessionId || !thread.path)
    throw new Error('Codex canonical session identity or path is unavailable');
  return thread.path;
}

export async function readCodexRunCheckpoint(
  sessionId: string,
  codexHome?: string,
  createServer = () => new CodexAppServer(undefined, codexHome),
) {
  return withCodexAppServer(
    async (rpc) =>
      checkpointCodexRollout(await readCodexRolloutPath(rpc, sessionId)),
    createServer,
  );
}

// Capture only this SDK invocation after its iterator/child has flushed. A
// resumed session needs its pre-run file boundary; fresh sessions have one task.
export async function readCompletedCodexTurn(
  sessionId: string,
  proof: {
    prompt: string;
    assistant: string;
    fresh: boolean;
    checkpoint?: CodexRolloutCheckpoint;
  },
  codexHome?: string,
  createServer = () => new CodexAppServer(undefined, codexHome),
) {
  if (!proof.fresh && !proof.checkpoint) return undefined;
  return withCodexAppServer(async (rpc) => {
    const history = await readCodexRollout(
      await readCodexRolloutPath(rpc, sessionId),
      sessionId,
    );
    const before = proof.checkpoint;
    if (
      before &&
      (history.path !== before.path ||
        history.dev !== before.dev ||
        history.ino !== before.ino ||
        history.bytes < before.bytes)
    )
      return undefined;
    const turns = history.turns.filter(
      (turn) => turn.startOffset >= (before?.bytes ?? 0),
    );
    const turn = turns[0];
    return turns.length === 1 &&
      turn.completed &&
      turn.userMessages.includes(proof.prompt) &&
      turn.assistant === proof.assistant &&
      history.turns.at(-1)?.id === turn.id
      ? { sessionId, turnId: turn.id }
      : undefined;
  }, createServer);
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
