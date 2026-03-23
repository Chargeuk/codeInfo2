import fs from 'node:fs';
import path from 'node:path';
import type { CopilotClientOptions } from '@github/copilot-sdk';

export const DEFAULT_CODEINFO_COPILOT_HOME = './copilot';

export type CopilotCliMode = 'path' | 'cliPath';

export type CopilotConfigResolution = {
  copilotHome: string;
  configDir: string;
  cliMode: CopilotCliMode;
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
  const copilotHome = resolveCopilotHome(params?.copilotHome, params?.env);
  const configDir = getCopilotConfigDirForHome(copilotHome);
  const cliMode: CopilotCliMode = params?.cliPath ? 'cliPath' : 'path';
  const mergedEnv: Record<string, string | undefined> = {
    ...process.env,
    ...(params?.env ?? {}),
    COPILOT_HOME: copilotHome,
  };

  const clientOptions: CopilotClientOptions = {
    env: mergedEnv,
    ...(params?.cliPath ? { cliPath: params.cliPath } : {}),
    ...(params?.cwd ? { cwd: params.cwd } : {}),
    ...(params?.logLevel ? { logLevel: params.logLevel } : {}),
  };

  return {
    copilotHome,
    configDir,
    cliMode,
    clientOptions,
  };
}
