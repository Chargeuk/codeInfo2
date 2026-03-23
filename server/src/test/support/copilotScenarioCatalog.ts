import type {
  ProviderAuthResponseFor,
  ChatProviderId,
} from '@codeinfo2/common';
import type {
  ChatModelInfo,
  ChatModelsResponse,
  ChatProviderInfo,
} from '@codeinfo2/common';

import {
  createAlreadyAuthenticatedScenario,
  createCompletionPendingScenario,
  type MockCopilotDeviceAuthScenario,
} from './mockCopilotDeviceAuth.js';
import {
  createAssistantMessageDeltaEvent,
  createAssistantMessageEvent,
  createSessionErrorEvent,
  createSessionIdleEvent,
  type MockCopilotSdkScenario,
} from './mockCopilotSdk.js';

export const TASK16_LOG_MARKER = 'story.0000051.task16.fake_scenario_booted';
export const ORDERED_TASK16_PROVIDER_IDS: ChatProviderId[] = [
  'codex',
  'copilot',
  'lmstudio',
];
export const DEFAULT_TASK16_SCENARIO = 'copilot-happy-path' as const;

const CODEX_DISABLED_REASON =
  'Missing auth.json in ./codex and config.toml in ./codex';
const COPILOT_AUTH_REQUIRED_REASON = 'copilot authentication required';
const LMSTUDIO_ENABLED_MODELS: ChatModelInfo[] = [
  {
    key: 'lmstudio-test-model',
    displayName: 'LM Studio Test Model',
    type: 'gguf',
  },
];

type E2ECopilotScenarioFixture = {
  providers: ChatProviderInfo[];
  copilotModels: ChatModelsResponse;
  copilotAuthResponse: ProviderAuthResponseFor<'copilot'>;
  chatStream: {
    assistantDeltas: string[];
    analysisDeltas?: string[];
    finalStatus?: 'ok' | 'failed';
    finalError?: { code?: string; message?: string } | null;
  };
};

export type NamedCopilotScenarioDefinition = {
  name: NamedCopilotScenario;
  description: string;
  sdkScenario: Partial<MockCopilotSdkScenario> & { name?: string };
  authScenario: Partial<MockCopilotDeviceAuthScenario> & { name?: string };
  lmstudioAvailable: boolean;
  mcpAvailable: boolean;
  e2e: E2ECopilotScenarioFixture;
};

const withProviderOrder = (copilot: ChatProviderInfo): ChatProviderInfo[] => [
  {
    id: 'codex',
    label: 'OpenAI Codex',
    available: false,
    toolsAvailable: false,
    reason: CODEX_DISABLED_REASON,
  },
  copilot,
  {
    id: 'lmstudio',
    label: 'LM Studio',
    available: true,
    toolsAvailable: true,
  },
];

const buildCopilotModelsResponse = (
  available: boolean,
  models: ChatModelInfo[],
  reason?: string,
): ChatModelsResponse => ({
  provider: 'copilot',
  available,
  toolsAvailable: available,
  models,
  ...(reason ? { reason } : {}),
});

const COPILOT_MODEL: ChatModelInfo = {
  key: 'copilot-gpt-5',
  displayName: 'Copilot GPT-5',
  type: 'copilot',
  supportedReasoningEfforts: ['low', 'medium', 'high'],
  defaultReasoningEffort: 'medium',
};

const COPILOT_MODEL_INFO_CAPABILITIES = {
  supports: {
    vision: false,
    reasoningEffort: true,
  },
  limits: {
    max_context_window_tokens: 200000,
  },
} as const;

export const NAMED_COPILOT_SCENARIOS = [
  DEFAULT_TASK16_SCENARIO,
  'copilot-auth-required',
  'copilot-stream-error',
] as const;

export type NamedCopilotScenario = (typeof NAMED_COPILOT_SCENARIOS)[number];

const scenarioDefinitions: Record<
  NamedCopilotScenario,
  NamedCopilotScenarioDefinition
