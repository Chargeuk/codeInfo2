import { spawn } from 'node:child_process';

import type {
  ProviderAuthAlreadyAuthenticatedResponse,
  ProviderAuthCompletionPendingResponse,
  ProviderAuthFailedResponse,
  ProviderAuthResponseFor,
  ProviderAuthUnavailableBeforeStartResponse,
  ProviderAuthVerificationReadyResponse,
} from '@codeinfo2/common';

import { buildCopilotClientOptions } from '../config/copilotConfig.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { truncateText } from './truncateText.js';

const TASK9_LOG_MARKER = 'story.0000051.task09.device_auth_state_emitted';

export type CopilotDeviceAuthVerificationReady =
  ProviderAuthVerificationReadyResponse<'copilot'>;
export type CopilotDeviceAuthCompletionPending =
  ProviderAuthCompletionPendingResponse<'copilot'>;
export type CopilotDeviceAuthCompleted = ProviderAuthResponseFor<'copilot'> & {
  provider: 'copilot';
  state: 'completed';
};
export type CopilotDeviceAuthAlreadyAuthenticated =
  ProviderAuthAlreadyAuthenticatedResponse<'copilot'>;
export type CopilotDeviceAuthFailure = ProviderAuthFailedResponse<'copilot'>;
export type CopilotDeviceAuthUnavailableBeforeStart =
  ProviderAuthUnavailableBeforeStartResponse<'copilot'>;

export type CopilotDeviceAuthResult =
  | CopilotDeviceAuthVerificationReady
  | CopilotDeviceAuthAlreadyAuthenticated
  | CopilotDeviceAuthFailure
  | CopilotDeviceAuthUnavailableBeforeStart;

export type CopilotDeviceAuthCompletion = {
  exitCode: number | null;
  result:
    | CopilotDeviceAuthCompleted
    | CopilotDeviceAuthAlreadyAuthenticated
    | CopilotDeviceAuthFailure
    | CopilotDeviceAuthUnavailableBeforeStart
    | CopilotDeviceAuthCompletionPending;
};

export type CopilotDeviceAuthState =
  | CopilotDeviceAuthResult
  | CopilotDeviceAuthCompletionPending
  | CopilotDeviceAuthCompletion['result'];

export type CopilotDeviceAuthResultWithCompletion = CopilotDeviceAuthResult & {
  completion: Promise<CopilotDeviceAuthCompletion>;
};

type CopilotDeviceAuthRunSummary = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const deviceAuthErrorMessage = 'device auth output not recognized';
const deviceAuthExpiredMessage = 'device code expired or was declined';
const deviceAuthExitMessage = 'device auth command failed';

const verificationUrlRegex = /https?:\/\/\S+/i;
const userCodeRegex =
  /\b(?:one-time\s*code|user\s*code|code)\b\s*[:=\-]?\s*([A-Z0-9-]{6,})/i;
const verificationUrlRedactRegex = /https?:\/\/\S+/gi;
const userCodeRedactRegex =
  /\b(?:one-time\s*code|user\s*code|code)\b\s*[:=\-]?\s*[A-Z0-9-]{6,}/gi;
const expiredRegex = /(expired|declined)/i;

function normalizeCopilotAuthResponse<
  T extends { provider: 'copilot'; state: string },
