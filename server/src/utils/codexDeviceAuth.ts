import { spawn } from 'node:child_process';

import { buildCodexOptions, resolveCodexHome } from '../config/codexConfig.js';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';
import { truncateText } from './truncateText.js';

const TASK8_LOG_MARKER = 'story.0000051.task08.auth_contract_normalized';

export type CodexDeviceAuthVerificationReady = {
  provider: 'codex';
  state: 'verification_ready';
  verificationUrl: string;
  userCode: string;
  displayOutput?: string;
};

export type CodexDeviceAuthCompletionPending = {
  provider: 'codex';
  state: 'completion_pending';
  verificationUrl?: string;
  userCode?: string;
  displayOutput?: string;
};

export type CodexDeviceAuthCompleted = {
  provider: 'codex';
  state: 'completed';
};

export type CodexDeviceAuthAlreadyAuthenticated = {
  provider: 'codex';
  state: 'already_authenticated';
};

export type CodexDeviceAuthFailure = {
  provider: 'codex';
  state: 'failed';
  reason: string;
  displayOutput?: string;
};

export type CodexDeviceAuthUnavailableBeforeStart = {
  provider: 'codex';
  state: 'unavailable_before_start';
  reason: string;
};

export type CodexDeviceAuthResult =
  | CodexDeviceAuthVerificationReady
  | CodexDeviceAuthAlreadyAuthenticated
  | CodexDeviceAuthFailure
  | CodexDeviceAuthUnavailableBeforeStart;

export type CodexDeviceAuthCompletion = {
  exitCode: number | null;
  result:
    | CodexDeviceAuthCompleted
    | CodexDeviceAuthAlreadyAuthenticated
    | CodexDeviceAuthFailure
    | CodexDeviceAuthUnavailableBeforeStart;
};

export type CodexDeviceAuthState =
  | CodexDeviceAuthResult
  | CodexDeviceAuthCompletionPending
  | CodexDeviceAuthCompletion['result'];

export type CodexDeviceAuthResultWithCompletion = CodexDeviceAuthResult & {
  completion: Promise<CodexDeviceAuthCompletion>;
};

type CodexDeviceAuthRunSummary = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const deviceAuthErrorMessage = 'device auth output not recognized';
const deviceAuthExpiredMessage = 'device code expired or was declined';
const deviceAuthExitMessage = 'device auth command failed';

const verificationUrlRegex = /https?:\/\/\S+/i;
const userCodeRegex = /\b(?:user\s*code|code)\b\s*[:=\-]?\s*([A-Z0-9-]{6,})/i;
const verificationUrlRedactRegex = /https?:\/\/\S+/gi;
const userCodeRedactRegex =
  /\b(?:user\s*code|code)\b\s*[:=\-]?\s*[A-Z0-9-]{6,}/gi;
const expiredStderrRegex = /(expired|declined)/i;

function normalizeCodexAuthResponse<
  T extends { provider: 'codex'; state: string },
>(response: T): T {
  const context = {
    provider: response.provider,
    state: response.state,
  };
  append({
    level: 'info',
    message: TASK8_LOG_MARKER,
    timestamp: new Date().toISOString(),
    source: 'server',
    context,
  });
  baseLogger.info(context, TASK8_LOG_MARKER);
  return response;
}

export function createCodexVerificationReadyResponse(params: {
  verificationUrl: string;
  userCode: string;
  displayOutput: string;
}): CodexDeviceAuthVerificationReady {
  return normalizeCodexAuthResponse({
    provider: 'codex',
    state: 'verification_ready',
    verificationUrl: params.verificationUrl,
    userCode: params.userCode,
    displayOutput: params.displayOutput,
  });
}

export function createCodexCompletionPendingResponse(
  source: Pick<
    CodexDeviceAuthVerificationReady,
    'verificationUrl' | 'userCode' | 'displayOutput'
  >,
): CodexDeviceAuthCompletionPending {
  return normalizeCodexAuthResponse({
    provider: 'codex',
    state: 'completion_pending',
    verificationUrl: source.verificationUrl,
    userCode: source.userCode,
    displayOutput: source.displayOutput,
  });
}

export function createCodexCompletedResponse(): CodexDeviceAuthCompleted {
  return normalizeCodexAuthResponse({
    provider: 'codex',
    state: 'completed',
  });
}

export function createCodexAlreadyAuthenticatedResponse(): CodexDeviceAuthAlreadyAuthenticated {
  return normalizeCodexAuthResponse({
    provider: 'codex',
    state: 'already_authenticated',
  });
}

export function createCodexFailedResponse(
  reason: string,
  displayOutput?: string,
): CodexDeviceAuthFailure {
  return normalizeCodexAuthResponse({
    provider: 'codex',
    state: 'failed',
    reason,
    displayOutput,
  });
}

