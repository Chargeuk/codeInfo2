import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import zlib from 'node:zlib';
import express from 'express';
import request from 'supertest';
import { buildOpenAiCompatProxyBaseUrl, resetOpenAiCompatProxyEndpointRegistryForTests, } from '../../chat/openaiCompatAdapter.js';
import { flattenCodexNamespaceToolsForCustomProvider } from '../../chat/openaiCompatToolFlattening.js';
import { createOpenAiCompatProxyRouter } from '../../routes/openaiCompatProxy.js';
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
    resetOpenAiCompatProxyEndpointRegistryForTests();
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
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${label},${params.endpointId}|responses,completions`);
    if (params.apiKey) {
        setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS", `${label},${params.apiKey}`);
        return;
    }
    clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS");
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
    assert.deepEqual(response.body.models.map((entry: {
        slug?: string;
    }) => entry.slug), ['alpha-model', 'beta-model']);
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
    clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
    clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS");
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
    assert.deepEqual(response.body.models.map((entry: {
        slug?: string;
    }) => entry.slug), ['pinned-model']);
});
test('OpenAI-compatible proxy forwards bearer auth for config-pinned endpoints only when the same URL is declared in the env endpoint list', async () => {
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
    configureExternalEndpointEnv({
        endpointId: `${externalServer.baseUrl}/v1`,
        apiKey: 'required-secret',
        label: 'Pinned Endpoint',
    });
    const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
        endpoint: {
            endpointId: `${externalServer.baseUrl}/v1`,
            baseUrl: `${externalServer.baseUrl}/v1`,
            capabilities: ['responses'],
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
test('OpenAI-compatible proxy does not forward bearer auth for config-pinned endpoints when the same URL is absent from the env endpoint list', async () => {
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
    clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS", 'Pinned Endpoint,required-secret');
    const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
        endpoint: {
            endpointId: `${externalServer.baseUrl}/v1`,
            baseUrl: `${externalServer.baseUrl}/v1`,
            capabilities: ['responses'],
            displayLabel: 'Pinned Endpoint',
        },
        consumer: 'copilot',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    const response = await request(createApp())
        .post(pathName)
        .send({ model: 'alpha-model', input: 'hello' })
        .expect(401);
    assert.deepEqual(response.body, { error: 'unauthorized' });
    assert.equal(externalServer.lastAuthorizationHeader(), undefined);
    assert.equal(externalServer.requestCount(), 1);
});
test('OpenAI-compatible proxy forwards /v1/chat/completions', async () => {
    const externalServer = await startExternalOpenAiCompatServer({
        completionsResponses: [
            {
                status: 200,
                body: {
                    choices: [{ message: { role: 'assistant', content: 'ok' } }],
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
            capabilities: ['completions'],
        },
        consumer: 'copilot',
    });
    const pathName = new URL(`${proxyBaseUrl}/chat/completions`).pathname;
    const response = await request(createApp())
        .post(pathName)
        .send({
        model: 'alpha-model',
        messages: [{ role: 'user', content: 'hello' }],
    })
        .expect(200);
    assert.equal(response.body.choices[0]?.message?.content, 'ok');
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
    assert.deepEqual(response.body.models.map((entry: {
        slug?: string;
    }) => entry.slug), ['recovered-model']);
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
    const oversizedPrompt = 'x'.repeat(150000);
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
test('OpenAI-compatible proxy flattens Codex namespace tools for custom provider responses requests', async () => {
    const originalRequestBody = JSON.stringify({
        model: 'alpha-model',
        input: 'hello',
        tools: [
            {
                type: 'namespace',
                name: 'mcp__code_info__',
                description: 'code info tools',
                tools: [
                    {
                        type: 'function',
                        name: 'ListIngestedRepositories',
                        description: 'list repos',
                        parameters: {
                            type: 'object',
                            properties: {},
                            required: [],
                            additionalProperties: false,
                        },
                    },
                    {
                        type: 'function',
                        name: 'VectorSearch',
                        description: 'search vectors',
                        parameters: {
                            type: 'object',
                            properties: {
                                query: { type: 'string' },
                            },
                            required: ['query'],
                            additionalProperties: false,
                        },
                    },
                ],
            },
        ],
    });
    const expectedFlattened = flattenCodexNamespaceToolsForCustomProvider(originalRequestBody);
    const expectedFlattenedToolNames = Object.keys(expectedFlattened.namespaceToolCallMap);
    const externalServer = await startExternalOpenAiCompatServer({
        responsesResponses: [
            {
                status: 200,
                body: {
                    output: [
                        {
                            type: 'function_call',
                            name: expectedFlattenedToolNames[0],
                            arguments: '{}',
                            call_id: 'call_123',
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
            capabilities: ['responses'],
        },
        consumer: 'codex',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    const response = await request(createApp())
        .post(pathName)
        .send(JSON.parse(originalRequestBody))
        .expect(200);
    const forwarded = JSON.parse(externalServer.lastRequestBodyText() ?? '{}') as {
        tools?: Array<Record<string, unknown>>;
    };
    assert.deepEqual(forwarded.tools?.map((tool) => tool.name), expectedFlattenedToolNames);
    for (const flattenedName of expectedFlattenedToolNames) {
        assert.match(flattenedName, /^[A-Za-z0-9_-]+$/);
        assert.doesNotMatch(flattenedName, /\./);
    }
    assert.deepEqual(forwarded.tools?.map((tool) => tool.type), ['function', 'function']);
    assert.deepEqual(response.body.output, [
        {
            type: 'function_call',
            name: 'ListIngestedRepositories',
            namespace: 'mcp__code_info__',
            arguments: '{}',
            call_id: 'call_123',
        },
    ]);
});
test('OpenAI-compatible proxy leaves Copilot namespace tools unchanged', async () => {
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
            capabilities: ['responses'],
        },
        consumer: 'copilot',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    await request(createApp())
        .post(pathName)
        .send({
        model: 'alpha-model',
        input: 'hello',
        tools: [
            {
                type: 'namespace',
                name: 'mcp__code_info__',
                description: 'code info tools',
                tools: [
                    {
                        type: 'function',
                        name: 'ListIngestedRepositories',
                        description: 'list repos',
                        parameters: {
                            type: 'object',
                            properties: {},
                            required: [],
                            additionalProperties: false,
                        },
                    },
                ],
            },
        ],
    })
        .expect(200);
    const forwarded = JSON.parse(externalServer.lastRequestBodyText() ?? '{}') as {
        tools?: Array<Record<string, unknown>>;
    };
    assert.deepEqual(forwarded.tools?.map((tool) => tool.name), ['mcp__code_info__']);
    assert.deepEqual(forwarded.tools?.map((tool) => tool.type), ['namespace']);
});
test('OpenAI-compatible proxy enables Unsloth built-in web search when a web-search tool is requested', async () => {
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
        apiKey: 'sk-unsloth-test',
        label: 'Unsloth',
    });
    const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
        endpoint: {
            endpointId: `${externalServer.baseUrl}/v1`,
            capabilities: ['responses'],
            displayLabel: 'Unsloth',
            authLookupKey: 'unsloth',
            supportsBuiltInWebSearch: true,
        },
        consumer: 'copilot',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    await request(createApp())
        .post(pathName)
        .send({
        model: 'alpha-model',
        input: 'hello',
        tools: [
            { type: 'web_search_preview' },
            { type: 'function', name: 'keep_me', parameters: { type: 'object' } },
        ],
    })
        .expect(200);
    const forwarded = JSON.parse(externalServer.lastRequestBodyText() ?? '{}') as {
        enable_tools?: boolean;
        enabled_tools?: string[];
        tools?: Array<Record<string, unknown>>;
    };
    assert.equal(forwarded.enable_tools, true);
    assert.deepEqual(forwarded.enabled_tools, ['web_search']);
    assert.deepEqual(forwarded.tools?.map((tool) => tool.type), ['function']);
});
test('OpenAI-compatible proxy does not enable Unsloth built-in web search when web search is explicitly not live', async () => {
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
        apiKey: 'sk-unsloth-test',
        label: 'Unsloth',
    });
    const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
        endpoint: {
            endpointId: `${externalServer.baseUrl}/v1`,
            capabilities: ['responses'],
            displayLabel: 'Unsloth',
            authLookupKey: 'unsloth',
            supportsBuiltInWebSearch: true,
        },
        consumer: 'copilot',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    await request(createApp())
        .post(pathName)
        .send({
        model: 'alpha-model',
        input: 'hello',
        webSearchMode: 'cached',
        tools: [{ type: 'web_search_preview' }],
    })
        .expect(200);
    const forwarded = JSON.parse(externalServer.lastRequestBodyText() ?? '{}') as {
        enable_tools?: boolean;
        enabled_tools?: string[];
        tools?: Array<Record<string, unknown>>;
        webSearchMode?: string;
    };
    assert.equal(forwarded.enable_tools, undefined);
    assert.equal(forwarded.enabled_tools, undefined);
    assert.deepEqual(forwarded.tools?.map((tool) => tool.type), ['web_search_preview']);
    assert.equal(forwarded.webSearchMode, 'cached');
});
test('OpenAI-compatible proxy keeps Unsloth built-in web search disabled when disabled mode is explicit', async () => {
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
        apiKey: 'sk-unsloth-test',
        label: 'Unsloth',
    });
    const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
        endpoint: {
            endpointId: `${externalServer.baseUrl}/v1`,
            capabilities: ['responses'],
            displayLabel: 'Unsloth',
            authLookupKey: 'unsloth',
            supportsBuiltInWebSearch: true,
        },
        consumer: 'copilot',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    await request(createApp())
        .post(pathName)
        .send({
        model: 'alpha-model',
        input: 'hello',
        webSearchMode: 'disabled',
        tools: [{ type: 'web_search_preview' }],
    })
        .expect(200);
    const forwarded = JSON.parse(externalServer.lastRequestBodyText() ?? '{}') as {
        enable_tools?: boolean;
        enabled_tools?: string[];
        tools?: Array<Record<string, unknown>>;
        webSearchMode?: string;
    };
    assert.equal(forwarded.enable_tools, undefined);
    assert.equal(forwarded.enabled_tools, undefined);
    assert.deepEqual(forwarded.tools?.map((tool) => tool.type), ['web_search_preview']);
    assert.equal(forwarded.webSearchMode, 'disabled');
});
test('OpenAI-compatible proxy enables Unsloth built-in web search for normalized live mode values', async () => {
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
        apiKey: 'sk-unsloth-test',
        label: 'Unsloth',
    });
    const proxyBaseUrl = buildOpenAiCompatProxyBaseUrl({
        endpoint: {
            endpointId: `${externalServer.baseUrl}/v1`,
            capabilities: ['responses'],
            displayLabel: 'Unsloth',
            authLookupKey: 'unsloth',
            supportsBuiltInWebSearch: true,
        },
        consumer: 'copilot',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    await request(createApp())
        .post(pathName)
        .send({
        model: 'alpha-model',
        input: 'hello',
        webSearchMode: ' LIVE ',
        tools: [{ type: 'web_search_preview' }],
    })
        .expect(200);
    const forwarded = JSON.parse(externalServer.lastRequestBodyText() ?? '{}') as {
        enable_tools?: boolean;
        enabled_tools?: string[];
        tools?: Array<Record<string, unknown>>;
        webSearchMode?: string;
    };
    assert.equal(forwarded.enable_tools, true);
    assert.deepEqual(forwarded.enabled_tools, ['web_search']);
    assert.deepEqual(forwarded.tools, []);
    assert.equal(forwarded.webSearchMode, ' LIVE ');
});
test('OpenAI-compatible proxy restores namespace tool calls inside streamed Codex responses', async () => {
    const originalRequestBody = JSON.stringify({
        model: 'alpha-model',
        input: 'hello',
        tools: [
            {
                type: 'namespace',
                name: 'mcp__code_info__',
                tools: [
                    {
                        type: 'function',
                        name: 'ListIngestedRepositories',
                        parameters: {
                            type: 'object',
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                ],
            },
        ],
    });
    const expectedFlattened = flattenCodexNamespaceToolsForCustomProvider(originalRequestBody);
    const flattenedToolName = Object.keys(expectedFlattened.namespaceToolCallMap)[0];
    const externalServer = await startExternalOpenAiCompatServer({
        responsesResponses: [
            {
                status: 200,
                headers: {
                    'content-type': 'text/event-stream',
                },
                bodyChunks: [
                    'event: response.output_item.done\n',
                    `data: {"type":"response.output_item.done","item":{"type":"function_call","name":"${flattenedToolName}","arguments":"{}","call_id":"call_123"}}\n\n`,
                    'event: response.completed\n',
                    `data: {"type":"response.completed","response":{"output":[{"type":"function_call","name":"${flattenedToolName}","arguments":"{}","call_id":"call_123"}]}}\n\n`,
                ],
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
            capabilities: ['responses'],
        },
        consumer: 'codex',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    const response = await request(createApp())
        .post(pathName)
        .send(JSON.parse(originalRequestBody))
        .expect(200);
    assert.match(response.text, /"name":"ListIngestedRepositories".*"namespace":"mcp__code_info__"/);
    assert.doesNotMatch(response.text, /"name":"codexns_n\d+_[A-Za-z0-9_-]+_t\d+_[A-Za-z0-9_-]+"/);
});
test('OpenAI-compatible proxy preserves multibyte UTF-8 characters when restoring streamed Codex tool calls', async () => {
    const originalRequestBody = JSON.stringify({
        model: 'alpha-model',
        input: 'hello',
        tools: [
            {
                type: 'namespace',
                name: 'mcp__code_info__',
                tools: [
                    {
                        type: 'function',
                        name: 'ListIngestedRepositories',
                        parameters: {
                            type: 'object',
                            properties: {},
                            additionalProperties: false,
                        },
                    },
                ],
            },
        ],
    });
    const expectedFlattened = flattenCodexNamespaceToolsForCustomProvider(originalRequestBody);
    const flattenedToolName = Object.keys(expectedFlattened.namespaceToolCallMap)[0];
    const payloadText = `data: {"type":"response.output_item.done","item":{"type":"function_call","name":"${flattenedToolName}","arguments":"{\\"note\\":\\"emoji 😄\\"}","call_id":"call_123"}}\n\n`;
    const payloadBuffer = Buffer.from(payloadText, 'utf8');
    const emojiBytes = Buffer.from('😄', 'utf8');
    const emojiStart = payloadBuffer.indexOf(emojiBytes);
    assert.notEqual(emojiStart, -1);
    const splitAt = emojiStart + 2;
    const externalServer = await startExternalOpenAiCompatServer({
        responsesResponses: [
            {
                status: 200,
                headers: {
                    'content-type': 'text/event-stream',
                },
                bodyChunks: [
                    Buffer.from('event: response.output_item.done\n', 'utf8'),
                    payloadBuffer.subarray(0, splitAt),
                    payloadBuffer.subarray(splitAt),
                ],
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
            capabilities: ['responses'],
        },
        consumer: 'codex',
    });
    const pathName = new URL(`${proxyBaseUrl}/responses`).pathname;
    const response = await request(createApp())
        .post(pathName)
        .send(JSON.parse(originalRequestBody))
        .expect(200);
    assert.match(response.text, /"name":"ListIngestedRepositories".*"namespace":"mcp__code_info__"/);
    assert.match(response.text, /emoji 😄/u);
    assert.doesNotMatch(response.text, /�/u);
});
test('OpenAI-compatible proxy strips upstream content-encoding when relaying decoded JSON bodies', async () => {
    const compressedBody = zlib.gzipSync(JSON.stringify({
        id: 'resp_123',
        object: 'response',
        status: 'completed',
        output: [{ type: 'output_text', text: 'PING' }],
    }));
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
    parts[5] = Buffer.from('http://127.0.0.1:65535/v1', 'utf8').toString('base64url');
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
