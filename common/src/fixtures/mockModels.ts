import type { ChatModelInfo, ChatModelsResponse } from '../lmstudio.js';

export const mockModels: ChatModelInfo[] = [
  {
    key: 'llama-3',
    displayName: 'Llama 3 Instruct',
    type: 'gguf',
  },
];

export const mockCodexModels: ChatModelInfo[] = [
  {
    key: 'gpt-5.2-codex',
    displayName: 'gpt-5.2-codex',
    type: 'codex',
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
  },
];

export const mockModelsResponse: ChatModelsResponse = {
  provider: 'lmstudio',
  available: true,
  toolsAvailable: true,
  models: mockModels,
  codexDefaults: undefined,
  codexWarnings: undefined,
};

export const mockCodexModelsResponse: ChatModelsResponse = {
  provider: 'codex',
  available: true,
  toolsAvailable: true,
  models: mockCodexModels,
  codexDefaults: {
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'on-failure',
    modelReasoningEffort: 'high',
    networkAccessEnabled: true,
    webSearchEnabled: true,
  },
  codexWarnings: [],
};
