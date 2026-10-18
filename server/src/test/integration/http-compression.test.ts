import assert from 'node:assert/strict';
import http from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import test from 'node:test';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import { append, resetStore } from '../../logStore.js';
import { createLogsRouter } from '../../routes/logs.js';
import {
  closeHttpServer,
  waitForHttpServerPort,
} from '../support/httpServer.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(compression());
  app.use(express.json());
  app.post('/echo', (req, res) => res.json(req.body));
  app.use('/logs', createLogsRouter());
  const server = http.createServer(app);
  const portPromise = waitForHttpServerPort(server);
  server.listen(0, '127.0.0.1');
  const port = await portPromise;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function rawRequest(
  url: string,
  options: http.RequestOptions,
  body?: Buffer | string,
) {
  let req!: http.ClientRequest;
  const result = new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    req = http.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () =>
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
  });
  const timer = setTimeout(
    () => req.destroy(new Error('HTTP compression request timed out')),
    resolveConfiguredTestTimeoutMs(5_000),
  );
  try {
    req.end(body);
    return await result;
  } finally {
    clearTimeout(timer);
    req.destroy();
  }
}

test('existing JSON parser inflates gzip Unicode and default middleware negotiates raw response bytes', async () => {
  const { server, baseUrl } = await startServer();
  const payload = { text: 'Hello 世界 🌍 '.repeat(500), nested: { count: 42 } };
  const json = JSON.stringify(payload);
  try {
    for (const accept of ['gzip', 'identity']) {
      const response = await rawRequest(
        `${baseUrl}/echo`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            'Accept-Encoding': accept,
          },
        },
        gzipSync(Buffer.from(json, 'utf8')),
      );
      assert.equal(response.status, 200);
      assert.match(String(response.headers.vary), /Accept-Encoding/i);
      if (accept === 'gzip') {
        assert.equal(response.headers['content-encoding'], 'gzip');
        assert.deepEqual([...response.body.subarray(0, 2)], [0x1f, 0x8b]);
        assert.ok(response.body.byteLength < Buffer.byteLength(json));
        assert.deepEqual(
          JSON.parse(gunzipSync(response.body).toString('utf8')),
          payload,
        );
      } else {
        assert.equal(response.headers['content-encoding'], undefined);
        assert.equal(response.body.toString('utf8'), json);
      }
    }
    const small = await rawRequest(
      `${baseUrl}/echo`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip',
        },
      },
      '{}',
    );
    assert.equal(small.headers['content-encoding'], undefined);
    assert.equal(small.body.toString('utf8'), '{}');
  } finally {
    await closeHttpServer(server);
  }
});

test('gzip requests retain the existing inflated JSON limit and CORS header reflection', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const preflight = await rawRequest(`${baseUrl}/echo`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5001',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,content-encoding',
      },
    });
    assert.equal(preflight.status, 204);
    assert.match(
      String(preflight.headers['access-control-allow-headers']),
      /content-encoding/i,
    );
    assert.match(
      String(preflight.headers['access-control-allow-headers']),
      /content-type/i,
    );
    const oversized = await rawRequest(
      `${baseUrl}/echo`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        },
      },
      gzipSync(JSON.stringify({ text: 'a'.repeat(110 * 1024) })),
    );
    assert.equal(oversized.status, 413);
  } finally {
    await closeHttpServer(server);
  }
});

test('compressed logs SSE flushes a heartbeat and successive complete events while connection stays open', async () => {
  resetStore();
  const { server, baseUrl } = await startServer();
  const decoder = createGunzip();
  // The request timeout can fire before the response iterator starts reading.
  decoder.on('error', () => {});
  let req!: http.ClientRequest;
  let response: http.IncomingMessage | undefined;
  const connected = new Promise<http.IncomingMessage>((resolve, reject) => {
    req = http.request(
      `${baseUrl}/logs/stream?text=compression-proof`,
      {
        headers: { 'Accept-Encoding': 'gzip' },
      },
      resolve,
    );
    req.on('error', reject);
  });
  const timer = setTimeout(() => {
    const error = new Error('Timed out waiting for incremental compressed SSE');
    decoder.destroy(error);
    req.destroy(error);
  }, resolveConfiguredTestTimeoutMs(5_000));
  let buffered = '';
  const textDecoder = new StringDecoder('utf8');
  const iterator = decoder[Symbol.asyncIterator]();
  async function nextFrame() {
    while (!buffered.includes('\n\n')) {
      const chunk = await iterator.next();
      assert.equal(chunk.done, false, 'SSE closed before next frame');
      buffered += textDecoder.write(chunk.value);
    }
    const end = buffered.indexOf('\n\n');
    const frame = buffered.slice(0, end);
    buffered = buffered.slice(end + 2);
    return frame;
  }
  try {
    req.end();
    response = await connected;
    assert.equal(response.headers['content-encoding'], 'gzip');
    response.on('error', (error) => decoder.destroy(error));
    response.pipe(decoder);
    assert.equal(
      await nextFrame(),
      ':',
      'initial heartbeat must arrive before any log is published',
    );
    for (const text of [
      'compression-proof first 世界',
      'compression-proof second 🌍',
    ]) {
      const framePromise = nextFrame();
      const entry = append({
        level: 'info',
        source: 'server',
        timestamp: new Date().toISOString(),
        message: text,
      });
      const frame = await framePromise;
      assert.match(frame, new RegExp(`^id: ${entry.sequence}\\n`));
      const data = JSON.parse(frame.split('\ndata: ')[1]);
      assert.equal(data.message, text);
      assert.equal(data.sequence, entry.sequence);
      assert.equal(response.complete, false);
      assert.equal(response.destroyed, false);
    }
  } finally {
    clearTimeout(timer);
    req.destroy();
    response?.destroy();
    decoder.destroy();
    try {
      await iterator.return?.();
    } finally {
      server.closeAllConnections();
      await closeHttpServer(server);
      resetStore();
    }
  }
});
