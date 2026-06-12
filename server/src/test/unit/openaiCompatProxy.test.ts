import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import zlib from 'node:zlib';

import express from 'express';
import request from 'supertest';

import {
  buildOpenAiCompatProxyBaseUrl,
  resetOpenAiCompatProxyEndpointRegistryForTests,
} from '../../chat/openaiCompatAdapter.js';
import { createOpenAiCompatProxyRouter } from '../../routes/openaiCompatProxy.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';

const tempServers: Array<{ stop: () => Promise<void> }> = [];
const originalEndpointsEnv = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
const originalEndpointKeysEnv =
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;

afterEach(async () => {
  while (tempServers.length > 0) {
    await tempServers.pop()!.stop();
  }
  resetOpenAiCompatProxyEndpointRegistryForTests();
  if (originalEndpointsEnv === undefined) {
    delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  } else {
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS = originalEndpointsEnv;
  }
  if (originalEndpointKeysEnv === undefined) {
    delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  } else {
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
      originalEndpointKeysEnv;
  }
});

function createApp() {
  const app = express();
  app.use('/', createOpenAiCompatProxyRouter());
  app.use(express.json());
  return app;
}

function configureExternalEndpointEnv(params: {
  endpointId: string;
  apiKey?: string;
  label?: string;
}) {
  const label = params.label ?? 'External';
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS =
    `${label},${params.endpointId}|responses,completions`;
  if (params.apiKey) {
    process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
      `${label},${params.apiKey}`;
    return;
  }
  delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
}

test('OpenAI-compatible proxy converts models into the Codex catalog shape', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    modelResponses: [
      {
        body: {
          object: 'list',
          data: [
            {
              id: 'alpha-model',
              supported_parameters: ['temperature'],
            },
            {
              id: 'beta-model',
              supported_parameters: ['tools'],
            },
          ],
        },
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'codex',
  });
  const pathName = new URL(`${proxyBaseUrl}/models`).pathname;

  const response = await request(createApp()).get(pathName).expect(200);

  assert.deepEqual(
    response.body.models.map((entry: { slug?: string }) => entry.slug),
    ['alpha-model', 'beta-model'],
  );
  assert.equal(response.body.models[0]?.shell_type, 'shell_command');
});

test('OpenAI-compatible proxy resolves config-pinned endpoints without requiring a global env entry', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    modelResponses: [
      {
        body: {
          object: 'list',
          data: [{ id: 'pinned-model', supported_parameters: ['tools'] }],
        },
      },
    ],
  });
  tempServers.push(externalServer);
  delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
      baseUrl: `${externalServer.baseUrl}/v1`,
      capabilities: ['responses'],
      displayLabel: 'Pinned Endpoint',
    },
    consumer: 'codex',
  });
  const pathName = new URL(`${proxyBaseUrl}/models`).pathname;

  const response = await request(createApp()).get(pathName).expect(200);

  assert.deepEqual(
    response.body.models.map((entry: { slug?: string }) => entry.slug),
    ['pinned-model'],
  );
});

test('OpenAI-compatible proxy forwards bearer auth for config-pinned keyed endpoints', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    requiredBearerToken: 'required-secret',
    responsesResponses: [
      {
        status: 200,
        body: { output: [{ type: 'output_text', text: 'authenticated' }] },
      },
    ],
  });
  tempServers.push(externalServer);
  delete process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS =
    'Pinned Endpoint,required-secret';

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
      baseUrl: `${externalServer.baseUrl}/v1`,
      capabilities: ['responses'],
      displayLabel: 'Pinned Endpoint',
      authLookupKey: 'pinned-endpoint',
    },
    consumer: 'copilot',
  });
  const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;

  const response = await request(createApp())
    .post(pathName)
    .send({ model: 'alpha-model', input: 'hello' })
    .expect(200);

  assert.deepEqual(response.body.output, [
    { type: 'output_text', text: 'authenticated' },
  ]);
  assert.equal(externalServer.lastAuthorizationHeader(), 'Bearer required-secret');
  assert.equal(externalServer.requestCount(), 1);
});

test('OpenAI-compatible proxy emits normalized ids for slug-only Copilot model entries', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    modelResponses: [
      {
        body: {
          object: 'list',
          models: [
            {
              slug: 'slug-only-model',
              object: 'model',
            },
          ],
        },
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'copilot',
  });
  const pathName = new URL(`${proxyBaseUrl}/models`).pathname;

  const response = await request(createApp()).get(pathName).expect(200);

  assert.deepEqual(response.body, {
    object: 'list',
    data: [{ slug: 'slug-only-model', object: 'model', id: 'slug-only-model' }],
  });
});

