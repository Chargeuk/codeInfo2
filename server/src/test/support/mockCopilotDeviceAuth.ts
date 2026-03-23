import { append } from '../../logStore.js';

const TASK4_LOG_MARKER = 'story.0000051.task04.fake_auth_scenario_selected';

const verificationUrlRegex = /https?:\/\/\S+/i;
const userCodeRegex =
  /\b(?:one-time\s*code|user\s*code|code)\b\s*[:=\-]?\s*([A-Z0-9-]{6,})/i;

export type MockCopilotDeviceAuthCompletionState =
  | { status: 'completion_pending' }
  | { status: 'completed' }
  | { status: 'already_authenticated' }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable_before_start'; reason: string };

export type MockCopilotDeviceAuthStartResult =
  | {
      status: 'verification_ready';
      verificationUrl: string;
      userCode: string;
      rawOutput: string;
      completion: Promise<MockCopilotDeviceAuthCompletionState>;
    }
  | { status: 'already_authenticated' }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable_before_start'; reason: string };

type MockCopilotDeviceAuthState = {
  selectedScenario: string;
  startCount: number;
  completionReadCount: number;
  lastStartResult?: MockCopilotDeviceAuthStartResult['status'];
};

export type MockCopilotDeviceAuthScenario = {
  name: string;
  startResult?:
    | Exclude<
        MockCopilotDeviceAuthStartResult,
        { status: 'verification_ready'; completion: Promise<unknown> }
      >
    | {
        status: 'verification_ready';
        rawOutput: string;
      };
  completionSequence?: MockCopilotDeviceAuthCompletionState[];
};

export type MockCopilotDeviceAuthRouteBindings = {
  startDeviceAuth: () => Promise<MockCopilotDeviceAuthStartResult>;
  readDeviceAuthState: () => Promise<MockCopilotDeviceAuthCompletionState>;
};

export type MockCopilotDeviceAuthHarness = {
  startDeviceAuth(): Promise<MockCopilotDeviceAuthStartResult>;
  readDeviceAuthState(): Promise<MockCopilotDeviceAuthCompletionState>;
  createRouteBindings(): MockCopilotDeviceAuthRouteBindings;
  getState(): Readonly<MockCopilotDeviceAuthState>;
};

export function parseMockCopilotDeviceAuthOutput(rawOutput: string): {
  verificationUrl: string;
  userCode: string;
} | null {
  const verificationUrl = rawOutput.match(verificationUrlRegex)?.[0];
  const userCode = rawOutput.match(userCodeRegex)?.[1];
  if (!verificationUrl || !userCode) {
    return null;
  }
  return { verificationUrl, userCode };
}

/**
 * Build the canonical verification-ready fixture text used by later route tests.
 * Keep new auth output strings going through this helper so parsing stays stable.
 */
export function createVerificationReadyOutput(params?: {
  verificationUrl?: string;
  userCode?: string;
}): string {
  const verificationUrl =
    params?.verificationUrl ?? 'https://github.com/login/device';
  const userCode = params?.userCode ?? 'ABCD-EFGH';
  return [
    'To continue signing in with GitHub Copilot:',
    `1. Open ${verificationUrl}`,
    `2. Enter one-time code ${userCode}`,
  ].join('\n');
}

/**
 * Use these scenario builders instead of hand-writing route-test fixtures so
 * Task 9 can exercise one deterministic auth state machine everywhere.
 */
export function createVerificationReadyScenario(params?: {
  name?: string;
  verificationUrl?: string;
  userCode?: string;
  completionSequence?: MockCopilotDeviceAuthCompletionState[];
}): MockCopilotDeviceAuthScenario {
  return {
    name: params?.name ?? 'verification-ready',
    startResult: {
      status: 'verification_ready',
      rawOutput: createVerificationReadyOutput({
        verificationUrl: params?.verificationUrl,
        userCode: params?.userCode,
      }),
    },
    completionSequence: params?.completionSequence ?? [
      { status: 'completion_pending' },
      { status: 'completed' },
    ],
  };
}

export function createAlreadyAuthenticatedScenario(params?: {
  name?: string;
}): MockCopilotDeviceAuthScenario {
  return {
    name: params?.name ?? 'already-authenticated',
    startResult: { status: 'already_authenticated' },
    completionSequence: [{ status: 'already_authenticated' }],
  };
}

