import { setTimeout as delay } from 'timers/promises';
import { resolveCodeinfoMcpEndpointContract } from '../config/mcpEndpoints.js';
import { baseLogger } from '../logger.js';

type McpStatus = { available: boolean; reason?: string };

let cached: { status: McpStatus; expires: number } | null = null;

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 1_500;

export async function getMcpStatus(): Promise<McpStatus> {
  const now = Date.now();
  if (cached && cached.expires > now) return cached.status;

  let url: string;
  try {
    url = resolveCodeinfoMcpEndpointContract().classicMcpUrl;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'mcp_unresolved';
    const status: McpStatus = { available: false, reason };
    cached = { status, expires: now + DEFAULT_TTL_MS };
    baseLogger.warn({ reason }, 'mcp availability check failed');
    return status;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = (await res.json()) as { result?: unknown };
    const ok = json && typeof json === 'object' && 'result' in json;

    const status: McpStatus = ok
      ? { available: true }
      : { available: false, reason: 'initialize_failed' };

    cached = { status, expires: now + DEFAULT_TTL_MS };
    baseLogger.info(
      { url, available: status.available },
      'mcp availability check',
    );
    return status;
  } catch (err) {
    const reason = (err as Error)?.message ?? 'mcp_unreachable';
    const status: McpStatus = { available: false, reason };
    cached = { status, expires: now + DEFAULT_TTL_MS };
    baseLogger.warn({ url, reason }, 'mcp availability check failed');
    return status;
  } finally {
    clearTimeout(timeout);
    await delay(0); // yield to ensure abort is processed
  }
}

export function resetMcpStatusCache() {
  cached = null;
}