> = {
  'copilot-happy-path': {
    name: 'copilot-happy-path',
    description:
      'Copilot is ready, lists models, and streams a successful turn.',
    sdkScenario: {
      name: 'task16-happy-path',
      authStatus: {
        isAuthenticated: true,
        authType: 'user',
        statusMessage: 'authenticated',
      },
      models: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: COPILOT_MODEL_INFO_CAPABILITIES,
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
        },
      ],
      createSessionEvents: [
        createAssistantMessageDeltaEvent({
          messageId: 'task16-happy-message',
          deltaContent: 'Hello from fake Copilot',
        }),
        createAssistantMessageEvent({
          messageId: 'task16-happy-message',
          content: 'Hello from fake Copilot',
        }),
        createSessionIdleEvent(),
      ],
    },
    authScenario: createAlreadyAuthenticatedScenario({
      name: 'task16-authenticated',
    }),
    lmstudioAvailable: true,
    mcpAvailable: true,
    e2e: {
      providers: withProviderOrder({
        id: 'copilot',
        label: 'GitHub Copilot',
        available: true,
        toolsAvailable: true,
      }),
      copilotModels: buildCopilotModelsResponse(true, [COPILOT_MODEL]),
      copilotAuthResponse: {
        provider: 'copilot',
        state: 'already_authenticated',
      },
      chatStream: {
        assistantDeltas: ['Hello from fake Copilot'],
        analysisDeltas: ['boot path trace'],
        finalStatus: 'ok',
      },
    },
  },
  'copilot-auth-required': {
    name: 'copilot-auth-required',
    description:
      'Copilot is discoverable but blocked on authentication and exposes verification-ready auth.',
    sdkScenario: {
      name: 'task16-auth-required',
      authStatus: {
        isAuthenticated: false,
        authType: 'token',
        statusMessage: 'authentication required',
      },
      models: [],
    },
    authScenario: createCompletionPendingScenario({
      name: 'task16-verification-required',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'TASK16-ABCD',
    }),
    lmstudioAvailable: true,
    mcpAvailable: true,
    e2e: {
      providers: withProviderOrder({
        id: 'copilot',
        label: 'GitHub Copilot',
        available: false,
        toolsAvailable: false,
        reason: COPILOT_AUTH_REQUIRED_REASON,
      }),
      copilotModels: buildCopilotModelsResponse(
        false,
        [],
        COPILOT_AUTH_REQUIRED_REASON,
      ),
      copilotAuthResponse: {
        provider: 'copilot',
        state: 'verification_ready',
        verificationUrl: 'https://github.com/login/device',
        userCode: 'TASK16-ABCD',
        displayOutput:
          'To continue signing in with GitHub Copilot:\n1. Open https://github.com/login/device\n2. Enter one-time code TASK16-ABCD',
      },
      chatStream: {
        assistantDeltas: [],
        finalStatus: 'failed',
        finalError: {
          code: 'AUTH_REQUIRED',
          message: COPILOT_AUTH_REQUIRED_REASON,
        },
      },
    },
  },
  'copilot-stream-error': {
    name: 'copilot-stream-error',
    description:
      'Copilot is ready but the session emits a deterministic streamed failure.',
    sdkScenario: {
      name: 'task16-stream-error',
      authStatus: {
        isAuthenticated: true,
        authType: 'user',
        statusMessage: 'authenticated',
      },
      models: [
        {
          id: 'copilot-gpt-5',
          name: 'Copilot GPT-5',
          capabilities: COPILOT_MODEL_INFO_CAPABILITIES,
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          defaultReasoningEffort: 'medium',
        },
      ],
      createSessionEvents: [
        createAssistantMessageDeltaEvent({
          messageId: 'task16-error-message',
          deltaContent: 'Partial response',
        }),
        createSessionErrorEvent('copilot fake scenario failed'),
      ],
    },
    authScenario: createAlreadyAuthenticatedScenario({
      name: 'task16-error-authenticated',
    }),
    lmstudioAvailable: true,
    mcpAvailable: true,
    e2e: {
      providers: withProviderOrder({
        id: 'copilot',
        label: 'GitHub Copilot',
        available: true,
        toolsAvailable: true,
      }),
      copilotModels: buildCopilotModelsResponse(true, [COPILOT_MODEL]),
      copilotAuthResponse: {
        provider: 'copilot',
        state: 'already_authenticated',
      },
      chatStream: {
        assistantDeltas: ['Partial response'],
        finalStatus: 'failed',
        finalError: {
          code: 'STREAM_FAILED',
          message: 'copilot fake scenario failed',
        },
      },
    },
  },
};

export function isNamedCopilotScenario(
  value: string | undefined | null,
): value is NamedCopilotScenario {
  return NAMED_COPILOT_SCENARIOS.includes(value as NamedCopilotScenario);
}

export function normalizeNamedCopilotScenario(
  value: string | undefined | null,
): NamedCopilotScenario | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isNamedCopilotScenario(trimmed) ? trimmed : null;
}

export function resolveNamedCopilotScenario(
  value: string | undefined | null,
): NamedCopilotScenarioDefinition {
  const normalized = normalizeNamedCopilotScenario(value);
  if (!normalized) {
    throw new Error(`Unknown fake Copilot scenario: ${value ?? '[missing]'}`);
  }
  return scenarioDefinitions[normalized];
}

export function resolveNamedCopilotScenarioFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): NamedCopilotScenarioDefinition | null {
  const explicit =
    env.CODEINFO_FAKE_COPILOT_SCENARIO ?? env.E2E_COPILOT_SCENARIO;
  const normalized = normalizeNamedCopilotScenario(explicit);
  return normalized ? scenarioDefinitions[normalized] : null;
}

export function getTask16BootLogContext(params: {
  scenarioName: NamedCopilotScenario;
  surface: 'integration' | 'cucumber' | 'e2e';
}) {
  return {
    scenario: params.scenarioName,
    surface: params.surface,
  };
}

export function getTask16LmStudioModels(): ChatModelInfo[] {
  return LMSTUDIO_ENABLED_MODELS.map((model) => ({ ...model }));
}
