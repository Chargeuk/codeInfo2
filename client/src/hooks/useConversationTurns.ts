import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { createLogger } from '../logging/logger';

const serverBase = getApiBaseUrl();

export type TurnUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
};

export type TurnTimingMetadata = {
  totalTimeSec?: number;
  tokensPerSecond?: number;
};

export type TurnCommandMetadata = {
  name: string;
  stepIndex: number;
  totalSteps: number;
};

export type StoredTurn = {
  turnId?: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string;
  provider: string;
  toolCalls?: Record<string, unknown> | null;
  status: 'ok' | 'stopped' | 'failed';
  command?: TurnCommandMetadata;
  usage?: TurnUsageMetadata;
  timing?: TurnTimingMetadata;
  createdAt: string;
};

export type InflightToolEvent =
  | {
      type: 'tool-request';
      callId: string | number;
      name: string;
      stage?: string;
      parameters?: unknown;
    }
  | {
      type: 'tool-result';
      callId: string | number;
      name: string;
      stage?: string;
      parameters?: unknown;
      result?: unknown;
      errorTrimmed?: { code?: string; message?: string } | null;
      errorFull?: unknown;
    };

export type InflightSnapshot = {
  inflightId: string;
  assistantText: string;
  assistantThink: string;
  toolEvents: InflightToolEvent[];
  startedAt: string;
  seq: number;
  command?: TurnCommandMetadata;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeUsage = (
  usage: TurnUsageMetadata | undefined,
): TurnUsageMetadata | undefined => {
  if (!usage) return undefined;
  const cleaned: TurnUsageMetadata = {};
  if (isFiniteNumber(usage.inputTokens) && usage.inputTokens >= 0) {
    cleaned.inputTokens = usage.inputTokens;
  }
  if (isFiniteNumber(usage.outputTokens) && usage.outputTokens >= 0) {
    cleaned.outputTokens = usage.outputTokens;
  }
  if (isFiniteNumber(usage.totalTokens) && usage.totalTokens >= 0) {
    cleaned.totalTokens = usage.totalTokens;
  }
  if (isFiniteNumber(usage.cachedInputTokens) && usage.cachedInputTokens >= 0) {
    cleaned.cachedInputTokens = usage.cachedInputTokens;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const normalizeTiming = (
  timing: TurnTimingMetadata | undefined,
): TurnTimingMetadata | undefined => {
  if (!timing) return undefined;
  const cleaned: TurnTimingMetadata = {};
  if (isFiniteNumber(timing.totalTimeSec) && timing.totalTimeSec > 0) {
    cleaned.totalTimeSec = timing.totalTimeSec;
  }
  if (isFiniteNumber(timing.tokensPerSecond) && timing.tokensPerSecond > 0) {
    cleaned.tokensPerSecond = timing.tokensPerSecond;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const normalizeCommand = (
  command: TurnCommandMetadata | undefined,
): TurnCommandMetadata | undefined => {
  if (!command) return undefined;
  const name = typeof command.name === 'string' ? command.name.trim() : '';
  if (!name) return undefined;
  if (!isFiniteNumber(command.stepIndex) || command.stepIndex < 0) {
    return undefined;
  }
  if (!isFiniteNumber(command.totalSteps) || command.totalSteps <= 0) {
    return undefined;
  }
  return {
    name,
    stepIndex: command.stepIndex,
    totalSteps: command.totalSteps,
  };
};

type ApiResponse = {
  items?: StoredTurn[];
  inflight?: InflightSnapshot;
};

type State = {
  turns: StoredTurn[];
  inflight: InflightSnapshot | null;
  isLoading: boolean;
  isError: boolean;
  error?: string;
  refresh: () => Promise<void>;
  reset: () => void;
};

export function useConversationTurns(
  conversationId?: string,
  options?: { autoFetch?: boolean },
): State {
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [inflight, setInflight] = useState<InflightSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const controllerRef = useRef<AbortController | null>(null);
  const log = useRef(createLogger('client')).current;
  const autoFetch = options?.autoFetch !== false;

  const dedupeTurns = useCallback((items: StoredTurn[]) => {
    const seen = new Set<string>();
    return items.filter((turn) => {
      const key = turn.turnId
        ? `turnId:${turn.turnId}`
        : `${turn.createdAt}-${turn.role}-${turn.provider}-${turn.model}-${turn.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  const sortChronological = useCallback((items: StoredTurn[]) => {
    const rolePriority = (role: StoredTurn['role']) => {
      if (role === 'system') return 0;
      if (role === 'user') return 1;
      return 2;
    };

    return items.slice().sort((a, b) => {
      const aTime = Date.parse(a.createdAt);
      const bTime = Date.parse(b.createdAt);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return aTime - bTime;
      }

      const roleDelta = rolePriority(a.role) - rolePriority(b.role);
      if (roleDelta !== 0) return roleDelta;

      if (a.turnId && b.turnId && a.turnId !== b.turnId) {
        return a.turnId.localeCompare(b.turnId);
      }
      if (a.turnId && !b.turnId) return -1;
      if (!a.turnId && b.turnId) return 1;

      const aKey = `${a.role}|${a.provider}|${a.model}|${a.content}`;
      const bKey = `${b.role}|${b.provider}|${b.model}|${b.content}`;
      return aKey.localeCompare(bKey);
    });
  }, []);

  const fetchSnapshot = useCallback(async () => {
    if (!conversationId) {
      // Debug: no conversation selected; ensure state resets
      console.info('[turns] reset (no conversationId)');
      setTurns([]);
      setInflight(null);
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    try {
      console.info('[turns] fetch start', { conversationId });
      const res = await fetch(
        new URL(
          `/conversations/${conversationId}/turns`,
          serverBase,
        ).toString(),
        { signal: controller.signal },
      );
      if (res.status === 404) {
        setTurns([]);
        setInflight(null);
        setIsError(false);
        setError(undefined);
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load conversation turns (${res.status})`);
      }
      const data = (await res.json()) as ApiResponse;
      const items = Array.isArray(data.items) ? data.items : [];
      const hydrated = items.map((item) => {
        if (item.role !== 'assistant') {
          const { usage: _usage, timing: _timing, ...rest } = item;
          void _usage;
          void _timing;
          return rest;
        }

        const usage = normalizeUsage(item.usage);
        const timing = normalizeTiming(item.timing);
        return {
          ...item,
          ...(usage ? { usage } : {}),
          ...(timing ? { timing } : {}),
        };
      });
      const chronological = sortChronological(hydrated.slice().reverse());
      const inflight = data.inflight
        ? (() => {
            const { command, ...rest } = data.inflight;
            const normalizedCommand = normalizeCommand(command);
            return normalizedCommand
              ? { ...rest, command: normalizedCommand }
              : rest;
          })()
        : null;
      setInflight(inflight);
      setTurns(dedupeTurns(chronological));
      const turnsWithMetadata = chronological.filter(
        (turn) =>
          turn.role === 'assistant' &&
          (turn.usage !== undefined || turn.timing),
      );
      if (turnsWithMetadata.length > 0) {
        log('info', 'DEV-0000024:T7:rest_usage_mapped', {
          conversationId,
          count: turnsWithMetadata.length,
        });
      }
      if (inflight?.command) {
        log('info', 'DEV-0000024:T7:rest_inflight_command', {
          conversationId,
          inflightId: inflight.inflightId,
          command: inflight.command,
        });
      }
      console.info('[turns] fetch success', {
        conversationId,
        count: chronological.length,
        inflight: data.inflight
          ? {
              inflightId: data.inflight.inflightId,
              seq: data.inflight.seq,
            }
          : null,
      });
      setIsError(false);
      setError(undefined);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setIsError(true);
      setError((err as Error).message);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setIsLoading(false);
    }
  }, [conversationId, dedupeTurns, log, sortChronological]);

  useEffect(() => {
    setTurns([]);
    setInflight(null);
    if (!conversationId) return;
    if (!autoFetch) return;
    void fetchSnapshot();
    return () => controllerRef.current?.abort();
  }, [autoFetch, conversationId, fetchSnapshot]);

  const refresh = useCallback(async () => {
    await fetchSnapshot();
  }, [fetchSnapshot]);

  const reset = useCallback(() => {
    setTurns([]);
    setInflight(null);
    setIsError(false);
    setError(undefined);
    controllerRef.current?.abort();
  }, []);

  return useMemo(
    () => ({
      turns,
      inflight,
      isLoading,
      isError,
      error,
      refresh,
      reset,
    }),
    [turns, inflight, isLoading, isError, error, refresh, reset],
  );
}

export default useConversationTurns;
