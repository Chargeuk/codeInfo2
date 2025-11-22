import type { Response } from 'express';

const isStreamClosed = (res: Response) =>
  res.writableEnded || res.destroyed || res.finished;

export function startStream(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(':\n\n');
}

export function writeEvent(res: Response, payload: unknown) {
  if (isStreamClosed(res)) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function endStream(res: Response) {
  if (isStreamClosed(res)) return;
  res.end();
}

export { isStreamClosed };
