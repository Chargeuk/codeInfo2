import {
  __resetAgentAvailabilityDepsForTests,
  __setAgentAvailabilityDepsForTests,
} from '../../agents/availability.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import {
  setCodexDetection,
  type CodexDetection,
} from '../../providers/codexRegistry.js';

type CodexModelCapability = {
  model: string;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
};

type DeterministicCodexBootstrapOptions = {
  models?: CodexModelCapability[];
};

const buildAvailableCodexDetection = (): CodexDetection => ({
  available: true,
  authPresent: true,
  configPresent: true,
  cliPath: '/usr/bin/codex',
  reason: undefined,
});

const buildDeterministicCodexCapabilities = (
  models: CodexModelCapability[] = [
    {
      model: 'gpt-5.3-codex',
      supportedReasoningEfforts: ['high'],
      defaultReasoningEffort: 'high',
    },
  ],
) => ({
  defaults: {
    sandboxMode: 'danger-full-access' as const,
    approvalPolicy: 'never' as const,
    modelReasoningEffort: 'high' as const,
    networkAccessEnabled: true,
    webSearchEnabled: false,
    webSearchMode: 'disabled' as const,
  },
  models: models.map((model) => ({
    model: model.model,
    supportedReasoningEfforts: model.supportedReasoningEfforts ?? ['high'],
    defaultReasoningEffort: model.defaultReasoningEffort ?? 'high',
  })),
  byModel: new Map(),
  warnings: [],
  fallbackUsed: false,
});

export function installDeterministicCodexAvailabilityBootstrap(
  options: DeterministicCodexBootstrapOptions = {},
) {
  const detection = buildAvailableCodexDetection();
  setCodexDetection(detection);
  __setAgentAvailabilityDepsForTests({
    getCodexDetection: () => detection,
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready' as const,
      models: ['copilot-gpt-5'],
      modelsRaw: [],
      authSource: 'env-token' as const,
    }),
    getLmStudioBaseUrl: () => undefined,
  });
  __setAgentServiceDepsForTests({
    getCodexDetection: () => detection,
    resolveCodexCapabilities: async () =>
      buildDeterministicCodexCapabilities(options.models),
    getMcpStatus: async () => ({ available: true }),
    resolveCopilotReadiness: async () => ({
      available: true,
      toolsAvailable: true,
      blockingStage: 'ready' as const,
      models: ['copilot-gpt-5'],
      modelsRaw: [],
      authSource: 'env-token' as const,
    }),
  });
}

export function resetDeterministicCodexAvailabilityBootstrap() {
  __resetAgentAvailabilityDepsForTests();
  __resetAgentServiceDepsForTests();
}
