import { execSync } from 'child_process';
import fs from 'fs';
import {
  buildCodexOptions,
  getCodexAuthPathForHome,
  getCodexConfigPathForHome,
  getCodexAuthPath,
  getCodexConfigPath,
  getCodexHome,
  resolveCodexHome,
} from '../config/codexConfig.js';
import {
  CodexDetection,
  setCodexDetection,
  updateCodexDetection,
} from './codexRegistry.js';

export function detectCodexForHome(codexHome: string): CodexDetection {
  const home = resolveCodexHome(codexHome);
  const authPath = getCodexAuthPathForHome(home);
  const configPath = getCodexConfigPathForHome(home);

  let cliPath: string | undefined;
  try {
    cliPath = execSync('command -v codex', { encoding: 'utf8' }).trim();
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'codex not found';
    const result: CodexDetection = {
      available: false,
      cliPath,
      authPresent: fs.existsSync(authPath),
      configPresent: fs.existsSync(configPath),
      reason,
    };
    return result;
  }

  const authPresent = fs.existsSync(authPath);
  const configPresent = fs.existsSync(configPath);
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

export function detectCodex(): CodexDetection {
  const home = getCodexHome();
  const authPath = getCodexAuthPath();
  const configPath = getCodexConfigPath();

  let cliPath: string | undefined;
  try {
    cliPath = execSync('command -v codex', { encoding: 'utf8' }).trim();
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'codex not found';
    const result: CodexDetection = {
      available: false,
      cliPath,
      authPresent: fs.existsSync(authPath),
      configPresent: fs.existsSync(configPath),
      reason,
    };
    setCodexDetection(result);
    return result;
  }

  const authPresent = fs.existsSync(authPath);
  const configPresent = fs.existsSync(configPath);
  const available = Boolean(cliPath) && authPresent && configPresent;

  const result: CodexDetection = {
    available,
    cliPath,
    authPresent,
    configPresent,
    reason: available
      ? undefined
      : missingSummary({ authPresent, configPresent, home }),
  };

  setCodexDetection(result);
  return result;
}

export function refreshCodexDetection(): CodexDetection {
  const home = getCodexHome();
  const result = detectCodexForHome(home);
  updateCodexDetection(result);
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
