import {
  approveAll,
  type ResumeSessionConfig,
  type SessionConfig,
  type SystemMessageConfig,
} from '@github/copilot-sdk';
import { CopilotLifecycle } from '../copilotLifecycle.js';
import { ChatInterface } from './ChatInterface.js';

type CopilotRunFlags = {
  sessionId?: string | null;
  systemPrompt?: string;
  workingDirectoryOverride?: string;
};

export class ChatInterfaceCopilot extends ChatInterface {
  constructor(private readonly lifecycle: CopilotLifecycle) {
    super();
  }

  buildCreateSessionConfig(
    conversationId: string,
    model: string,
    flags: Record<string, unknown>,
  ): SessionConfig {
    const typedFlags = (flags ?? {}) as CopilotRunFlags;
    return {
      sessionId: typedFlags.sessionId ?? conversationId,
      model,
      configDir: this.lifecycle.configDir,
      onPermissionRequest: approveAll,
      ...(typedFlags.systemPrompt
        ? {
            systemMessage: {
              mode: 'append',
              content: typedFlags.systemPrompt,
            } satisfies SystemMessageConfig,
          }
        : {}),
      ...(typedFlags.workingDirectoryOverride
        ? { workingDirectory: typedFlags.workingDirectoryOverride }
        : {}),
    };
  }

  buildResumeSessionConfig(
    model: string,
    flags: Record<string, unknown>,
  ): ResumeSessionConfig {
    const typedFlags = (flags ?? {}) as CopilotRunFlags;
    return {
      model,
      configDir: this.lifecycle.configDir,
      onPermissionRequest: approveAll,
      ...(typedFlags.systemPrompt
        ? {
            systemMessage: {
              mode: 'append',
              content: typedFlags.systemPrompt,
            } satisfies SystemMessageConfig,
          }
        : {}),
      ...(typedFlags.workingDirectoryOverride
        ? { workingDirectory: typedFlags.workingDirectoryOverride }
        : {}),
    };
  }

  async createConversationSession(
    conversationId: string,
    model: string,
    flags: Record<string, unknown>,
  ) {
    return this.lifecycle.createSession(
      this.buildCreateSessionConfig(conversationId, model, flags),
    );
  }

  async resumeConversationSession(
    conversationId: string,
    model: string,
    flags: Record<string, unknown>,
  ) {
    return this.lifecycle.resumeSession(
      conversationId,
      this.buildResumeSessionConfig(model, flags),
    );
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    model: string,
  ): Promise<void> {
    void message;
    void flags;
    void conversationId;
    void model;
    this.emitEvent({
      type: 'error',
      message: 'Copilot chat execution is not implemented yet',
    });
  }
}
