import type { LmStudioModel } from '@codeinfo2/common';
import {
  chatSseEventsFixture,
  chatToolEventsFixture,
  mockModels,
  chatErrorEventFixture,
} from '@codeinfo2/common';

export type MockScenario =
  | 'many'
  | 'empty'
  | 'timeout'
  | 'chat-fixture'
  | 'chat-error'
  | 'chat-stream'
  | 'chat-tools';

let scenario: MockScenario = 'many';
let lastPrediction: { cancelled: boolean } | null = null;
let lastChatHistory: Array<{ role?: string; content?: string }> = [];

export function startMock({ scenario: next }: { scenario: MockScenario }) {
  scenario = next;
}

export function stopMock() {
  scenario = 'many';
  lastPrediction = null;
  lastChatHistory = [];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toChatHistory(input: unknown) {
  try {
    const candidate = input as { toChatHistory?: () => unknown };
    if (candidate && typeof candidate.toChatHistory === 'function') {
      const history = candidate.toChatHistory();
      if (Array.isArray(history)) {
        return history as Array<{ role?: string; content?: string }>;
      }
    }
    if (Array.isArray(input)) {
      return input as Array<{ role?: string; content?: string }>;
    }
    if (
      input &&
      typeof input === 'object' &&
      (input as { data?: unknown }).data &&
      Array.isArray((input as { data: { messages?: unknown } }).data?.messages)
    ) {
      return (
        input as {
          data: { messages: Array<{ role?: string; content?: string }> };
        }
      ).data.messages;
    }
  } catch {
    // ignore extraction errors
  }
  return [];
}

export function getLastChatHistory() {
  return lastChatHistory;
}

function createPrediction(events: unknown[]) {
  const state = { cancelled: false };
  lastPrediction = state;

  return {
    cancel: () => {
      state.cancelled = true;
    },
    async run(opts?: {
      onRoundStart?: (roundIndex: number) => void;
      onPredictionFragment?: (fragment: unknown) => void;
      onMessage?: (message: unknown) => void;
      onToolCallRequestStart?: (roundIndex: number, callId: string) => void;
      onToolCallRequestNameReceived?: (
        roundIndex: number,
        callId: string,
        name: string,
      ) => void;
      onToolCallRequestArgumentFragmentGenerated?: (
        roundIndex: number,
        callId: string,
        content: string,
      ) => void;
      onToolCallRequestEnd?: (roundIndex: number, callId: string) => void;
      onToolCallRequestFailure?: (
        roundIndex: number,
        callId: string,
        error: Error,
      ) => void;
      onToolCallResult?: (
        roundIndex: number,
        callId: string,
        info: unknown,
      ) => void;
      signal?: AbortSignal;
    }) {
      let currentRound = 0;
      const listener = () => {
        state.cancelled = true;
      };
      opts?.signal?.addEventListener('abort', listener);

      for (const event of events) {
        if (state.cancelled) break;
        await delay(20);
        const record = event as { type?: string; roundIndex?: number };
        const roundIndex =
          typeof record.roundIndex === 'number'
            ? record.roundIndex
            : currentRound;
        switch (record.type) {
          case 'token':
          case 'predictionFragment':
            opts?.onPredictionFragment?.({ ...record, roundIndex });
            break;
          case 'final':
          case 'message':
            opts?.onMessage?.({ ...(event as object), roundIndex });
            break;
          case 'toolCallRequestStart':
            opts?.onToolCallRequestStart?.(
              roundIndex,
              (event as { callId?: string }).callId ?? 'call-1',
            );
            break;
          case 'toolCallRequestNameReceived':
            opts?.onToolCallRequestNameReceived?.(
              roundIndex,
              (event as { callId?: string }).callId ?? 'call-1',
              (event as { name?: string }).name ?? 'tool',
            );
            break;
          case 'toolCallRequestArgumentFragmentGenerated':
            opts?.onToolCallRequestArgumentFragmentGenerated?.(
              roundIndex,
              (event as { callId?: string }).callId ?? 'call-1',
              (event as { content?: string }).content ?? '',
            );
            break;
          case 'toolCallRequestEnd':
            opts?.onToolCallRequestEnd?.(
              roundIndex,
              (event as { callId?: string }).callId ?? 'call-1',
            );
            break;
          case 'toolCallResult':
            opts?.onToolCallResult?.(
              roundIndex,
              (event as { callId?: string }).callId ?? 'call-1',
              event,
            );
            break;
          case 'error':
            opts?.onToolCallRequestFailure?.(
              roundIndex,
              (event as { callId?: string }).callId ?? 'call-1',
              new Error((event as { message?: string }).message ?? 'error'),
            );
            break;
          default:
            break;
        }
        opts?.onRoundStart?.(roundIndex);
        currentRound = roundIndex;
      }

      opts?.signal?.removeEventListener('abort', listener);
      return { rounds: events.length, totalExecutionTimeSeconds: 0 };
    },
  };
}

export function getLastPredictionState() {
  return lastPrediction;
}

const wsProtocolError = (url: string) =>
  `Failed to construct LMStudioClient. The baseUrl passed in must have protocol "ws" or "wss". Received: ${url}`;

export class MockLMStudioClient {
  constructor(baseUrl?: string) {
    const candidate =
      baseUrl ?? process.env.LMSTUDIO_BASE_URL ?? 'ws://localhost:1234';
    if (!candidate.startsWith('ws://') && !candidate.startsWith('wss://')) {
      throw new Error(wsProtocolError(candidate));
    }
  }
  system = {
    listDownloadedModels: async () => {
      if (scenario === 'timeout') {
        await new Promise((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), 2000),
        );
      }
      if (scenario === 'chat-error') {
        throw new Error('lmstudio unavailable');
      }
      if (scenario === 'chat-fixture') {
        return mockModels.map(
          (model) =>
            ({
              modelKey: model.key,
              displayName: model.displayName,
              type: model.type,
            }) satisfies Partial<LmStudioModel>,
        );
      }
      if (scenario === 'empty') {
        return [];
      }
      return [
        {
          modelKey: 'model-1',
          displayName: 'Model One',
          type: 'gguf',
          format: 'gguf',
          path: '/models/model-1.gguf',
          sizeBytes: 123456789,
          architecture: 'llama',
          paramsString: '7B',
          maxContextLength: 4096,
          vision: false,
          trainedForToolUse: false,
        },
        {
          modelKey: 'model-2',
          displayName: 'Model Two',
          type: 'gguf',
          format: 'gguf',
          path: '/models/model-2.gguf',
          sizeBytes: 987654321,
          architecture: 'mistral',
          paramsString: '13B',
          maxContextLength: 8192,
          vision: true,
          trainedForToolUse: true,
        },
        {
          modelKey: 'embed-1',
          displayName: 'Embedding Model',
          type: 'embedding',
          format: 'gguf',
          path: '/models/embed-1.gguf',
        },
      ];
    },
  };

  embedding = {
    model: async (key: string) => {
      const modelKey = key;
      return {
        async embed(text: string) {
          const len = Math.max(1, Math.min(8, text.length));
          const embedding = [(len % 5) * 0.1 + 0.1];
          return { modelKey, embedding };
        },
      };
    },
  };

  llm = {
    model: async (name: string) => {
      void name;
      return {
        act: async (chat: unknown, tools: unknown, opts?: unknown) => {
          lastChatHistory = toChatHistory(chat);
          if (Array.isArray(tools)) {
            const missingType = tools.find(
              (toolDef) =>
                !toolDef ||
                typeof (toolDef as { type?: string }).type !== 'string',
            );
            if (missingType) {
              throw new Error('Unhandled type: undefined');
            }
          }
          if (scenario === 'chat-error') {
            throw new Error('lmstudio unavailable');
          }
          const events =
            scenario === 'chat-fixture' || scenario === 'chat-stream'
              ? chatSseEventsFixture
              : scenario === 'chat-tools'
                ? chatToolEventsFixture
                : [
                    ...chatSseEventsFixture,
                    { ...chatErrorEventFixture, roundIndex: 0 },
                  ];
          const prediction = createPrediction(events);
          await prediction.run(
            opts as {
              onRoundStart?: (roundIndex: number) => void;
              onPredictionFragment?: (fragment: unknown) => void;
              onMessage?: (message: unknown) => void;
              onToolCallRequestStart?: (
                roundIndex: number,
                callId: string,
              ) => void;
              onToolCallRequestNameReceived?: (
                roundIndex: number,
                callId: string,
                name: string,
              ) => void;
              onToolCallRequestArgumentFragmentGenerated?: (
                roundIndex: number,
                callId: string,
                content: string,
              ) => void;
              onToolCallRequestEnd?: (
                roundIndex: number,
                callId: string,
              ) => void;
              onToolCallRequestFailure?: (
                roundIndex: number,
                callId: string,
                error: Error,
              ) => void;
              onToolCallResult?: (
                roundIndex: number,
                callId: string,
                info: unknown,
              ) => void;
              signal?: AbortSignal;
            },
          );
          return { rounds: events.length, totalExecutionTimeSeconds: 0 };
        },
        cancel: () => {
          /* noop: cancel handled by prediction */
        },
      };
    },
  };
}
