import { execSync } from 'node:child_process';

export async function isCodexCliAvailable(): Promise<boolean> {
  const forced = process.env.MCP_FORCE_CODEX_AVAILABLE;
  if (forced === 'true') return true;
  if (forced === 'false') return false;

  try {
    const path = execSync('command -v codex', { encoding: 'utf8' }).trim();
    return Boolean(path);
  } catch {
    return false;
  }
}
