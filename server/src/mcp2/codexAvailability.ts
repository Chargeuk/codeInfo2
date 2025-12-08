import { detectCodex } from '../providers/codexDetection.js';

export async function isCodexAvailable() {
  const forced = process.env.MCP_FORCE_CODEX_AVAILABLE;
  if (forced === 'true') return true;
  if (forced === 'false') return false;

  const detection = detectCodex();
  return detection.available;
}
