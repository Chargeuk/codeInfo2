import {
  type AssistantMessageEvent,
  type GetAuthStatusResponse,
  type ModelInfo,
  type PermissionHandler,
  type ResumeSessionConfig,
  type SessionConfig,
  type SessionEvent,
  type SessionEventHandler,
  type SessionEventType,
} from '@github/copilot-sdk';
import type { CopilotSession } from '@github/copilot-sdk';
import {
  CopilotLifecycle,
  type CopilotRuntimeClient,
  type CopilotRuntimeFactory,
} from '../../chat/copilotLifecycle.js';
import { append } from '../../logStore.js';

const TASK3_LOG_MARKER = 'story.0000051.task03.fake_sdk_scenario_selected';

export type MockCopilotSdkScenario = {
  name: string;
  startError?: Error;
  stopErrors?: Error[];
  pingResponse?: {
    message: string;
    timestamp: number;
    protocolVersion?: number;
  };
  authStatus?: GetAuthStatusResponse;
  models?: ModelInfo[];
  createSessionEvents?: SessionEvent[];
  resumeSessionEvents?: SessionEvent[];
  createSessionError?: Error;
  resumeSessionError?: Error;
  createRegisterHooksError?: Error;
  resumeRegisterHooksError?: Error;
  createRegisterToolsError?: Error;
  resumeRegisterToolsError?: Error;
  sendError?: Error;
  sendDelayMs?: number;
};

type MockCopilotHarnessState = {
  started: boolean;
  startCount: number;
  stopCount: number;
  lastCreateSessionConfig?: SessionConfig;
  lastResumeSession?: { sessionId: string; config: ResumeSessionConfig };
  createRegisterHooksCount: number;
  resumeRegisterHooksCount: number;
  createRegisterToolsCount: number;
  resumeRegisterToolsCount: number;
  lastRegisteredPermissionHandler?: PermissionHandler;
  lastRegisteredHooks?: Parameters<CopilotSession['registerHooks']>[0];
  selectedScenario: string;
};

const defaultModel = (overrides?: Partial<ModelInfo>): ModelInfo => ({
  id: 'copilot-gpt-5',
  name: 'Copilot GPT-5',
  capabilities: {
    supports: {
      vision: false,
      reasoningEffort: true,
    },
    limits: {
      max_context_window_tokens: 200000,
    },
  },
  supportedReasoningEfforts: ['low', 'medium', 'high'] satisfies Array<
    'low' | 'medium' | 'high' | 'xhigh'
  >,
  defaultReasoningEffort: 'medium',
  ...overrides,
});

const defaultAuthStatus = (): GetAuthStatusResponse => ({
  isAuthenticated: true,
  authType: 'user',
  statusMessage: 'authenticated',
});

let eventCounter = 0;

const nextEventMeta = <T extends SessionEvent['type']>(type: T) => ({
  id: `mock-copilot-event-${++eventCounter}`,
  timestamp: new Date(2025, 0, 1, 0, 0, eventCounter).toISOString(),
  parentId: null,
  type,
});

export function createAssistantMessageDeltaEvent(params?: {
  messageId?: string;
  deltaContent?: string;
}): SessionEvent {
  return {
    ...nextEventMeta('assistant.message_delta'),
    ephemeral: true,
    data: {
      messageId: params?.messageId ?? 'message-1',
      deltaContent: params?.deltaContent ?? 'Hello',
    },
  };
}

export function createAssistantMessageEvent(params?: {
  messageId?: string;
  content?: string;
}): SessionEvent {
  return {
    ...nextEventMeta('assistant.message'),
    data: {
      messageId: params?.messageId ?? 'message-1',
      content: params?.content ?? 'Hello from Copilot',
    },
  };
}

export function createToolExecutionStartEvent(params?: {
  toolCallId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
}): SessionEvent {
  return {
    ...nextEventMeta('tool.execution_start'),
    data: {
      toolCallId: params?.toolCallId ?? 'tool-call-1',
      toolName: params?.toolName ?? 'read_file',
      arguments: params?.arguments ?? { path: '/tmp/example.ts' },
    },
  };
}

