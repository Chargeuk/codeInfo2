import {
  getCodexDetection,
  setCodexDetection,
  type CodexDetection,
} from '../../providers/codexRegistry.js';
import {
  __resetAgentAvailabilityDepsForTests,
  __setAgentAvailabilityDepsForTests,
} from '../../agents/availability.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
} from '../../agents/service.js';
import {
  enterTestOverrideScope,
  hasActiveTestOverrideScope,
  runWithTestOverrides,
} from './testOverrideScope.js';

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
    {
      model: 'gpt-5.2-codex',
      supportedReasoningEfforts: ['medium', 'high'],
      defaultReasoningEffort: 'medium',
    },
    {
      model: 'gpt-5.1-codex-max',
      supportedReasoningEfforts: ['medium', 'high'],
      defaultReasoningEffort: 'medium',
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

const buildDeterministicBootstrapOverrides = (
  options: DeterministicCodexBootstrapOptions = {},
) => {
  const detection = buildAvailableCodexDetection();
  const resolveCopilotReadiness = async () => ({
    available: true,
    toolsAvailable: true,
    blockingStage: 'ready' as const,
    models: ['copilot-gpt-5'],
    modelsRaw: [],
    authSource: 'env-token' as const,
  });

  return {
    codexDetection: detection,
    agentAvailabilityDeps: {
      getCodexDetection,
      getMcpStatus: async () => ({ available: true }),
      resolveCopilotReadiness,
      getLmStudioBaseUrl: () => undefined,
    },
    agentServiceDeps: {
      getCodexDetection,
      resolveCodexCapabilities: async () =>
        buildDeterministicCodexCapabilities(options.models),
      getMcpStatus: async () => ({ available: true }),
      resolveCopilotReadiness,
    },
  };
};

export function installDeterministicCodexAvailabilityBootstrap(
  options: DeterministicCodexBootstrapOptions = {},
) {
  const overrides = buildDeterministicBootstrapOverrides(options);
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope(overrides);
    return;
  }
  setCodexDetection(overrides.codexDetection);
  __setAgentAvailabilityDepsForTests(overrides.agentAvailabilityDeps);
  __setAgentServiceDepsForTests(overrides.agentServiceDeps);
}

export function resetDeterministicCodexAvailabilityBootstrap() {
  if (hasActiveTestOverrideScope()) {
    enterTestOverrideScope({
      codexDetection: null,
      agentAvailabilityDeps: null,
      agentServiceDeps: null,
    });
    return;
  }
  setCodexDetection({
    available: false,
    authPresent: false,
    configPresent: false,
    reason: 'not detected',
  });
  __resetAgentAvailabilityDepsForTests();
  __resetAgentServiceDepsForTests();
}

export async function withDeterministicCodexAvailabilityBootstrap<T>(
  fn: () => Promise<T>,
  options: DeterministicCodexBootstrapOptions = {},
): Promise<T> {
  return await runWithTestOverrides(
    buildDeterministicBootstrapOverrides(options),
    fn,
  );
}
