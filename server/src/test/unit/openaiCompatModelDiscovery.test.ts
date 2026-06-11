import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  discoverOpenAiCompatEndpointModels,
  type OpenAiCompatModelDiscoveryEndpointResult,
} from '../../chat/openaiCompatModelDiscovery.js';
import { parseOpenAiCompatEndpointConfig } from '../../config/openaiCompatEndpoints.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';

const tempServers: Array<{
  stop: () => Promise<void>;
}> = [];

afterEach(async () => {
  while (tempServers.length > 0) {
    await tempServers.pop()!.stop();
  }
});

const makeEndpoint = (
  baseUrl: string,
  capabilities = 'responses',
  overrides?: { apiKey?: string; displayLabel?: string; authLookupKey?: string },
) => ({
  ...parseOpenAiCompatEndpointConfig(`${baseUrl}/v1|${capabilities}`, {
    pathLabel: 'codeinfo_openai_endpoint',
  }),
  ...(overrides ?? {}),
});

function endpointIds(results: OpenAiCompatModelDiscoveryEndpointResult[]) {
  return results.map((result) => result.endpoint.endpointId);
}

test('deduplicates normalized endpoints before fetch and keeps the first result', async () => {
  const server = await startExternalOpenAiCompatServer({
    models: ['alpha'],
  });
  tempServers.push(server);

  const endpoint = makeEndpoint(server.baseUrl);
  const result = await discoverOpenAiCompatEndpointModels({
    endpoints: [endpoint, endpoint],
    pinnedEndpoint: endpoint,
  });

  assert.deepEqual(endpointIds(result.endpoints), [endpoint.endpointId]);
  assert.deepEqual(result.endpoints[0]?.modelIds, ['alpha']);
  assert.equal(server.requestCount(), 1);
  assert.equal(result.warnings.length, 2);
  assert.match(
    result.warnings[0]?.message ?? '',
    /Skipping duplicate normalized endpoint/,
  );
  assert.match(
    result.warnings[1]?.message ?? '',
    /Skipping config-pinned endpoint/,
  );
});

test('preserves normalized input order and merges a pinned endpoint only when absent', async () => {
  const firstServer = await startExternalOpenAiCompatServer({
    models: ['alpha'],
    delayMs: 75,
  });
  const secondServer = await startExternalOpenAiCompatServer({
    models: ['beta'],
    delayMs: 10,
  });
  tempServers.push(firstServer, secondServer);

  const first = makeEndpoint(firstServer.baseUrl);
  const second = makeEndpoint(secondServer.baseUrl);
  const result = await discoverOpenAiCompatEndpointModels({
    endpoints: [first],
    pinnedEndpoint: second,
  });

  assert.deepEqual(endpointIds(result.endpoints), [
    first.endpointId,
    second.endpointId,
  ]);
  assert.deepEqual(result.endpoints[0]?.modelIds, ['alpha']);
  assert.deepEqual(result.endpoints[1]?.modelIds, ['beta']);
  assert.equal(firstServer.requestCount(), 1);
  assert.equal(secondServer.requestCount(), 1);
  assert.deepEqual(result.warnings, []);
});

test('reports a timed-out endpoint without hiding healthy discovery results', async () => {
  const slowServer = await startExternalOpenAiCompatServer({
    models: ['slow-model'],
    responseMode: 'slow',
    delayMs: 200,
  });
  const healthyServer = await startExternalOpenAiCompatServer({
    models: ['healthy-model'],
  });
  tempServers.push(slowServer, healthyServer);

  const result = await discoverOpenAiCompatEndpointModels({
    endpoints: [makeEndpoint(slowServer.baseUrl), makeEndpoint(healthyServer.baseUrl)],
    timeoutMs: 50,
  });

  assert.deepEqual(endpointIds(result.endpoints), [
    makeEndpoint(slowServer.baseUrl).endpointId,
    makeEndpoint(healthyServer.baseUrl).endpointId,
  ]);
  assert.deepEqual(result.endpoints[0]?.modelIds, []);
  assert.deepEqual(result.endpoints[1]?.modelIds, ['healthy-model']);
  assert.equal(slowServer.requestCount(), 1);
  assert.equal(healthyServer.requestCount(), 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]?.message ?? '', /timed out after 50ms/);
});

