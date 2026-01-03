import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { LogEntry } from '@codeinfo2/common';
import type { Response } from 'express';
import { Router } from 'express';
import { mapHostWorkingFolderToWorkdir } from '../ingest/pathMap.js';
import { append as appendLog } from '../logStore.js';
import { baseLogger } from '../logger.js';

type IngestDirsErrorCode = 'OUTSIDE_BASE' | 'NOT_FOUND' | 'NOT_DIRECTORY';

function logLifecycle(message: string, context: Record<string, unknown>) {
  const entry: LogEntry = {
    level: 'info',
    source: 'server',
    message,
    timestamp: new Date().toISOString(),
    context,
  };
  appendLog(entry);
  baseLogger.info({ ...context }, message);
}

function replyError(
  res: Response,
  params: { base: string; path: string; code: IngestDirsErrorCode },
  status: number,
) {
  logLifecycle('0000020 ingest dirs list error', {
    base: params.base,
    path: params.path,
    code: params.code,
  });
  return res.status(status).json({ status: 'error', code: params.code });
}

export function createIngestDirsRouter() {
  const router = Router();

  router.get('/ingest/dirs', async (req, res) => {
    const base = process.env.HOST_INGEST_DIR || '/data';
    const raw = typeof req.query.path === 'string' ? req.query.path : '';
    const requested = raw.trim() || base;

    logLifecycle('0000020 ingest dirs list start', {
      base,
      path: requested,
    });

    const mapped = mapHostWorkingFolderToWorkdir({
      hostIngestDir: base,
      codexWorkdir: '/',
      hostWorkingFolder: requested,
    });
    if ('error' in mapped) {
      return replyError(
        res,
        { base, path: requested, code: 'OUTSIDE_BASE' },
        400,
      );
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(requested);
    } catch {
      return replyError(res, { base, path: requested, code: 'NOT_FOUND' }, 404);
    }

    if (!st.isDirectory()) {
      return replyError(
        res,
        { base, path: requested, code: 'NOT_DIRECTORY' },
        400,
      );
    }

    let entries: Dirent[];
    try {
      entries = (await readdir(requested, {
        withFileTypes: true,
      })) as unknown as Dirent[];
    } catch {
      return replyError(res, { base, path: requested, code: 'NOT_FOUND' }, 404);
    }
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    logLifecycle('0000020 ingest dirs list success', {
      base,
      path: requested,
      dirs: dirs.length,
    });
    return res.json({ base, path: requested, dirs });
  });

  return router;
}
