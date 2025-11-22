import type { LmStudioModel } from '@codeinfo2/common';
import {
  chatSseEventsFixture,
  mockModels,
  chatErrorEventFixture,
} from '@codeinfo2/common';

export type MockScenario =
  | 'many'
  | 'empty'
  | 'timeout'
  | 'chat-fixture'
  | 'chat-error'
  | 'chat-stream';

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
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        if (state.cancelled) return;
        await delay(20);
        yield event;
      }
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
      ];
    },
  };

  getModel = () => ({
    act: async () => {
      if (scenario === 'chat-error') {
        throw new Error('lmstudio unavailable');
      }
      const events =
        scenario === 'chat-fixture' || scenario === 'chat-stream'
          ? chatSseEventsFixture
          : [
              ...chatSseEventsFixture,
              { ...chatErrorEventFixture, roundIndex: 0 },
            ];
      return createPrediction(events);
    },
  });
}