test('OpenAI-compatible proxy retries model discovery failures before succeeding', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    modelResponses: [
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'retry-after': '0',
        },
        body: { error: 'overloaded' },
      },
      {
        status: 200,
        body: {
          object: 'list',
          data: [{ id: 'recovered-model', supported_parameters: ['tools'] }],
        },
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'codex',
  });
  const pathName = new URL(`${proxyBaseUrl}/models`).pathname;

  const response = await request(createApp()).get(pathName).expect(200);

  assert.deepEqual(
    response.body.models.map((entry: { slug?: string }) => entry.slug),
    ['recovered-model'],
  );
  assert.equal(externalServer.requestCount(), 2);
});

test('OpenAI-compatible proxy accepts large JSON request bodies on internal POST routes', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    responsesResponses: [
      {
        status: 200,
        body: { output: [{ type: 'output_text', text: 'accepted' }] },
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'codex',
  });
  const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;

  const oversizedPrompt = 'x'.repeat(150_000);
  const response = await request(createApp())
    .post(pathName)
    .send({ model: 'alpha-model', input: oversizedPrompt })
    .expect(200);

  assert.deepEqual(response.body.output, [
    { type: 'output_text', text: 'accepted' },
  ]);
  assert.equal(externalServer.requestCount(), 1);
});

test('OpenAI-compatible proxy does not retry inference POST failures', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    responsesResponses: [
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'retry-after': '0',
        },
        body: { error: 'overloaded' },
      },
      {
        status: 200,
        body: { output: [{ type: 'output_text', text: 'recovered' }] },
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'copilot',
  });
  const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;

  const response = await request(createApp())
    .post(pathName)
    .send({ model: 'alpha-model', input: 'hello' })
    .expect(503);

  assert.deepEqual(response.body, { error: 'overloaded' });
  assert.equal(externalServer.requestCount(), 1);
});

test('OpenAI-compatible proxy strips upstream content-encoding when relaying decoded JSON bodies', async () => {
  const compressedBody = zlib.gzipSync(
    JSON.stringify({
      id: 'resp_123',
      object: 'response',
      status: 'completed',
      output: [{ type: 'output_text', text: 'PING' }],
    }),
  );
  const externalServer = await startExternalOpenAiCompatServer({
    responsesResponses: [
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
        body: compressedBody,
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'copilot',
  });
  const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;

  const response = await request(createApp())
    .post(pathName)
    .set('accept', 'application/json')
    .send({ model: 'alpha-model', input: 'hello' })
    .expect(200);

  assert.equal(response.headers['content-encoding'], undefined);
  assert.equal(response.body.status, 'completed');
  assert.deepEqual(response.body.output, [
    { type: 'output_text', text: 'PING' },
  ]);
});

test('OpenAI-compatible proxy blocks upstream set-cookie headers', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    responsesResponses: [
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=provider-cookie; Path=/',
        },
        body: { output: [{ type: 'output_text', text: 'PING' }] },
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'copilot',
  });
  const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;

  const response = await request(createApp())
    .post(pathName)
    .send({ model: 'alpha-model', input: 'hello' })
    .expect(200);

  assert.equal(response.headers['set-cookie'], undefined);
});

test('OpenAI-compatible proxy returns a clean 502 when the upstream body stream fails after headers', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    responsesResponses: [
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
        bodyChunks: ['{"output":[{"type":"output_text","text":"PING"}'],
        destroySocketAfterBodyStart: true,
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'copilot',
  });
  const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;

  const response = await request(createApp())
    .post(pathName)
    .send({ model: 'alpha-model', input: 'hello' })
    .expect(502);

  assert.deepEqual(response.body, { error: 'fetch failed' });
});

test('OpenAI-compatible proxy rejects unknown endpoint tokens', async () => {
  const externalServer = await startExternalOpenAiCompatServer();
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'codex',
  });
  const proxyUrl = new URL(`${proxyBaseUrl}/models`);
  const parts = proxyUrl.pathname.split('/');
  parts[5] = Buffer.from('http://127.0.0.1:65535/v1', 'utf8').toString(
    'base64url',
  );
  proxyUrl.pathname = parts.join('/');

  await request(createApp())
    .get(proxyUrl.pathname)
    .expect(404, { error: 'invalid endpoint token' });
});

test('OpenAI-compatible proxy enforces bearer auth before queued upstream responses', async () => {
  const externalServer = await startExternalOpenAiCompatServer({
    requiredBearerToken: 'required-secret',
    responsesResponses: [
      {
        status: 200,
        body: { output: [{ type: 'output_text', text: 'should-not-return' }] },
      },
    ],
  });
  tempServers.push(externalServer);
  configureExternalEndpointEnv({
    endpointId: `${externalServer.baseUrl}/v1`,
  });

  const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
    endpoint: {
      endpointId: `${externalServer.baseUrl}/v1`,
    },
    consumer: 'copilot',
  });
  const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;

  const response = await request(createApp())
    .post(pathName)
    .send({ model: 'alpha-model', input: 'hello' })
    .expect(401);

  assert.deepEqual(response.body, { error: 'unauthorized' });
  assert.equal(externalServer.requestCount(), 1);
});
