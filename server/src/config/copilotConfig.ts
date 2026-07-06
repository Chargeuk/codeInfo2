import fs from 'node:fs';
import path from 'node:path';
import type { ChatProviderId } from '@codeinfo2/common';
import type { CopilotClientOptions } from '@github/copilot-sdk';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { getScopedProcessEnv } from '../test/support/testEnvOverrideScope.js';

export const DEFAULT_CODEINFO_COPILOT_HOME = './copilot';
export const DEFAULT_CODEINFO_LMSTUDIO_HOME = './lmstudio';
export const DEFAULT_COPILOT_CLI_ARGS = ['--allow-all-paths'] as const;
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

type CopilotManagedJsonObjectReadResult =
  | {
      status: 'missing';
      artifactPath: string;
    }
  | {
      status: 'present';
      artifactPath: string;
      value: Record<string, unknown>;
    };

type CopilotManagedJsonObjectReadWithRawResult =
  | {
      status: 'missing';
      artifactPath: string;
    }
  | {
      status: 'present';
      artifactPath: string;
      raw: string;
      value: Record<string, unknown>;
    };

export class CopilotManagedJsonArtifactError extends Error {
  readonly artifactPath: string;
  readonly artifactName: string;

  constructor(artifactPath: string) {
    const artifactName = path.basename(artifactPath);
    super(`copilot ${artifactName} is malformed`);
    this.name = 'CopilotManagedJsonArtifactError';
    this.artifactPath = artifactPath;
    this.artifactName = artifactName;
  }
}

function isJsonObjectRecord(
  candidate: unknown,
): candidate is Record<string, unknown> {
  return (
    !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
  );
}

function hasExplicitConfiguredCopilotHome(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configuredHome = getScopedProcessEnv(env).CODEINFO_COPILOT_HOME;
  return typeof configuredHome === 'string' && configuredHome.trim().length > 0;
}

export function resolveCopilotHome(
  overrideHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const effectiveEnv = getScopedProcessEnv(env);
  const testProviderHomeRoot =
    typeof effectiveEnv.CODEINFO_TEST_PROVIDER_HOME_ROOT === 'string' &&
    effectiveEnv.CODEINFO_TEST_PROVIDER_HOME_ROOT.trim().length > 0
      ? path.resolve(effectiveEnv.CODEINFO_TEST_PROVIDER_HOME_ROOT)
      : undefined;
  return path.resolve(
    overrideHome ??
      effectiveEnv.CODEINFO_COPILOT_HOME ??
      (testProviderHomeRoot
        ? path.join(testProviderHomeRoot, `pid-${process.pid}`, 'copilot')
        : undefined) ??
      DEFAULT_CODEINFO_COPILOT_HOME,
  );
}

export function getCopilotConfigDirForHome(copilotHome: string): string {
  return path.resolve(copilotHome);
}

export function getCopilotCacheDirForHome(copilotHome: string): string {
  return path.join(path.resolve(copilotHome), '.cache');
}

export function getCopilotStatePathForHome(
  copilotHome: string,
  ...segments: string[]
): string {
  return path.join(path.resolve(copilotHome), ...segments);
}

export function getCopilotChatConfigPathForHome(copilotHome: string): string {
  return getCopilotStatePathForHome(copilotHome, 'chat', 'config.toml');
}

export function getCopilotConfigPathForHome(copilotHome: string): string {
  return getCopilotStatePathForHome(copilotHome, 'config.toml');
}

export function getCopilotSettingsPathForHome(copilotHome: string): string {
  return getCopilotStatePathForHome(copilotHome, 'settings.json');
}

export function getCopilotLegacyConfigPathForHome(copilotHome: string): string {
  return getCopilotStatePathForHome(copilotHome, 'config.json');
}

export function getCopilotHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolveCopilotHome(undefined, env);
}

export function resolveLmStudioHome(
  overrideHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const effectiveEnv = getScopedProcessEnv(env);
  const testProviderHomeRoot =
    typeof effectiveEnv.CODEINFO_TEST_PROVIDER_HOME_ROOT === 'string' &&
    effectiveEnv.CODEINFO_TEST_PROVIDER_HOME_ROOT.trim().length > 0
      ? path.resolve(effectiveEnv.CODEINFO_TEST_PROVIDER_HOME_ROOT)
      : undefined;
  return path.resolve(
    overrideHome ??
      effectiveEnv.CODEINFO_LMSTUDIO_HOME ??
      (testProviderHomeRoot
        ? path.join(testProviderHomeRoot, `pid-${process.pid}`, 'lmstudio')
        : undefined) ??
      DEFAULT_CODEINFO_LMSTUDIO_HOME,
  );
}

