import { isLogEntry, type LogEntry, type LogLevel } from '@codeinfo2/common';
import {
  Router,
  json,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  append,
  entryMatches,
  lastSequence,
  query as queryLogs,
  subscribe,
  type Filters,
} from '../logStore.js';
import { resolveLogConfig } from '../logger.js';

const ALLOWED_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
const SENSITIVE_KEYS = ['authorization', 'password', 'token'];

function redactObject(
  obj: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (
        SENSITIVE_KEYS.some(
          (blocked) => blocked.toLowerCase() === key.toLowerCase(),
        )
      ) {
        return [key, '[redacted]'];
      }
      return [key, value];
    }),
  );
}

function normalizeEntries(body: unknown): LogEntry[] | null {
  const payload = Array.isArray(body) ? body : [body];
  if (!payload.length) return null;
  const entries: LogEntry[] = [];
  for (const candidate of payload) {
    if (!isLogEntry(candidate)) return null;
    const entry = candidate as LogEntry;
    if (!ALLOWED_LEVELS.includes(entry.level)) return null;
    if (!['server', 'client'].includes(entry.source)) return null;
    entries.push(entry);
  }
  return entries;
}

function parseList(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildFilters(query: Record<string, unknown>): Filters {
  const level = parseList(query.level).filter((lvl) =>
    ALLOWED_LEVELS.includes(lvl as LogLevel),
  ) as LogLevel[];
  const source = parseList(query.source).filter((src) =>
    ['client', 'server'].includes(src),
  );
  const since = Number(query.since);
  const until = Number(query.until);
  const sinceSequence = Number(
    (query.sinceSequence as string | undefined) ??
      (query['last-event-id'] as string | undefined),
  );
  const filters: Filters = {};
  if (level.length) filters.level = level;
  if (source.length) filters.source = source;
  if (typeof query.text === 'string' && query.text.trim()) {
    filters.text = query.text;
  }
  if (!Number.isNaN(since)) filters.since = since;
  if (!Number.isNaN(until)) filters.until = until;
  if (!Number.isNaN(sinceSequence)) filters.sinceSequence = sinceSequence;
  return filters;
}

function sendEvent(res: Response, entry: LogEntry) {
  res.write(`id: ${entry.sequence}\n`);
  res.write(`data: ${JSON.stringify(entry)}\n\n`);
}

function sendHeartbeat(res: Response) {
  res.write(':\n\n');
}

export function createLogsRouter() {
  const router = Router();
  const { maxClientBytes } = resolveLogConfig();

  router.use(json({ limit: `${maxClientBytes}b`, strict: false }));
  router.use(
    (
      err: { type?: string } | undefined,
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (err?.type === 'entity.too.large') {
        return res.status(400).json({ error: 'payload too large' });
      }
      return next(err);
    },
  );

  router.post('/', (req, res) => {
    const rawSize = JSON.stringify(req.body ?? {}).length;
    if (rawSize > maxClientBytes) {
      return res.status(400).json({ error: 'payload too large' });
    }

    const entries = normalizeEntries(req.body);
    if (!entries) {
      return res.status(400).json({ error: 'invalid log entry' });
    }

    const requestId: string | undefined = res.locals.requestId;
    let lastSequence: number | undefined;

    entries.forEach((entry) => {
      const sanitized: LogEntry = {
        ...entry,
        requestId: entry.requestId ?? requestId,
        context: redactObject(entry.context),
      };
      const saved = append(sanitized);
      lastSequence = saved.sequence;
    });

    return res.status(202).json({ status: 'accepted', sequence: lastSequence });
  });

  router.get('/', (req, res) => {
    const filters = buildFilters(req.query as Record<string, unknown>);
    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(1, limitParam), 200)
      : 200;
    const items = queryLogs(filters, limit);
    const lastSeq = lastSequence();
    const hasMore = items.length === limit && (items[0]?.sequence ?? 0) > 1;
    res.json({ items, lastSequence: lastSeq, hasMore });
  });

  router.get('/stream', (req, res) => {
    const filters = buildFilters(req.query as Record<string, unknown>);
    const headerLastId = req.header('last-event-id');
    const headerSeq = headerLastId ? Number(headerLastId) : NaN;
    if (!Number.isNaN(headerSeq)) filters.sinceSequence = headerSeq;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    sendHeartbeat(res);
    const initial = queryLogs(filters, 200).filter((entry) =>
      entryMatches(entry, filters),
    );
    initial.forEach((entry) => sendEvent(res, entry));

    const heartbeat = setInterval(() => sendHeartbeat(res), 15_000);
    const unsubscribe = subscribe((entry) => {
      if (!entryMatches(entry, filters)) return;
      sendEvent(res, entry);
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  return router;
}
