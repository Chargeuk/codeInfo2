import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import pinoRoll from 'pino-roll';

type LogConfig = {
  level: string;
  bufferMax: number;
  maxClientBytes: number;
  ingestWsThrottleMs: number;
  filePath: string;
  rotate: boolean;
};

export function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveLogConfig(): LogConfig {
  const filePath = process.env.LOG_FILE_PATH ?? './logs/server.log';
  const config: LogConfig = {
    level: process.env.LOG_LEVEL ?? 'info',
    bufferMax: parseNumber(process.env.LOG_BUFFER_MAX, 5000),
    maxClientBytes: parseNumber(process.env.LOG_MAX_CLIENT_BYTES, 32768),
    ingestWsThrottleMs: parseNumber(
      process.env.LOG_INGEST_WS_THROTTLE_MS,
      10_000,
    ),
    filePath,
    rotate: process.env.LOG_FILE_ROTATE !== 'false',
  };
  const logDir = path.dirname(filePath);
  fs.mkdirSync(logDir, { recursive: true });
  return config;
}

const logConfig = resolveLogConfig();

const destination = logConfig.rotate
  ? await pinoRoll({
      file: logConfig.filePath,
      frequency: 'daily',
      mkdir: true,
    })
  : pino.destination(logConfig.filePath);

export const baseLogger = pino(
  {
    level: logConfig.level,
    redact: ['req.headers.authorization', 'body.password'],
  },
  destination,
);

export function createRequestLogger() {
  return pinoHttp({
    logger: baseLogger,
    genReqId: () => crypto.randomUUID?.() || Date.now().toString(),
    autoLogging: {
      ignore: (req) => {
        const url = req.url ?? '';
        if (url.startsWith('/logs')) return true;
        if (url.startsWith('/health')) return true;
        return false;
      },
    },
  });
}