export function createToolExecutionCompleteEvent(params?: {
  toolCallId?: string;
  success?: boolean;
  content?: string;
}): SessionEvent {
  return {
    ...nextEventMeta('tool.execution_complete'),
    data: {
      toolCallId: params?.toolCallId ?? 'tool-call-1',
      success: params?.success ?? true,
      result: {
        content: params?.content ?? 'tool finished',
      },
    },
  };
}

export function createSessionIdleEvent(): SessionEvent {
  return {
    ...nextEventMeta('session.idle'),
    ephemeral: true,
    data: {},
  };
}

export function createSessionErrorEvent(
  message = 'copilot session failed',
): SessionEvent {
  return {
    ...nextEventMeta('session.error'),
    data: {
      errorType: 'runtime',
      message,
    },
  };
}

const defaultScenario = (): MockCopilotSdkScenario => ({
  name: 'default',
  pingResponse: {
    message: 'mock-copilot-ok',
    timestamp: Date.now(),
  },
  authStatus: defaultAuthStatus(),
  models: [defaultModel()],
  createSessionEvents: [
    createAssistantMessageDeltaEvent(),
    createAssistantMessageEvent(),
    createSessionIdleEvent(),
  ],
  resumeSessionEvents: [
    createToolExecutionStartEvent(),
    createToolExecutionCompleteEvent(),
    createSessionIdleEvent(),
  ],
});

class MockCopilotSession {
  private readonly handlers = new Set<SessionEventHandler>();
  private readonly typedHandlers = new Map<
    SessionEventType,
    Set<(event: SessionEvent) => void>
  >();

  private readonly registerPhase: 'create' | 'resume';

  private readonly scenario: MockCopilotSdkScenario;

  private readonly state: MockCopilotHarnessState;

  private readonly onEvent?: SessionEventHandler;

  constructor(
    readonly sessionId: string,
    private readonly scriptedEvents: SessionEvent[],
    registerPhase: 'create' | 'resume',
    scenario: MockCopilotSdkScenario,
    state: MockCopilotHarnessState,
    onEvent?: SessionEventHandler,
  ) {
    this.registerPhase = registerPhase;
    this.scenario = scenario;
    this.state = state;
    this.onEvent = onEvent;
  }

  on<K extends SessionEventType>(
    eventType: K,
    handler: (event: Extract<SessionEvent, { type: K }>) => void,
  ): () => void;
  on(handler: SessionEventHandler): () => void;
  on<K extends SessionEventType>(
    eventTypeOrHandler: K | SessionEventHandler,
    handler?: (event: Extract<SessionEvent, { type: K }>) => void,
  ): () => void {
    if (typeof eventTypeOrHandler === 'function') {
      const untypedHandler = eventTypeOrHandler;
      this.handlers.add(untypedHandler);
      return () => this.handlers.delete(untypedHandler);
    }

    const typedSet =
      this.typedHandlers.get(eventTypeOrHandler) ??
      new Set<(event: SessionEvent) => void>();
    if (handler) {
      typedSet.add(handler as (event: SessionEvent) => void);
    }
    this.typedHandlers.set(eventTypeOrHandler, typedSet);
    return () =>
      this.typedHandlers
        .get(eventTypeOrHandler)
        ?.delete(handler as (event: SessionEvent) => void);
  }

  async emitScriptedEvents(): Promise<AssistantMessageEvent | undefined> {
    let lastAssistantMessage: AssistantMessageEvent | undefined;
    for (const event of this.scriptedEvents) {
      if (event.type === 'assistant.message') {
        lastAssistantMessage = event as AssistantMessageEvent;
      }
      this.onEvent?.(event);
      this.handlers.forEach((registered) => registered(event));
      this.typedHandlers
        .get(event.type)
        ?.forEach((registered) => registered(event as never));
    }
    return lastAssistantMessage;
  }

