import { execSync } from 'node:child_process';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';

export async function isCodexCliAvailable(): Promise<boolean> {
  const forced = getScopedEnvValue('MCP_FORCE_CODEX_AVAILABLE');
  if (forced === 'true') return true;
  if (forced === 'false') return false;

  try {
    const path = execSync('command -v codex', { encoding: 'utf8' }).trim();
    return Boolean(path);
  } catch {
    return false;
  }
}
