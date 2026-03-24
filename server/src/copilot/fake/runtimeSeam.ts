import { type CopilotLifecycle } from '../../chat/copilotLifecycle.js';
import { append } from '../../logStore.js';
import { baseLogger } from '../../logger.js';
import type { CopilotReadinessRuntime } from '../../providers/copilotReadiness.js';
import {
  createCopilotAlreadyAuthenticatedResponse,
  createCopilotCompletedResponse,
  createCopilotCompletionPendingResponse,
  createCopilotFailedResponse,
  createCopilotUnavailableBeforeStartResponse,
  createCopilotVerificationReadyResponse,
  type CopilotDeviceAuthCompletion,
  type CopilotDeviceAuthResultWithCompletion,
  type CopilotDeviceAuthVerificationReady,
} from '../../utils/copilotDeviceAuth.js';
import {
  TASK16_LOG_MARKER,
  getTask16BootLogContext,
  resolveNamedCopilotScenarioFromEnv,
  type NamedCopilotScenarioDefinition,
} from './copilotScenarioCatalog.js';
import {
  createMockCopilotDeviceAuthHarness,
  type MockCopilotDeviceAuthCompletionState,
  type MockCopilotDeviceAuthStartResult,
} from './mockCopilotDeviceAuth.js';
import { createMockCopilotSdkHarness } from './mockCopilotSdk.js';

type RuntimeLike = CopilotReadinessRuntime & CopilotLifecycle;

type FakeCopilotRuntimeSeam = {
  scenario: NamedCopilotScenarioDefinition;
  createCopilotLifecycle: () => CopilotLifecycle;
  createCopilotReadinessRuntime: () => CopilotReadinessRuntime;
  createDeviceAuthRouterDeps: () => {
    getCopilotHome: () => string;
    getCopilotConfigDirForHome: (home: string) => string;
    ensureCopilotAuthFileStore: (configDir: string) => Promise<{
      changed: false;
      configDir: string;
    }>;
    runCopilotDeviceAuth: () => Promise<CopilotDeviceAuthResultWithCompletion>;
    readDeviceAuthState: () => Promise<MockCopilotDeviceAuthCompletionState>;
    resolveCopilotCli: () => { available: true; cliPath: string };
    createRuntime: () => RuntimeLike;
    env: NodeJS.ProcessEnv;
  };
};

const DEFAULT_FAKE_COPILOT_HOME = '/tmp/codeinfo2-compose-e2e-fake-copilot';
const DEFAULT_FAKE_CLI_PATH = '/app/copilot/fake-copilot-cli';

function mapCompletionResult(
  result: MockCopilotDeviceAuthCompletionState,
  source?: Pick<
    CopilotDeviceAuthVerificationReady,
    'verificationUrl' | 'userCode' | 'displayOutput'
  >,
): CopilotDeviceAuthCompletion['result'] {
  switch (result.status) {
    case 'completed':
      return createCopilotCompletedResponse();
    case 'already_authenticated':
      return createCopilotAlreadyAuthenticatedResponse();
    case 'failed':
      return createCopilotFailedResponse(result.reason);
    case 'unavailable_before_start':
      return createCopilotUnavailableBeforeStartResponse(result.reason);
    case 'completion_pending':
    default:
      if (!source) {
        return createCopilotCompletionPendingResponse({});
      }
      return createCopilotCompletionPendingResponse(source);
  }
}

function toDeviceAuthResult(
  startResult: MockCopilotDeviceAuthStartResult,
): CopilotDeviceAuthResultWithCompletion {
  if (startResult.status === 'already_authenticated') {
    const result = createCopilotAlreadyAuthenticatedResponse();
    return {
      ...result,
      completion: Promise.resolve({ exitCode: 0, result }),
    };
  }
  if (startResult.status === 'failed') {
    const result = createCopilotFailedResponse(startResult.reason);
    return {
      ...result,
      completion: Promise.resolve({ exitCode: 1, result }),
    };
  }
  if (startResult.status === 'unavailable_before_start') {
    const result = createCopilotUnavailableBeforeStartResponse(
      startResult.reason,
    );
    return {
      ...result,
      completion: Promise.resolve({ exitCode: 1, result }),
    };
  }

  const verificationReady = createCopilotVerificationReadyResponse({
    verificationUrl: startResult.verificationUrl,
    userCode: startResult.userCode,
    displayOutput: startResult.rawOutput,
  });

  return {
    ...verificationReady,
    completion: startResult.completion.then((completionState) => ({
      exitCode:
        completionState.status === 'completed' ||
        completionState.status === 'already_authenticated'
          ? 0
          : 1,
      result: mapCompletionResult(completionState, verificationReady),
    })),
  };
}

export function createFakeCopilotRuntimeSeamFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FakeCopilotRuntimeSeam | null {
  const scenario = resolveNamedCopilotScenarioFromEnv(env);
  if (!scenario) {
    return null;
  }

  const sdkHarnessFactory = () =>
    createMockCopilotSdkHarness({
      name: scenario.sdkScenario.name ?? scenario.name,
      ...scenario.sdkScenario,
    });
  const authHarness = createMockCopilotDeviceAuthHarness({
    name: scenario.authScenario.name ?? `${scenario.name}-auth`,
    ...scenario.authScenario,
  });
  const copilotHome = DEFAULT_FAKE_COPILOT_HOME;
  const configDir = `${copilotHome}/config`;
  const bootContext = getTask16BootLogContext({
    scenarioName: scenario.name,
    surface: 'compose-e2e',
  });

  append({
    level: 'info',
    message: TASK16_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: bootContext,
  });
  baseLogger.info(bootContext, TASK16_LOG_MARKER);

  return {
    scenario,
    createCopilotLifecycle: () => sdkHarnessFactory().createLifecycle(),
    createCopilotReadinessRuntime: () =>
      sdkHarnessFactory().createLifecycle() as RuntimeLike,
    createDeviceAuthRouterDeps: () => ({
      getCopilotHome: () => copilotHome,
      getCopilotConfigDirForHome: () => configDir,
      ensureCopilotAuthFileStore: async () => ({
        changed: false as const,
        configDir,
      }),
      runCopilotDeviceAuth: async () =>
        toDeviceAuthResult(await authHarness.startDeviceAuth()),
      readDeviceAuthState: async () => authHarness.readDeviceAuthState(),
      resolveCopilotCli: () => ({
        available: true as const,
        cliPath: DEFAULT_FAKE_CLI_PATH,
      }),
      createRuntime: () => sdkHarnessFactory().createLifecycle() as RuntimeLike,
      env,
    }),
  };
}
