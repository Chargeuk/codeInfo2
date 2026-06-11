import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import express from 'express';
import request from 'supertest';

import { buildOpenAiCompatProxyBaseUrl } from '../../chat/openaiCompatAdapter.js';
import { createOpenAiCompatProxyRouter } from '../../routes/openaiCompatProxy.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';

const tempServers: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  while (tempServers.length > 0) {
    await tempServers.pop()!.stop();
  }
});

function createApp() {
  const app = express();
  app.use('/', createOpenAiCompatProxyRouter());
  app.use(express.json());
  return app;
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

test('OpenAI-compatible proxy retries pre-stream response failures before succeeding', async () => {
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

  assert.deepEqual(response.body.output, [
    { type: 'output_text', text: 'recovered' },
  ]);
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
