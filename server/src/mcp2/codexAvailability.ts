import { detectCodex } from '../providers/codexDetection.js';
import { getScopedEnvValue } from '../test/support/testEnvOverrideScope.js';

export async function isCodexAvailable() {
  const forced = getScopedEnvValue('MCP_FORCE_CODEX_AVAILABLE');
  if (forced === 'true') return true;
  if (forced === 'false') return false;

  const detection = detectCodex();
  return detection.available;
}
