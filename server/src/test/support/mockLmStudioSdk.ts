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

export function startMock({ scenario: next }: { scenario: MockScenario }) {
  scenario = next;
}

export function stopMock() {
  scenario = 'many';
  lastPrediction = null;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export class MockLMStudioClient {
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

  llm = {
    model: async (name: string) => {
      void name;
      return {
        act: async (_chat: unknown, _tools: unknown, opts?: unknown) => {
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
