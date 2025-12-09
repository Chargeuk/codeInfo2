import { ChatInterface } from './interfaces/ChatInterface.js';
import { ChatInterfaceCodex } from './interfaces/ChatInterfaceCodex.js';

export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported chat provider: ${provider}`);
    this.name = 'UnsupportedProviderError';
  }
}

class ChatInterfaceLMStudio extends ChatInterface {
  async run(): Promise<void> {
    throw new Error('ChatInterfaceLMStudio not implemented');
  }
}

const providerMap: Record<string, () => ChatInterface> = {
  codex: () => new ChatInterfaceCodex(),
  lmstudio: () => new ChatInterfaceLMStudio(),
};

export function getChatInterface(provider: string): ChatInterface {
  const factory = providerMap[provider];
  if (!factory) {
    throw new UnsupportedProviderError(provider);
  }
  return factory();
}