  async send(): Promise<string> {
    if (this.scenario.sendError) throw this.scenario.sendError;
    if (this.scenario.sendDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.scenario.sendDelayMs),
      );
    }
    await this.emitScriptedEvents();
    return this.sessionId;
  }

  async sendAndWait(): Promise<AssistantMessageEvent | undefined> {
    if (this.scenario.sendError) throw this.scenario.sendError;
    if (this.scenario.sendDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.scenario.sendDelayMs),
      );
    }
    return this.emitScriptedEvents();
  }

  registerTools(): void {
    if (this.registerPhase === 'create') {
      this.state.createRegisterToolsCount += 1;
      if (this.scenario.createRegisterToolsError) {
        throw this.scenario.createRegisterToolsError;
      }
      return;
    }

    this.state.resumeRegisterToolsCount += 1;
    if (this.scenario.resumeRegisterToolsError) {
      throw this.scenario.resumeRegisterToolsError;
    }
  }

  registerPermissionHandler(handler?: PermissionHandler): void {
    this.state.lastRegisteredPermissionHandler = handler;
  }

  registerHooks(hooks?: Parameters<CopilotSession['registerHooks']>[0]): void {
    if (this.registerPhase === 'create') {
      this.state.createRegisterHooksCount += 1;
      if (this.scenario.createRegisterHooksError) {
        throw this.scenario.createRegisterHooksError;
      }
    } else {
      this.state.resumeRegisterHooksCount += 1;
      if (this.scenario.resumeRegisterHooksError) {
        throw this.scenario.resumeRegisterHooksError;
      }
    }
    this.state.lastRegisteredHooks = hooks;
  }

  async disconnect(): Promise<void> {
    this.handlers.clear();
    this.typedHandlers.clear();
  }
}

export type MockCopilotSdkHarness = {
  createClientFactory(): CopilotRuntimeFactory;
  createLifecycle(): CopilotLifecycle;
  getState(): Readonly<MockCopilotHarnessState>;
};

/**
 * Create an isolated fake Copilot SDK harness for one named scenario.
 * Later tests can construct multiple harnesses without sharing hidden globals.
 */
export function createMockCopilotSdkHarness(
  input?: Partial<MockCopilotSdkScenario> & { name?: string },
): MockCopilotSdkHarness {
  const scenario: MockCopilotSdkScenario = {
    ...defaultScenario(),
    ...(input ?? {}),
    name: input?.name ?? defaultScenario().name,
  };

  const state: MockCopilotHarnessState = {
    started: false,
    startCount: 0,
    stopCount: 0,
    createRegisterHooksCount: 0,
    resumeRegisterHooksCount: 0,
    createRegisterToolsCount: 0,
    resumeRegisterToolsCount: 0,
    selectedScenario: scenario.name,
  };

  append({
    level: 'info',
    message: TASK3_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      scenario: scenario.name,
    },
  });

  const createSession = async (config: SessionConfig) => {
    state.lastCreateSessionConfig = config;
    if (scenario.createSessionError) throw scenario.createSessionError;
    return new MockCopilotSession(
      config.sessionId ?? 'mock-create-session',
      scenario.createSessionEvents ?? [],
      'create',
      scenario,
      state,
      config.onEvent,
    ) as unknown as Awaited<ReturnType<CopilotRuntimeClient['createSession']>>;
  };

  const resumeSession = async (
    sessionId: string,
    config: ResumeSessionConfig,
  ) => {
    state.lastResumeSession = { sessionId, config };
    if (scenario.resumeSessionError) throw scenario.resumeSessionError;
    return new MockCopilotSession(
      sessionId,
      scenario.resumeSessionEvents ?? [],
      'resume',
      scenario,
      state,
      config.onEvent,
    ) as unknown as Awaited<ReturnType<CopilotRuntimeClient['resumeSession']>>;
  };

  const clientFactory = (): CopilotRuntimeClient => ({
    start: async () => {
      state.startCount += 1;
      if (scenario.startError) throw scenario.startError;
      state.started = true;
    },
    stop: async () => {
      state.stopCount += 1;
      state.started = false;
      return scenario.stopErrors ?? [];
    },
    ping: async (message?: string) => ({
      message: message ?? scenario.pingResponse?.message ?? 'mock-copilot-ok',
      timestamp: scenario.pingResponse?.timestamp ?? Date.now(),
      ...(scenario.pingResponse?.protocolVersion
        ? { protocolVersion: scenario.pingResponse.protocolVersion }
        : {}),
    }),
    getAuthStatus: async () => scenario.authStatus ?? defaultAuthStatus(),
    listModels: async () => scenario.models ?? [defaultModel()],
    createSession,
    resumeSession,
  });

  return {
    createClientFactory: () => clientFactory,
    createLifecycle: () =>
      new CopilotLifecycle({
        clientFactory: clientFactory,
      }),
    getState: () => state,
  };
}
