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

export type CopilotAuthCompatStatus =
  | 'missing_home'
  | 'same_path'
  | 'missing'
  | 'linked'
  | 'same_realpath'
  | 'different_target'
  | 'unreadable';

export type CopilotAuthLocationDiagnostics = {
  homeDir?: string;
  copilotHome: string;
  configDir: string;
  compatPath?: string;
  copilotHomeExists: boolean;
  configDirExists: boolean;
  compatPathExists: boolean;
  compatStatus: CopilotAuthCompatStatus;
  copilotHomeRealPath?: string;
  compatRealPath?: string;
};

export type CopilotAuthHomeCompatibilityResult = {
  action: 'none' | 'created_symlink' | 'error';
  diagnostics: CopilotAuthLocationDiagnostics;
  error?: string;
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

export function resolveCopilotCompatPath(
  copilotHome: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const homeDir = env.HOME?.trim();
  if (!homeDir) return undefined;

  const resolvedHomeDir = path.resolve(homeDir);
  const resolvedCopilotHome = path.resolve(copilotHome);
  if (resolvedHomeDir === resolvedCopilotHome) {
    return resolvedCopilotHome;
  }

  return path.join(resolvedHomeDir, '.copilot');
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRealPathIfPresent(
  targetPath: string,
): Promise<string | undefined> {
  try {
    return await fs.promises.realpath(targetPath);
  } catch {
    return undefined;
  }
}

export async function inspectCopilotAuthLocations(
  copilotHome: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CopilotAuthLocationDiagnostics> {
  const resolvedCopilotHome = path.resolve(copilotHome);
  const configDir = getCopilotConfigDirForHome(resolvedCopilotHome);
  const compatPath = resolveCopilotCompatPath(resolvedCopilotHome, env);
  const homeDir = env.HOME?.trim() ? path.resolve(env.HOME) : undefined;
  const copilotHomeExists = await pathExists(resolvedCopilotHome);
  const configDirExists = await pathExists(configDir);
  const copilotHomeRealPath = copilotHomeExists
    ? await resolveRealPathIfPresent(resolvedCopilotHome)
    : undefined;

  if (!compatPath) {
    return {
      homeDir,
      copilotHome: resolvedCopilotHome,
      configDir,
      compatPath,
      copilotHomeExists,
      configDirExists,
      compatPathExists: false,
      compatStatus: 'missing_home',
      copilotHomeRealPath,
    };
  }

  if (path.resolve(compatPath) === resolvedCopilotHome) {
    return {
      homeDir,
      copilotHome: resolvedCopilotHome,
      configDir,
      compatPath,
      copilotHomeExists,
      configDirExists,
      compatPathExists: copilotHomeExists,
      compatStatus: 'same_path',
      copilotHomeRealPath,
      compatRealPath: copilotHomeRealPath,
    };
  }

  const compatPathExists = await pathExists(compatPath);
  if (!compatPathExists) {
    return {
      homeDir,
      copilotHome: resolvedCopilotHome,
      configDir,
      compatPath,
      copilotHomeExists,
      configDirExists,
      compatPathExists,
      compatStatus: 'missing',
      copilotHomeRealPath,
    };
  }

  try {
    const stats = await fs.promises.lstat(compatPath);
    const compatRealPath = await resolveRealPathIfPresent(compatPath);
    const sameTarget =
      typeof compatRealPath === 'string' &&
      compatRealPath ===
        (copilotHomeRealPath ?? resolvedCopilotHome);

    return {
      homeDir,
      copilotHome: resolvedCopilotHome,
      configDir,
      compatPath,
      copilotHomeExists,
      configDirExists,
      compatPathExists,
      compatStatus: sameTarget
        ? stats.isSymbolicLink()
          ? 'linked'
          : 'same_realpath'
        : 'different_target',
      copilotHomeRealPath,
      compatRealPath,
    };
  } catch {
    return {
      homeDir,
      copilotHome: resolvedCopilotHome,
      configDir,
      compatPath,
      copilotHomeExists,
      configDirExists,
      compatPathExists,
      compatStatus: 'unreadable',
      copilotHomeRealPath,
    };
  }
}

export async function ensureCopilotAuthHomeCompatibility(
  copilotHome: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CopilotAuthHomeCompatibilityResult> {
  const initialDiagnostics = await inspectCopilotAuthLocations(copilotHome, env);
  if (
    initialDiagnostics.compatStatus === 'missing_home' ||
    initialDiagnostics.compatStatus === 'same_path' ||
    initialDiagnostics.compatStatus === 'linked' ||
    initialDiagnostics.compatStatus === 'same_realpath' ||
    initialDiagnostics.compatStatus === 'different_target' ||
    initialDiagnostics.compatStatus === 'unreadable'
  ) {
    return {
      action: 'none',
      diagnostics: initialDiagnostics,
    };
  }

  if (!initialDiagnostics.compatPath) {
    return {
      action: 'none',
      diagnostics: initialDiagnostics,
    };
  }

  try {
    await fs.promises.mkdir(path.dirname(initialDiagnostics.compatPath), {
      recursive: true,
    });
    await fs.promises.mkdir(initialDiagnostics.copilotHome, { recursive: true });
    await fs.promises.symlink(
      initialDiagnostics.copilotHome,
      initialDiagnostics.compatPath,
      'dir',
    );

    return {
      action: 'created_symlink',
      diagnostics: await inspectCopilotAuthLocations(copilotHome, env),
    };
  } catch (error) {
    const refreshed = await inspectCopilotAuthLocations(copilotHome, env);
    if (
      refreshed.compatStatus === 'linked' ||
      refreshed.compatStatus === 'same_realpath'
    ) {
      return {
        action: 'created_symlink',
        diagnostics: refreshed,
      };
    }

    return {
      action: 'error',
      diagnostics: refreshed,
      error: error instanceof Error ? error.message : String(error),
    };
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
