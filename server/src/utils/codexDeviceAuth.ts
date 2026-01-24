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

type CodexDeviceAuthRunSummary = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const deviceAuthErrorMessage = 'device auth output not recognized';
const deviceAuthExpiredMessage = 'device code expired or was declined';
const deviceAuthExitMessage = 'device auth command failed';

const verificationUrlRegex = /https?:\/\/\S+/i;
const userCodeRegex = /(?:user\s*code|code)\s*[:=\-]?\s*([A-Z0-9-]+)/i;
const verificationUrlRedactRegex = /https?:\/\/\S+/gi;
const userCodeRedactRegex = /(?:user\s*code|code)\s*[:=\-]?\s*[A-Z0-9-]+/gi;
const expiresRegex = /expires?\s*in\s*(\d+)\s*seconds?/i;
const expiredStderrRegex = /(expired|declined)/i;

export function parseCodexDeviceAuthOutput(
  stdout: string,
): CodexDeviceAuthResult {
  const verificationUrl = stdout.match(verificationUrlRegex)?.[0];
  const userCodeMatch = stdout.match(userCodeRegex);
  const userCode = userCodeMatch?.[1];
  const expiresMatch = stdout.match(expiresRegex);
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
  if (summary.stderr && expiredStderrRegex.test(summary.stderr)) {
    return { ok: false, message: deviceAuthExpiredMessage };
  }

  if (summary.exitCode && summary.exitCode !== 0) {
    return { ok: false, message: deviceAuthExitMessage };
  }

  return parseCodexDeviceAuthOutput(summary.stdout);
}

export async function runCodexDeviceAuth(params?: {
  codexHome?: string;
}): Promise<CodexDeviceAuthResult> {
  const codexHome = resolveCodexHome(params?.codexHome);
  const options = buildCodexOptions({ codexHome });

  baseLogger.info({ codexHome }, 'DEV-0000031:T1:codex_device_auth_cli_start');

  return new Promise((resolve) => {
    const child = spawn('codex', ['login', '--device-auth'], {
      env: options?.env,
    });
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const finalize = (summary: CodexDeviceAuthRunSummary) => {
      if (resolved) return;
      resolved = true;
      const result = resolveCodexDeviceAuthResult(summary);

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

      resolve(result);
    };

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      finalize({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on('close', (exitCode) => {
      finalize({ exitCode, stdout, stderr });
    });
  });
}

function sanitizeDeviceAuthOutput(output: string) {
  return output
    .replace(verificationUrlRedactRegex, '<redacted-url>')
    .replace(userCodeRedactRegex, '<redacted-code>');
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}
