import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import pinoRoll from 'pino-roll';

const logFilePath = process.env.LOG_FILE_PATH || './logs/server.log';
const logDir = path.dirname(logFilePath);
fs.mkdirSync(logDir, { recursive: true });

const destination =
  process.env.LOG_FILE_ROTATE === 'false'
    ? pino.destination(logFilePath)
    : await pinoRoll({ file: logFilePath, frequency: 'daily', mkdir: true });

export const baseLogger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['req.headers.authorization', 'body.password'],
  },
  destination,
);

export function createRequestLogger() {
  return pinoHttp({
    logger: baseLogger,
    genReqId: () => crypto.randomUUID?.() || Date.now().toString(),
  });
}
