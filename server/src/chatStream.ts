import type { Response } from 'express';

export function startStream(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(':\n\n');
}

export function writeEvent(res: Response, payload: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function endStream(res: Response) {
  if (res.writableEnded || res.destroyed) return;
  res.end();
}
