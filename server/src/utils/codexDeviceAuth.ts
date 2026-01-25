import { spawn } from 'node:child_process';

import { buildCodexOptions, resolveCodexHome } from '../config/codexConfig.js';
import { baseLogger } from '../logger.js';

export type CodexDeviceAuthSuccess = {
  ok: true;
  verificationUrl: string;
  userCode: string;
  expiresInSec?: number;
};

export type CodexDeviceAuthFailure = {
  ok: false;
  message: string;
};

export type CodexDeviceAuthResult =
  | CodexDeviceAuthSuccess
  | CodexDeviceAuthFailure;

export type CodexDeviceAuthCompletion = {
  exitCode: number | null;
  result: CodexDeviceAuthResult;
};

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
const expiresRegex = /expires?\s*in\s*(\d+)\s*seconds?/i;
const expiredStderrRegex = /(expired|declined)/i;

export function parseCodexDeviceAuthOutput(
  stdout: string,
): CodexDeviceAuthResult {
  const normalized = stripAnsi(stdout);
  const verificationUrl = normalized.match(verificationUrlRegex)?.[0];
  const userCodeMatch = normalized.match(userCodeRegex);
  const userCode = userCodeMatch?.[1];
  const expiresMatch = normalized.match(expiresRegex);
  const expiresInSec = expiresMatch ? Number(expiresMatch[1]) : undefined;

  if (!verificationUrl || !userCode) {
    return { ok: false, message: deviceAuthErrorMessage };
  }

  return {
    ok: true,
    verificationUrl,
    userCode,
    expiresInSec: Number.isFinite(expiresInSec) ? expiresInSec : undefined,
  };
}

export function resolveCodexDeviceAuthResult(
  summary: CodexDeviceAuthRunSummary,
): CodexDeviceAuthResult {
  const normalizedStderr = stripAnsi(summary.stderr);
  if (normalizedStderr && expiredStderrRegex.test(normalizedStderr)) {
    return { ok: false, message: deviceAuthExpiredMessage };
  }

  if (summary.exitCode && summary.exitCode !== 0) {
    return { ok: false, message: deviceAuthExitMessage };
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
        { exitCode: summary.exitCode, ok: result.ok },
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
      const result = resolvedResult ?? resolveCodexDeviceAuthResult(summary);

      if (result.ok) {
        baseLogger.info(
          {
            hasVerificationUrl: Boolean(result.verificationUrl),
            hasUserCode: Boolean(result.userCode),
            hasExpiresInSec: result.expiresInSec !== undefined,
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
            error: result.message,
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
      const parsed = parseCodexDeviceAuthOutput(`${stdout}\n${stderr}`);
      if (parsed.ok) {
        finalize({ exitCode: null, stdout, stderr }, parsed);
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (resolved) return;
      const parsed = parseCodexDeviceAuthOutput(`${stdout}\n${stderr}`);
      if (parsed.ok) {
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

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}