test('reports a transport-failing endpoint without hiding healthy discovery results', async () => {
  const failingServer = await startExternalOpenAiCompatServer({
    responseMode: 'transport-failure',
  });
  const healthyServer = await startExternalOpenAiCompatServer({
    models: ['healthy-model'],
  });
  tempServers.push(failingServer, healthyServer);

  const result = await discoverOpenAiCompatEndpointModels({
    endpoints: [makeEndpoint(failingServer.baseUrl), makeEndpoint(healthyServer.baseUrl)],
  });

  assert.deepEqual(endpointIds(result.endpoints), [
    makeEndpoint(failingServer.baseUrl).endpointId,
    makeEndpoint(healthyServer.baseUrl).endpointId,
  ]);
  assert.deepEqual(result.endpoints[0]?.modelIds, []);
  assert.deepEqual(result.endpoints[1]?.modelIds, ['healthy-model']);
  assert.equal(failingServer.requestCount(), 1);
  assert.equal(healthyServer.requestCount(), 1);
  assert.equal(result.warnings.length, 1);
  assert.match(
    result.warnings[0]?.message ?? '',
    /Failed to discover external models/,
  );
});

test('isolates malformed payloads to the failing endpoint without affecting healthy results', async () => {
  const malformedServer = await startExternalOpenAiCompatServer({
    responseMode: 'malformed-payload',
  });
  const healthyServer = await startExternalOpenAiCompatServer({
    models: ['healthy-model'],
  });
  tempServers.push(malformedServer, healthyServer);

  const result = await discoverOpenAiCompatEndpointModels({
    endpoints: [makeEndpoint(malformedServer.baseUrl), makeEndpoint(healthyServer.baseUrl)],
  });

  assert.deepEqual(endpointIds(result.endpoints), [
    makeEndpoint(malformedServer.baseUrl).endpointId,
    makeEndpoint(healthyServer.baseUrl).endpointId,
  ]);
  assert.deepEqual(result.endpoints[0]?.modelIds, []);
  assert.deepEqual(result.endpoints[1]?.modelIds, ['healthy-model']);
  assert.equal(malformedServer.requestCount(), 1);
  assert.equal(healthyServer.requestCount(), 1);
  assert.equal(result.warnings.length, 1);
  assert.match(
    result.warnings[0]?.message ?? '',
    /Failed to discover external models/,
  );
});

test('sends bearer auth when the endpoint has a configured key', async () => {
  const server = await startExternalOpenAiCompatServer({
    models: ['alpha'],
    requiredBearerToken: 'sk-test',
  });
  tempServers.push(server);

  const endpoint = makeEndpoint(server.baseUrl, 'responses', {
    apiKey: 'sk-test',
    displayLabel: 'OpenRouter',
    authLookupKey: 'openrouter',
  });
  const result = await discoverOpenAiCompatEndpointModels({
    endpoints: [endpoint],
  });

  assert.deepEqual(endpointIds(result.endpoints), [endpoint.endpointId]);
  assert.deepEqual(result.endpoints[0]?.modelIds, ['alpha']);
  assert.equal(server.lastAuthorizationHeader(), 'Bearer sk-test');
  assert.deepEqual(result.warnings, []);
});

test('reports unauthorized discovery clearly when a required bearer token is missing', async () => {
  const server = await startExternalOpenAiCompatServer({
    models: ['alpha'],
    requiredBearerToken: 'sk-test',
  });
  tempServers.push(server);

  const endpoint = makeEndpoint(server.baseUrl, 'responses', {
    displayLabel: 'OpenRouter',
    authLookupKey: 'openrouter',
  });
  const result = await discoverOpenAiCompatEndpointModels({
    endpoints: [endpoint],
  });

  assert.deepEqual(result.endpoints[0]?.modelIds, []);
  assert.equal(server.lastAuthorizationHeader(), undefined);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]?.message ?? '', /OpenRouter/);
  assert.match(result.warnings[0]?.message ?? '', /HTTP 401/);
});
