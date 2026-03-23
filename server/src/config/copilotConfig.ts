import fs from 'node:fs';
import path from 'node:path';
import type { CopilotClientOptions } from '@github/copilot-sdk';

export const DEFAULT_CODEINFO_COPILOT_HOME = './copilot';
export const COPILOT_ENV_AUTH_KEYS = [
  'COPILOT_GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const;

export type CopilotCliMode = 'path' | 'cliPath';
export type CopilotCredentialSource =
  | (typeof COPILOT_ENV_AUTH_KEYS)[number]
  | 'none';

export type CopilotConfigResolution = {
  copilotHome: string;
  configDir: string;
  cliMode: CopilotCliMode;
  cliPath?: string;
  cliPathOverride: 'present' | 'absent';
  credentialSource: CopilotCredentialSource;
  clientOptions: CopilotClientOptions;
};

export function resolveCopilotHome(
  overrideHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(
    overrideHome ?? env.CODEINFO_COPILOT_HOME ?? DEFAULT_CODEINFO_COPILOT_HOME,
  );
}

export function getCopilotConfigDirForHome(copilotHome: string): string {
  return path.join(copilotHome, 'config');
}

export function getCopilotStatePathForHome(
  copilotHome: string,
  ...segments: string[]
): string {
  return path.join(getCopilotConfigDirForHome(copilotHome), ...segments);
}

export function getCopilotHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolveCopilotHome(undefined, env);
}

export function getCopilotConfigDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return getCopilotConfigDirForHome(getCopilotHome(env));
}

export function resolveCopilotCliPath(
  overrideCliPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const candidate = overrideCliPath ?? env.CODEINFO_COPILOT_CLI_PATH;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveCopilotCredentialSource(
  env: NodeJS.ProcessEnv = process.env,
): CopilotCredentialSource {
  for (const key of COPILOT_ENV_AUTH_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return key;
    }
  }
  return 'none';
}

export async function ensureCopilotAuthFileStore(configDir: string): Promise<{
  changed: boolean;
  configDir: string;
}> {
  try {
    await fs.promises.mkdir(configDir, { recursive: true });
    const probePath = path.join(configDir, '.codeinfo-write-test');
    await fs.promises.writeFile(probePath, 'ok', 'utf8');
    await fs.promises.rm(probePath, { force: true });
    return {
      changed: true,
      configDir,
    };
  } catch {
    throw new Error('copilot config persistence unavailable');
  }
}

export function buildCopilotClientOptions(params?: {
  copilotHome?: string;
  cliPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logLevel?: CopilotClientOptions['logLevel'];
}): CopilotConfigResolution {
  const env = params?.env ?? process.env;
  const copilotHome = resolveCopilotHome(params?.copilotHome, params?.env);
  const configDir = getCopilotConfigDirForHome(copilotHome);
  const cliPath = resolveCopilotCliPath(params?.cliPath, env);
  const cliMode: CopilotCliMode = cliPath ? 'cliPath' : 'path';
  const mergedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...env,
    COPILOT_HOME: copilotHome,
  };

  const clientOptions: CopilotClientOptions = {
    env: mergedEnv,
    ...(cliPath ? { cliPath } : {}),
    ...(params?.cwd ? { cwd: params.cwd } : {}),
    ...(params?.logLevel ? { logLevel: params.logLevel } : {}),
  };

  return {
    copilotHome,
    configDir,
    cliMode,
    cliPath,
    cliPathOverride: cliPath ? 'present' : 'absent',
    credentialSource: resolveCopilotCredentialSource(env),
    clientOptions,
  };
}