export function getLmStudioConfigPathForHome(lmstudioHome: string): string {
  return path.join(path.resolve(lmstudioHome), 'config.toml');
}

const MANAGED_PROVIDER_BASE_CONFIG_TEMPLATE =
  '# Managed by CodeInfo2 provider runtime bootstrap.\n';

function buildManagedProviderBaseConfigTempPath(configPath: string): string {
  return `${configPath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
}

async function commitTempFileIfMissing(
  tempPath: string,
  targetPath: string,
): Promise<'written' | 'existing'> {
  try {
    await fs.promises.link(tempPath, targetPath);
    return 'written';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return 'existing';
    }
    throw error;
  }
}

async function cleanupManagedProviderBaseConfigTempFile(
  tempPath: string,
): Promise<void> {
  await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
}

async function ensureManagedProviderBaseConfigSeeded(params: {
  provider: Exclude<ChatProviderId, 'codex'>;
  providerHome: string;
}): Promise<string> {
  const configPath =
    params.provider === 'copilot'
      ? getCopilotConfigPathForHome(params.providerHome)
      : getLmStudioConfigPathForHome(params.providerHome);

  await fs.promises.mkdir(params.providerHome, { recursive: true });

  try {
    await fs.promises.access(configPath, fs.constants.F_OK);
    return configPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const tempPath = buildManagedProviderBaseConfigTempPath(configPath);
  try {
    await fs.promises.writeFile(
      tempPath,
      MANAGED_PROVIDER_BASE_CONFIG_TEMPLATE,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
    const commitResult = await commitTempFileIfMissing(tempPath, configPath);
    if (commitResult === 'existing') {
      return configPath;
    }
    return configPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return configPath;
    }
    throw error;
  } finally {
    await cleanupManagedProviderBaseConfigTempFile(tempPath);
  }
}

export async function ensureCopilotBaseConfigSeeded(
  overrideHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return ensureManagedProviderBaseConfigSeeded({
    provider: 'copilot',
    providerHome: resolveCopilotHome(overrideHome, env),
  });
}

export async function ensureLmStudioBaseConfigSeeded(
  overrideHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return ensureManagedProviderBaseConfigSeeded({
    provider: 'lmstudio',
    providerHome: resolveLmStudioHome(overrideHome, env),
  });
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

async function readCopilotManagedJsonObjectWithRaw(
  artifactPath: string,
): Promise<CopilotManagedJsonObjectReadWithRawResult> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(artifactPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        status: 'missing',
        artifactPath,
      };
    }
    throw error;
  }

  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(raw, parseErrors, {
    allowEmptyContent: false,
    disallowComments: false,
    allowTrailingComma: true,
  });

  if (parseErrors.length > 0 || !isJsonObjectRecord(parsed)) {
    throw new CopilotManagedJsonArtifactError(artifactPath);
  }

  return {
    status: 'present',
    artifactPath,
    raw,
    value: parsed,
  };
}

export async function readCopilotManagedJsonObject(
  artifactPath: string,
): Promise<CopilotManagedJsonObjectReadResult> {
  const result = await readCopilotManagedJsonObjectWithRaw(artifactPath);
  if (result.status === 'missing') {
    return result;
  }

  return {
    status: 'present',
    artifactPath: result.artifactPath,
    value: result.value,
  };
}

export async function ensureCopilotPlaintextTokenStorage(
  copilotHome: string,
): Promise<{
  changed: boolean;
  settingsPath: string;
}> {
  const resolvedHome = path.resolve(copilotHome);
  const settingsPath = getCopilotSettingsPathForHome(resolvedHome);
  const legacyConfigPath = getCopilotLegacyConfigPathForHome(resolvedHome);

  await fs.promises.mkdir(resolvedHome, { recursive: true });

  while (true) {
    let currentSettings: Record<string, unknown> = {};
    let currentSettingsRaw: string | undefined;
    const settingsResult =
      await readCopilotManagedJsonObjectWithRaw(settingsPath);
    const settingsFileExists = settingsResult.status === 'present';
    if (settingsResult.status === 'present') {
      currentSettings = settingsResult.value;
      currentSettingsRaw = settingsResult.raw;
    } else {
      try {
        const legacyConfigResult =
          await readCopilotManagedJsonObject(legacyConfigPath);
        if (
          legacyConfigResult.status === 'present' &&
          legacyConfigResult.value.store_token_plaintext === true
        ) {
          currentSettings = {
            ...currentSettings,
            storeTokenPlaintext: true,
          };
        }
      } catch (error) {
        if (!(error instanceof CopilotManagedJsonArtifactError)) {
          throw error;
        }

        // `config.json` is Copilot-managed compatibility input only, so a
        // malformed legacy artifact should not block bootstrap of the canonical
        // repo-owned `settings.json` contract.
      }
    }

    if (settingsFileExists && currentSettings.storeTokenPlaintext === true) {
      return {
        changed: false,
        settingsPath,
      };
    }

    const nextSettings = {
      ...currentSettings,
      storeTokenPlaintext: true,
    };

    const tempPath = path.join(
      resolvedHome,
      `settings.json.${process.pid}.${Date.now()}.${Math.random()
        .toString(16)
        .slice(2)}.tmp`,
    );

    try {
      await fs.promises.writeFile(
        tempPath,
        `${JSON.stringify(nextSettings, null, 2)}\n`,
        'utf8',
      );

      if (!settingsFileExists) {
        const commitResult = await commitTempFileIfMissing(
          tempPath,
          settingsPath,
        );
        if (commitResult === 'existing') {
          continue;
        }
        return {
          changed: true,
          settingsPath,
        };
      }

      const latestSettings =
        await readCopilotManagedJsonObjectWithRaw(settingsPath);
      if (
        latestSettings.status !== 'present' ||
        latestSettings.raw !== currentSettingsRaw
      ) {
        if (
          latestSettings.status === 'present' &&
          latestSettings.value.storeTokenPlaintext === true
        ) {
          return {
            changed: false,
            settingsPath,
          };
        }
        continue;
      }

      await fs.promises.rename(tempPath, settingsPath);
      return {
        changed: true,
        settingsPath,
      };
    } finally {
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    }
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
      compatRealPath === (copilotHomeRealPath ?? resolvedCopilotHome);

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
  const initialDiagnostics = await inspectCopilotAuthLocations(
    copilotHome,
    env,
  );
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

  if (
    hasExplicitConfiguredCopilotHome(env) &&
    initialDiagnostics.compatStatus === 'missing'
  ) {
    return {
      action: 'none',
      diagnostics: initialDiagnostics,
    };
  }

  try {
    await fs.promises.mkdir(path.dirname(initialDiagnostics.compatPath), {
      recursive: true,
    });
    await fs.promises.mkdir(initialDiagnostics.copilotHome, {
      recursive: true,
    });
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
  cliArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logLevel?: CopilotClientOptions['logLevel'];
}): CopilotConfigResolution {
  const env = params?.env ?? process.env;
  const copilotHome = resolveCopilotHome(params?.copilotHome, params?.env);
  const configDir = getCopilotConfigDirForHome(copilotHome);
  const cliPath = resolveCopilotCliPath(params?.cliPath, env);
  const cliMode: CopilotCliMode = cliPath ? 'cliPath' : 'path';
  const normalizedCliArgs = (params?.cliArgs ?? [])
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);
  const providedCliArgs = new Set(normalizedCliArgs);
  const cliArgs = [
    ...DEFAULT_COPILOT_CLI_ARGS.filter((arg) => !providedCliArgs.has(arg)),
    ...normalizedCliArgs,
  ];
  const cacheDir = getCopilotCacheDirForHome(copilotHome);
  const mergedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...env,
    HOME: copilotHome,
    COPILOT_HOME: copilotHome,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: copilotHome,
  };

  const clientOptions: CopilotClientOptions = {
    env: mergedEnv,
    ...(cliPath ? { cliPath } : {}),
    ...(cliArgs.length > 0 ? { cliArgs } : {}),
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
