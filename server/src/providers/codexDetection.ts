import { execSync } from 'child_process';
import fs from 'fs';
import {
  buildCodexOptions,
  getCodexAuthPathForHome,
  getCodexConfigPathForHome,
  getCodexHome,
  resolveCodexHome,
} from '../config/codexConfig.js';
import {
  CodexDetection,
  setCodexDetection,
  updateCodexDetection,
} from './codexRegistry.js';

const T08_SUCCESS_LOG =
  '[DEV-0000037][T08] event=shared_home_detection_completed result=success';
const T08_ERROR_LOG =
  '[DEV-0000037][T08] event=shared_home_detection_completed result=error';

type CodexDetectionDeps = {
  resolveCliPath?: () => string;
  pathExists?: (targetPath: string) => boolean;
};

const resolveCliPathDefault = () =>
  execSync('command -v codex', { encoding: 'utf8' }).trim();

const pathExistsDefault = (targetPath: string) => fs.existsSync(targetPath);

function logSharedHomeDetectionCompleted(
  result: CodexDetection,
  codexHome: string,
  phase: 'startup' | 'refresh',
) {
  const payload = {
    codexHome,
    phase,
    available: result.available,
    authPresent: result.authPresent,
    configPresent: result.configPresent,
    hasCliPath: Boolean(result.cliPath),
    reason: result.reason,
  };

  if (result.available) {
    console.info(T08_SUCCESS_LOG, payload);
    return;
  }
  console.error(T08_ERROR_LOG, payload);
}

export function detectCodexForHome(
  codexHome: string,
  deps?: CodexDetectionDeps,
): CodexDetection {
  const home = resolveCodexHome(codexHome);
  const authPath = getCodexAuthPathForHome(home);
  const configPath = getCodexConfigPathForHome(home);
  const resolveCliPath = deps?.resolveCliPath ?? resolveCliPathDefault;
  const pathExists = deps?.pathExists ?? pathExistsDefault;

  let cliPath: string | undefined;
  try {
    cliPath = resolveCliPath();
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'codex not found';
    const result: CodexDetection = {
      available: false,
      cliPath,
      authPresent: pathExists(authPath),
      configPresent: pathExists(configPath),
      reason,
    };
    return result;
  }

  const authPresent = pathExists(authPath);
  const configPresent = pathExists(configPath);
  const available = Boolean(cliPath) && authPresent && configPresent;

  return {
    available,
    cliPath,
    authPresent,
    configPresent,
    reason: available
      ? undefined
      : missingSummary({ authPresent, configPresent, home }),
  };
}

export function detectCodex(options?: {
  codexHome?: string;
  resolveCliPath?: () => string;
  pathExists?: (targetPath: string) => boolean;
}): CodexDetection {
  const home = resolveCodexHome(options?.codexHome ?? getCodexHome());
  const result = detectCodexForHome(home, {
    resolveCliPath: options?.resolveCliPath,
    pathExists: options?.pathExists,
  });
  setCodexDetection(result);
  logSharedHomeDetectionCompleted(result, home, 'startup');
  return result;
}

export function refreshCodexDetection(options?: {
  codexHome?: string;
  resolveCliPath?: () => string;
  pathExists?: (targetPath: string) => boolean;
}): CodexDetection {
  const home = resolveCodexHome(options?.codexHome ?? getCodexHome());
  const result = detectCodexForHome(home, {
    resolveCliPath: options?.resolveCliPath,
    pathExists: options?.pathExists,
  });
  updateCodexDetection(result);
  logSharedHomeDetectionCompleted(result, home, 'refresh');
  return result;
}

export function getCodexOptionsIfAvailable() {
  const detection = detectCodex();
  if (!detection.available) return undefined;
  return buildCodexOptions();
}

function missingSummary({
  authPresent,
  configPresent,
  home,
}: {
  authPresent: boolean;
  configPresent: boolean;
  home: string;
}) {
  const missing = [] as string[];
  if (!authPresent) missing.push(`auth.json in ${home}`);
  if (!configPresent) missing.push(`config.toml in ${home}`);
  return missing.length ? `Missing ${missing.join(' and ')}` : undefined;
}