>(response: T): T {
  const context = {
    provider: response.provider,
    state: response.state,
  };
  append({
    level: 'info',
    message: TASK9_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
  baseLogger.info(context, TASK9_LOG_MARKER);
  return response;
}

export function createCopilotVerificationReadyResponse(params: {
  verificationUrl: string;
  userCode: string;
  displayOutput: string;
}): CopilotDeviceAuthVerificationReady {
  return normalizeCopilotAuthResponse({
    provider: 'copilot',
    state: 'verification_ready',
    verificationUrl: params.verificationUrl,
    userCode: params.userCode,
    displayOutput: params.displayOutput,
  });
}

export function createCopilotCompletionPendingResponse(
  source: Pick<
    CopilotDeviceAuthCompletionPending,
    'verificationUrl' | 'userCode' | 'displayOutput'
  >,
): CopilotDeviceAuthCompletionPending {
  return normalizeCopilotAuthResponse({
    provider: 'copilot',
    state: 'completion_pending',
    verificationUrl: source.verificationUrl,
    userCode: source.userCode,
    displayOutput: source.displayOutput,
  });
}

export function createCopilotCompletedResponse(): CopilotDeviceAuthCompleted {
  return normalizeCopilotAuthResponse({
    provider: 'copilot',
    state: 'completed',
  });
}

export function createCopilotAlreadyAuthenticatedResponse(): CopilotDeviceAuthAlreadyAuthenticated {
  return normalizeCopilotAuthResponse({
    provider: 'copilot',
    state: 'already_authenticated',
  });
}

export function createCopilotFailedResponse(
  reason: string,
  displayOutput?: string,
): CopilotDeviceAuthFailure {
  return normalizeCopilotAuthResponse({
    provider: 'copilot',
    state: 'failed',
    reason,
    ...(displayOutput ? { displayOutput } : {}),
  });
}

export function createCopilotUnavailableBeforeStartResponse(
  reason: string,
): CopilotDeviceAuthUnavailableBeforeStart {
  return normalizeCopilotAuthResponse({
    provider: 'copilot',
    state: 'unavailable_before_start',
    reason,
  });
}

export function parseCopilotDeviceAuthOutput(
  stdout: string,
): CopilotDeviceAuthResult {
  const normalized = stripAnsi(stdout);
  const verificationUrl = normalized.match(verificationUrlRegex)?.[0];
  const userCode = normalized.match(userCodeRegex)?.[1];

  if (!verificationUrl || !userCode) {
    return createCopilotFailedResponse(deviceAuthErrorMessage);
  }

  return createCopilotVerificationReadyResponse({
    verificationUrl,
    userCode,
    displayOutput: normalized,
  });
}

function resolveCopilotDeviceAuthResult(
  summary: CopilotDeviceAuthRunSummary,
): CopilotDeviceAuthCompletion['result'] {
  const normalizedStdout = stripAnsi(summary.stdout);
  const normalizedStderr = stripAnsi(summary.stderr);

  if (
    expiredRegex.test(normalizedStdout) ||
    expiredRegex.test(normalizedStderr)
  ) {
    return createCopilotFailedResponse(deviceAuthExpiredMessage);
  }

  if (summary.exitCode && summary.exitCode !== 0) {
    return createCopilotFailedResponse(deviceAuthExitMessage);
  }

  const parsed = parseCopilotDeviceAuthOutput(summary.stdout);
  if (parsed.state === 'verification_ready') {
    return createCopilotCompletedResponse();
  }
  return parsed;
}

function resolveInitialCopilotDeviceAuthResult(
  summary: CopilotDeviceAuthRunSummary,
): CopilotDeviceAuthResult {
  const normalizedStdout = stripAnsi(summary.stdout);
  const normalizedStderr = stripAnsi(summary.stderr);

  if (
    expiredRegex.test(normalizedStdout) ||
    expiredRegex.test(normalizedStderr)
  ) {
    return createCopilotFailedResponse(deviceAuthExpiredMessage);
  }

  if (summary.exitCode && summary.exitCode !== 0) {
    return createCopilotFailedResponse(deviceAuthExitMessage);
  }

  return parseCopilotDeviceAuthOutput(summary.stdout);
}

export async function runCopilotDeviceAuth(params?: {
  copilotHome?: string;
  cliPath?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof spawn;
}): Promise<CopilotDeviceAuthResultWithCompletion> {
  const resolved = buildCopilotClientOptions({
    copilotHome: params?.copilotHome,
    cliPath: params?.cliPath,
    env: params?.env,
  });
  const command = params?.cliPath ?? 'copilot';
  const spawnFn = params?.spawnFn ?? spawn;

  baseLogger.info(
    {
      copilotHome: resolved.copilotHome,
      configDir: resolved.configDir,
      cliMode: resolved.cliMode,
    },
    'DEV-0000051:T9:copilot_device_auth_cli_start',
  );

  return new Promise((resolve) => {
    const child = spawnFn(command, ['login'], {
      env: resolved.clientOptions.env,
    });
    let stdout = '';
    let stderr = '';
    let resolvedInitial = false;
    let completionResolved = false;
    let resolveCompletion: (value: CopilotDeviceAuthCompletion) => void;
    const completion = new Promise<CopilotDeviceAuthCompletion>((done) => {
      resolveCompletion = done;
    });

    const finalizeCompletion = (summary: CopilotDeviceAuthRunSummary) => {
      if (completionResolved) return;
      completionResolved = true;
      const result = resolveCopilotDeviceAuthResult(summary);
      resolveCompletion({ exitCode: summary.exitCode, result });
    };

    const finalize = (
      summary: CopilotDeviceAuthRunSummary,
      resolvedResult?: CopilotDeviceAuthResult,
    ) => {
      if (resolvedInitial) return;
      resolvedInitial = true;
      const result =
        resolvedResult ?? resolveInitialCopilotDeviceAuthResult(summary);

      if (result.state === 'verification_ready') {
        baseLogger.info(
          {
            hasDisplayOutput: Boolean(result.displayOutput),
            hasVerificationUrl: true,
            hasUserCode: true,
          },
          'DEV-0000051:T9:copilot_device_auth_cli_parsed',
        );
      } else {
        baseLogger.warn(
          {
            exitCode: summary.exitCode,
            state: result.state,
            reason: 'reason' in result ? result.reason : undefined,
            stdoutSample:
              truncateText(sanitizeDeviceAuthOutput(summary.stdout), 200) ||
              undefined,
          },
          'DEV-0000051:T9:copilot_device_auth_cli_failed',
        );
      }

      resolve({ ...result, completion });
    };

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      if (resolvedInitial) return;
      const parsed = parseCopilotDeviceAuthOutput(stdout);
      if (parsed.state === 'verification_ready') {
        finalize({ exitCode: null, stdout, stderr }, parsed);
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (resolvedInitial) return;
      const parsed = parseCopilotDeviceAuthOutput(stdout);
      if (parsed.state === 'verification_ready') {
        finalize({ exitCode: null, stdout, stderr }, parsed);
      }
    });

    child.on('error', (error) => {
      const summary = {
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      };
      finalize(summary);
      finalizeCompletion(summary);
    });

    child.on('close', (exitCode) => {
      const summary = { exitCode, stdout, stderr };
      finalize(summary);
      finalizeCompletion(summary);
    });
  });
}

function sanitizeDeviceAuthOutput(output: string) {
  return stripAnsi(output)
    .replace(verificationUrlRedactRegex, '<redacted-url>')
    .replace(userCodeRedactRegex, '<redacted-code>');
}

const ansiRegex =
  /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(value: string) {
  return value.replace(ansiRegex, '');
}
