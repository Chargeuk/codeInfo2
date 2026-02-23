import { baseLogger } from '../logger.js';

export const MCP_KEEPALIVE_INTERVAL_MS = 10_000;
export const MCP_KEEPALIVE_INITIAL_FLUSH = ' ';
export const MCP_KEEPALIVE_HEARTBEAT = '\n';

type KeepAliveResponse = {
  headersSent: boolean;
  writableEnded?: boolean;
  destroyed?: boolean;
  writeHead: (statusCode: number, headers: Record<string, string>) => unknown;
  flushHeaders?: () => void;
  write: (chunk: string) => unknown;
  end: (payload?: string) => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

type KeepAliveReason =
  | 'send_json'
  | 'close'
  | 'finish'
  | 'error'
  | 'response_closed'
  | 'initial_write_failed'
  | 'heartbeat_write_failed'
  | 'manual';

type KeepAliveOptions = {
  res: KeepAliveResponse;
  writeHeadersIfNeeded: () => void;
  surface: string;
  requestId?: string;
  intervalMs?: number;
};

export type KeepAliveController = {
  start: () => void;
  stop: (reason?: KeepAliveReason) => void;
  sendJson: (payload: unknown) => void;
  isRunning: () => boolean;
};

function safeWrite(res: KeepAliveResponse, chunk: string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

export function createKeepAliveController(
  options: KeepAliveOptions,
): KeepAliveController {
  const intervalMs = options.intervalMs ?? MCP_KEEPALIVE_INTERVAL_MS;
  let keepAliveTimer: NodeJS.Timeout | undefined;
  let running = false;

  const stop = (reason: KeepAliveReason = 'manual') => {
    if (!running) return;
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
    running = false;
    baseLogger.info(
      {
        event: 'DEV-0000035:T4:keepalive_lifecycle_stopped',
        surface: options.surface,
        requestId: options.requestId,
        reason,
      },
      'DEV-0000035:T4:keepalive_lifecycle_stopped',
    );
  };

  options.res.on('close', () => stop('close'));
  options.res.on('finish', () => stop('finish'));
  options.res.on('error', () => stop('error'));

  const start = () => {
    if (running) return;
    running = true;
    options.writeHeadersIfNeeded();
    baseLogger.info(
      {
        event: 'DEV-0000035:T4:keepalive_lifecycle_started',
        surface: options.surface,
        requestId: options.requestId,
        intervalMs,
      },
      'DEV-0000035:T4:keepalive_lifecycle_started',
    );

    if (!safeWrite(options.res, MCP_KEEPALIVE_INITIAL_FLUSH)) {
      stop('initial_write_failed');
      return;
    }

    keepAliveTimer = setInterval(() => {
      if (options.res.writableEnded || options.res.destroyed) {
        stop('response_closed');
        return;
      }
      if (!safeWrite(options.res, MCP_KEEPALIVE_HEARTBEAT)) {
        stop('heartbeat_write_failed');
      }
    }, intervalMs);
    keepAliveTimer.unref?.();
  };

  const sendJson = (payload: unknown) => {
    stop('send_json');
    options.writeHeadersIfNeeded();
    options.res.end(JSON.stringify(payload));
  };

  return {
    start,
    stop,
    sendJson,
    isRunning: () => running,
  };
}
