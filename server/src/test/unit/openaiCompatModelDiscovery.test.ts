import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { discoverOpenAiCompatEndpointModels, type OpenAiCompatModelDiscoveryEndpointResult, } from '../../chat/openaiCompatModelDiscovery.js';
import { parseOpenAiCompatEndpointConfig } from '../../config/openaiCompatEndpoints.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
const tempServers: Array<{
    stop: () => Promise<void>;
}> = [];
const originalEndpointsEnv = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
const originalEndpointKeysEnv = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
afterEach(async () => {
    while (tempServers.length > 0) {
        await tempServers.pop()!.stop();
    }
    if (originalEndpointsEnv === undefined) {
        clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
    }
    else {
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalEndpointsEnv);
    }
    if (originalEndpointKeysEnv === undefined) {
        clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS");
    }
    else {
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS", originalEndpointKeysEnv);
    }
});
const makeEndpoint = (baseUrl: string, capabilities = 'responses', overrides?: {
    displayLabel?: string;
    authLookupKey?: string;
}) => ({
    ...parseOpenAiCompatEndpointConfig(`${baseUrl}/v1|${capabilities}`, {
        pathLabel: 'codeinfo_openai_endpoint',
    }),
    ...(overrides ?? {}),
});
function configureExternalEndpointEnv(params: {
    endpointId: string;
    apiKey?: string;
    label?: string;
    capabilities?: string;
}) {
    const label = params.label ?? 'External';
    const capabilities = params.capabilities ?? 'responses';
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${label},${params.endpointId}|${capabilities}`);
    if (params.apiKey) {
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS", `${label},${params.apiKey}`);
        return;
    }
    clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS");
}
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
    assert.match(result.warnings[0]?.message ?? '', /Skipping duplicate normalized endpoint/);
    assert.match(result.warnings[1]?.message ?? '', /Skipping config-pinned endpoint/);
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
    assert.equal(slowServer.requestCount(), 3);
    assert.equal(healthyServer.requestCount(), 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]?.message ?? '', /Failed to discover external models/);
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
    assert.equal(failingServer.requestCount(), 3);
    assert.equal(healthyServer.requestCount(), 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]?.message ?? '', /Failed to discover external models/);
});
test('retries transient rate-limited discovery before succeeding', async () => {
    const server = await startExternalOpenAiCompatServer({
        modelResponses: [
            {
                status: 429,
                headers: {
                    'content-type': 'application/json',
                    'retry-after': '0',
                },
                body: { error: 'rate limited' },
            },
            {
                status: 200,
                body: {
                    object: 'list',
                    data: [{ id: 'recovered-model', object: 'model' }],
                },
            },
        ],
    });
    tempServers.push(server);
    const result = await discoverOpenAiCompatEndpointModels({
        endpoints: [makeEndpoint(server.baseUrl)],
    });
    assert.deepEqual(result.endpoints[0]?.modelIds, ['recovered-model']);
    assert.equal(server.requestCount(), 2);
    assert.deepEqual(result.warnings, []);
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
    assert.match(result.warnings[0]?.message ?? '', /Failed to discover external models/);
});
test('sends bearer auth when the endpoint has a configured key', async () => {
    const server = await startExternalOpenAiCompatServer({
        models: ['alpha'],
        requiredBearerToken: 'sk-test',
    });
    tempServers.push(server);
    const endpoint = makeEndpoint(server.baseUrl, 'responses', {
        displayLabel: 'OpenRouter',
        authLookupKey: 'openrouter',
    });
    configureExternalEndpointEnv({
        endpointId: endpoint.endpointId,
        apiKey: 'sk-test',
        label: 'OpenRouter',
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
test('filters OpenRouter discovery down to tool-capable models for Codex', async () => {
    const endpoint = makeEndpoint('https://openrouter.ai/api', 'responses', {
        displayLabel: 'OpenRouter',
        authLookupKey: 'openrouter',
    });
    const result = await discoverOpenAiCompatEndpointModels({
        endpoints: [endpoint],
        provider: 'codex',
        fetchImpl: async () => new Response(JSON.stringify({
            object: 'list',
            data: [
                {
                    id: 'meta-llama/llama-3.2-3b-instruct:free',
                    supported_parameters: ['temperature', 'top_p'],
                },
                {
                    id: 'openai/gpt-chat-latest',
                    supported_parameters: ['tools', 'tool_choice', 'response_format'],
                },
                {
                    id: 'google/gemini-3.5-flash',
                    supported_parameters: ['tools'],
                },
            ],
        }), {
            status: 200,
            headers: {
                'content-type': 'application/json',
            },
        }),
    });
    assert.deepEqual(result.endpoints[0]?.modelIds, [
        'openai/gpt-chat-latest',
        'google/gemini-3.5-flash',
    ]);
    assert.deepEqual(result.warnings, []);
});