export function createCodexUnavailableBeforeStartResponse(
  reason: string,
): CodexDeviceAuthUnavailableBeforeStart {
  return normalizeCodexAuthResponse({
    provider: 'codex',
    state: 'unavailable_before_start',
    reason,
  });
}

export function parseCodexDeviceAuthOutput(
  stdout: string,
): CodexDeviceAuthResult {
  const normalized = stripAnsi(stdout);
  const verificationUrl = normalized.match(verificationUrlRegex)?.[0];
  const userCodeMatch = normalized.match(userCodeRegex);
  const userCode = userCodeMatch?.[1];

  if (!verificationUrl || !userCode) {
    return createCodexFailedResponse(deviceAuthErrorMessage);
  }

  return createCodexVerificationReadyResponse({
    verificationUrl,
    userCode,
    displayOutput: normalized,
  });
}

export function resolveCodexDeviceAuthResult(
  summary: CodexDeviceAuthRunSummary,
): CodexDeviceAuthCompletion['result'] {
  const normalizedStderr = stripAnsi(summary.stderr);
  if (normalizedStderr && expiredStderrRegex.test(normalizedStderr)) {
    return createCodexFailedResponse(deviceAuthExpiredMessage);
  }

  if (summary.exitCode && summary.exitCode !== 0) {
    return createCodexFailedResponse(deviceAuthExitMessage);
  }

  const parsed = parseCodexDeviceAuthOutput(summary.stdout);
  if (parsed.state === 'verification_ready') {
    return createCodexCompletedResponse();
  }
  return parsed;
}

function resolveInitialCodexDeviceAuthResult(
  summary: CodexDeviceAuthRunSummary,
): CodexDeviceAuthResult {
  const normalizedStderr = stripAnsi(summary.stderr);
  if (normalizedStderr && expiredStderrRegex.test(normalizedStderr)) {
    return createCodexFailedResponse(deviceAuthExpiredMessage);
  }

  if (summary.exitCode && summary.exitCode !== 0) {
    return createCodexFailedResponse(deviceAuthExitMessage);
  }

  return parseCodexDeviceAuthOutput(summary.stdout);
}

export async function runCodexDeviceAuth(params?: {
  codexHome?: string;
  spawnFn?: typeof spawn;
}): Promise<CodexDeviceAuthResultWithCompletion> {
  const codexHome = resolveCodexHome(params?.codexHome);
  const options = buildCodexOptions({ codexHome });
  const spawnFn = params?.spawnFn ?? spawn;

  baseLogger.info({ codexHome }, 'DEV-0000031:T1:codex_device_auth_cli_start');

  return new Promise((resolve) => {
    const child = spawnFn('codex', ['login', '--device-auth'], {
      env: options?.env,
    });
    let stdout = '';
    let stderr = '';
    let resolved = false;
    let completionResolved = false;
    let resolveCompletion: (value: CodexDeviceAuthCompletion) => void;
    const completion = new Promise<CodexDeviceAuthCompletion>((resolve) => {
      resolveCompletion = resolve;
    });

    const finalizeCompletion = (summary: CodexDeviceAuthRunSummary) => {
      if (completionResolved) return;
      completionResolved = true;
      const result = resolveCodexDeviceAuthResult(summary);
      baseLogger.info(
        { exitCode: summary.exitCode, state: result.state },
        'DEV-0000031:T10:codex_device_auth_cli_completed',
      );
      resolveCompletion({ exitCode: summary.exitCode, result });
    };

    const finalize = (
      summary: CodexDeviceAuthRunSummary,
      resolvedResult?: CodexDeviceAuthResult,
    ) => {
      if (resolved) return;
      resolved = true;
      const result =
        resolvedResult ?? resolveInitialCodexDeviceAuthResult(summary);

      if (result.state === 'verification_ready') {
        baseLogger.info(
          {
            hasDisplayOutput: Boolean(result.displayOutput),
            displayOutputLength: result.displayOutput?.length ?? 0,
            hasVerificationUrl: Boolean(result.verificationUrl),
            hasUserCode: Boolean(result.userCode),
          },
          'DEV-0000031:T1:codex_device_auth_cli_parsed',
        );
      } else {
        const stdoutSample = truncateText(
          sanitizeDeviceAuthOutput(summary.stdout),
          200,
        );
        baseLogger.warn(
          {
            exitCode: summary.exitCode,
            error:
              'reason' in result
                ? result.reason
                : 'codex already authenticated',
            stdoutSample: stdoutSample || undefined,
          },
          'DEV-0000031:T1:codex_device_auth_cli_failed',
        );
      }

      resolve({ ...result, completion });
    };

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      if (resolved) return;
      const parsed = parseCodexDeviceAuthOutput(stdout);
      if (parsed.state === 'verification_ready') {
        finalize({ exitCode: null, stdout, stderr }, parsed);
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (resolved) return;
      const parsed = parseCodexDeviceAuthOutput(stdout);
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