export function createCompletionPendingScenario(params?: {
  name?: string;
  verificationUrl?: string;
  userCode?: string;
}): MockCopilotDeviceAuthScenario {
  return createVerificationReadyScenario({
    name: params?.name ?? 'completion-pending',
    verificationUrl: params?.verificationUrl,
    userCode: params?.userCode,
    completionSequence: [{ status: 'completion_pending' }],
  });
}

export function createCompletedScenario(params?: {
  name?: string;
  verificationUrl?: string;
  userCode?: string;
}): MockCopilotDeviceAuthScenario {
  return createVerificationReadyScenario({
    name: params?.name ?? 'completed',
    verificationUrl: params?.verificationUrl,
    userCode: params?.userCode,
    completionSequence: [{ status: 'completed' }],
  });
}

export function createCliMissingScenario(params?: {
  name?: string;
  reason?: string;
}): MockCopilotDeviceAuthScenario {
  return {
    name: params?.name ?? 'cli-missing',
    startResult: {
      status: 'unavailable_before_start',
      reason: params?.reason ?? 'copilot not found',
    },
    completionSequence: [
      {
        status: 'unavailable_before_start',
        reason: params?.reason ?? 'copilot not found',
      },
    ],
  };
}

export function createExpiredCodeScenario(params?: {
  name?: string;
  verificationUrl?: string;
  userCode?: string;
}): MockCopilotDeviceAuthScenario {
  return createVerificationReadyScenario({
    name: params?.name ?? 'expired-code',
    verificationUrl: params?.verificationUrl,
    userCode: params?.userCode,
    completionSequence: [
      {
        status: 'failed',
        reason: 'device code expired or was declined',
      },
    ],
  });
}

export function createFailureScenario(params?: {
  name?: string;
  reason?: string;
}): MockCopilotDeviceAuthScenario {
  return {
    name: params?.name ?? 'failed',
    startResult: {
      status: 'failed',
      reason: params?.reason ?? 'copilot device auth failed',
    },
    completionSequence: [
      {
        status: 'failed',
        reason: params?.reason ?? 'copilot device auth failed',
      },
    ],
  };
}

function defaultScenario(): MockCopilotDeviceAuthScenario {
  return createVerificationReadyScenario({ name: 'default' });
}

export function createMockCopilotDeviceAuthHarness(
  input?: Partial<MockCopilotDeviceAuthScenario> & { name?: string },
): MockCopilotDeviceAuthHarness {
  const scenario: MockCopilotDeviceAuthScenario = {
    ...defaultScenario(),
    ...(input ?? {}),
    name: input?.name ?? defaultScenario().name,
  };

  const state: MockCopilotDeviceAuthState = {
    selectedScenario: scenario.name,
    startCount: 0,
    completionReadCount: 0,
  };

  append({
    level: 'info',
    message: TASK4_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      scenario: scenario.name,
    },
  });

  const completionQueue = [...(scenario.completionSequence ?? [])];
  let lastCompletionState =
    completionQueue.at(-1) ?? ({ status: 'completed' } as const);

  const readDeviceAuthState =
    async (): Promise<MockCopilotDeviceAuthCompletionState> => {
      state.completionReadCount += 1;
      if (completionQueue.length > 0) {
        lastCompletionState = completionQueue.shift() ?? lastCompletionState;
      }
      return lastCompletionState;
    };

  const startDeviceAuth =
    async (): Promise<MockCopilotDeviceAuthStartResult> => {
      state.startCount += 1;

      const startResult =
        scenario.startResult ??
        ({
          status: 'verification_ready',
          rawOutput: createVerificationReadyOutput(),
        } satisfies MockCopilotDeviceAuthScenario['startResult']);

      state.lastStartResult = startResult.status;
      if (startResult.status !== 'verification_ready') {
        return startResult;
      }

      const parsed = parseMockCopilotDeviceAuthOutput(startResult.rawOutput);
      if (!parsed) {
        return {
          status: 'failed',
          reason: 'device auth output not recognized',
        };
      }

      return {
        status: 'verification_ready',
        rawOutput: startResult.rawOutput,
        verificationUrl: parsed.verificationUrl,
        userCode: parsed.userCode,
        completion: readDeviceAuthState(),
      };
    };

  return {
    startDeviceAuth,
    readDeviceAuthState,
    // Future route tests can inject these callbacks directly without touching
    // production router wiring, which keeps the fake on the normal test seam.
    createRouteBindings: () => ({
      startDeviceAuth,
      readDeviceAuthState,
    }),
    getState: () => state,
  };
}
