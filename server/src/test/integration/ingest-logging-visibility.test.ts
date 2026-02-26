import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  appendIngestFailureLog,
  mapLmStudioIngestError,
} from '../../ingest/providers/ingestFailureLogging.js';
import { runOpenAiWithRetry } from '../../ingest/providers/openaiRetry.js';
import { resetStore } from '../../logStore.js';
import { createLogsRouter } from '../../routes/logs.js';

test('ingest provider warning/error entries are visible via /logs and /logs/stream', async () => {
  resetStore();

  const app = express();
  app.use('/logs', createLogsRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    let attempts = 0;
    await runOpenAiWithRetry({
      model: 'text-embedding-3-small',
      inputCount: 1,
      tokenEstimate: 12,
      ingestFailureContext: () => ({
        runId: 'run-visible-openai',
        root: '/tmp/visible',
        path: '/tmp/visible',
        currentFile: 'src/openai.ts',
      }),
      sleep: async () => {},
      runStep: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw {
            status: 429,
            message: 'rate limited',
            headers: { 'retry-after-ms': '900' },
          };
        }
        return 'ok';
      },
    });

    const lmstudio = mapLmStudioIngestError(
      new Error('connect ECONNREFUSED 127.0.0.1:1234'),
    );
    appendIngestFailureLog('error', {
      runId: 'run-visible-lmstudio',
      provider: 'lmstudio',
      code: lmstudio.error,
      retryable: lmstudio.retryable,
      model: 'text-embedding-nomic-embed-text-v1.5',
      path: '/tmp/visible',
      root: '/tmp/visible',
      currentFile: 'src/lmstudio.ts',
      message: lmstudio.message,
      stage: 'terminal',
    });

    const logsRes = await request(server)
      .get('/logs')
      .query({ text: 'DEV-0000036:T17:ingest_provider_failure' })
      .expect(200);
    const items = logsRes.body.items as Array<{
      context?: Record<string, unknown>;
    }>;
    assert.ok(items.some((entry) => entry.context?.stage === 'retry'));
    assert.ok(
      items.some(
        (entry) =>
          entry.context?.provider === 'lmstudio' &&
          entry.context?.stage === 'terminal',
      ),
    );

    const streamBody = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        `${baseUrl}/logs/stream?text=${encodeURIComponent(
          'DEV-0000036:T17:ingest_provider_failure',
        )}`,
      );
      req.on('response', (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.includes('DEV-0000036:T17:ingest_provider_failure')) {
            req.destroy();
            resolve(body);
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      setTimeout(() => {
        req.destroy();
        resolve('');
      }, 1000);
    });

    assert.ok(
      streamBody.includes('DEV-0000036:T17:ingest_provider_failure'),
      'expected ingest failure entries in /logs/stream output',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
