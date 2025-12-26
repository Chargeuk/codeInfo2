import type { ChatModelInfo, ChatModelsResponse } from '../lmstudio.js';

export const mockModels: ChatModelInfo[] = [
  {
    key: 'llama-3',
    displayName: 'Llama 3 Instruct',
    type: 'gguf',
  },
];

export const mockModelsResponse: ChatModelsResponse = {
  provider: 'lmstudio',
  available: true,
  toolsAvailable: true,
  models: mockModels,
};
