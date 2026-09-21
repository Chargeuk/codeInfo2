import assert from 'node:assert/strict';
import test from 'node:test';
import { SYSTEM_CONTEXT, VECTORSEARCH_PROTOCOL_REMINDER, } from '@codeinfo2/common';
import { getChatInterface } from '../../chat/factory.js';
import type { ChatEvent } from '../../chat/interfaces/ChatInterface.js';
import { ChatInterfaceCopilot } from '../../chat/interfaces/ChatInterfaceCopilot.js';
import { buildOpenAiCompatProxyBaseUrl } from '../../chat/openaiCompatAdapter.js';
import { createMockCopilotSdkHarness, createSessionIdleEvent, type MockCopilotSdkHarness, } from '../support/mockCopilotSdk.js';
const toComparableJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const collectEvents = (chat: ChatInterfaceCopilot) => {
    const emitted: ChatEvent[] = [];
    for (const eventName of [
        'thread',
        'token',
        'analysis',
        'tool-request',
        'tool-result',
        'final',
        'complete',
        'error',
    ] as const) {
        chat.on(eventName, (event) => emitted.push(event));
    }
    return emitted;
};
const createChat = (harness: MockCopilotSdkHarness) => getChatInterface('copilot', {
    copilotLifecycle: harness.createLifecycle(),
}) as ChatInterfaceCopilot;
test.afterEach(() => {
    clearScopedTestEnvValue("CODEINFO_COPILOT_SEND_AND_WAIT_TIMEOUT_SEC");
});
const runtimeConfigWithMcpServers = {
    mcp_servers: {
        code_info: {
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
            tool_timeout_sec: 1800,
        },
        deepwiki: {
            url: 'https://mcp.deepwiki.com/mcp',
        },
    },
};
test('ChatInterfaceCopilot create-session path maps streamed events into ChatInterface events', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-create-session',
    });
    const chat = createChat(harness);
    const emitted = collectEvents(chat);
    await chat.run('Hello from Copilot', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: false,
        runtimeConfig: runtimeConfigWithMcpServers,
    }, 'copilot-conversation-1', 'copilot-gpt-5');
    assert.deepEqual(emitted.map((event) => event.type), ['thread', 'token', 'final', 'complete']);
    assert.equal(harness.getState().lastCreateSessionConfig?.sessionId, 'copilot-conversation-1');
    assert.equal(harness.getState().lastCreateSessionConfig?.systemMessage?.mode, 'append');
    const createSystemMessageContent = harness.getState().lastCreateSessionConfig?.systemMessage?.content;
    assert.ok(createSystemMessageContent);
    assert.ok(createSystemMessageContent.startsWith(SYSTEM_CONTEXT.trim()));
    assert.ok(harness
        .getState()
        .lastSendAndWaitPrompt?.includes(`Hello from Copilot\n- ${VECTORSEARCH_PROTOCOL_REMINDER}`));
    assert.deepEqual(toComparableJson(harness.getState().lastCreateSessionConfig?.mcpServers), {
        code_info: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
            tools: ['*'],
            timeout: 1800000,
        },
        deepwiki: {
            type: 'http',
            url: 'https://mcp.deepwiki.com/mcp',
            tools: ['*'],
        },
    });
});
test('ChatInterfaceCopilot resume path keeps event mapping aligned with create', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-resume-session',
    });
    const chat = createChat(harness);
    const emitted = collectEvents(chat);
    await chat.run('Resume this thread', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: true,
        runtimeConfig: runtimeConfigWithMcpServers,
    }, 'copilot-conversation-2', 'copilot-gpt-5');
    assert.equal(harness.getState().lastResumeSession?.sessionId, 'copilot-conversation-2');
    assert.equal(harness.getState().lastResumeSession?.config.systemMessage, undefined);
    assert.ok(harness
        .getState()
        .lastSendAndWaitPrompt?.includes(`Resume this thread\n- ${VECTORSEARCH_PROTOCOL_REMINDER}`));
    assert.deepEqual(emitted.map((event) => event.type), ['thread', 'tool-request', 'tool-result', 'complete']);
    const toolRequest = emitted.find((event): event is Extract<ChatEvent, {
        type: 'tool-request';
    }> => event.type === 'tool-request');
    const toolResult = emitted.find((event): event is Extract<ChatEvent, {
        type: 'tool-result';
    }> => event.type === 'tool-result');
    assert.equal(toolRequest?.name, 'read_file');
    assert.equal(toolResult?.name, 'read_file');
    assert.deepEqual(toComparableJson(harness.getState().lastResumeSession?.config.mcpServers), {
        code_info: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
            tools: ['*'],
            timeout: 1800000,
        },
        deepwiki: {
            type: 'http',
            url: 'https://mcp.deepwiki.com/mcp',
            tools: ['*'],
        },
    });
});
test('ChatInterfaceCopilot create-session forwards MCP servers without registering custom SDK tools', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-create-permission',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Need permissions', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: false,
        runtimeConfig: runtimeConfigWithMcpServers,
    }, 'copilot-conversation-3', 'copilot-gpt-5');
    const result = await harness
        .getState()
        .lastCreateSessionConfig?.onPermissionRequest?.({} as never, { sessionId: 'copilot-conversation-3' } as never);
    assert.deepEqual(result, { kind: 'approve-once' });
    assert.equal(harness.getState().lastCreateSessionConfig?.tools, undefined);
    assert.equal(harness.getState().lastCreateSessionConfig?.availableTools, undefined);
    assert.deepEqual(toComparableJson(harness.getState().lastCreateSessionConfig?.mcpServers), {
        code_info: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
            tools: ['*'],
            timeout: 1800000,
        },
        deepwiki: {
            type: 'http',
            url: 'https://mcp.deepwiki.com/mcp',
            tools: ['*'],
        },
    });
    assert.equal(harness.getState().lastSendAndWaitTimeoutMs, 7200000);
});
test('ChatInterfaceCopilot appends provider-specific system prompts after the shared system context', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-system-message-merge',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Use both system prompts', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: false,
        systemPrompt: 'Agent-specific instructions go here.',
    }, 'copilot-conversation-system-merge', 'copilot-gpt-5');
    assert.equal(harness.getState().lastCreateSessionConfig?.systemMessage?.mode, 'append');
    assert.equal(harness.getState().lastCreateSessionConfig?.systemMessage?.content, `${SYSTEM_CONTEXT.trim()}\n\nAgent-specific instructions go here.`);
});
test('ChatInterfaceCopilot omits the shared system context and inline reminder when disableSystemContext is true', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-disable-system-context',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Skip the shared prompt', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: false,
        disableSystemContext: true,
        systemPrompt: 'Agent-specific instructions only.',
    }, 'copilot-conversation-disable-system-context', 'copilot-gpt-5');
    assert.equal(harness.getState().lastCreateSessionConfig?.systemMessage?.content, 'Agent-specific instructions only.');
    assert.equal(harness.getState().lastSendAndWaitPrompt, 'Skip the shared prompt');
});
test('ChatInterfaceCopilot create-session removes all tools when toolAccess is off', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-create-runtime-flags',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    const emitted = collectEvents(chat);
    await chat.run('Use runtime flags', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: false,
        agentFlags: {
            modelReasoningEffort: 'high',
            toolAccess: 'off',
        },
        runtimeConfig: runtimeConfigWithMcpServers,
    }, 'copilot-conversation-4', 'copilot-gpt-5');
    assert.equal(emitted[0]?.type, 'thread');
    assert.equal(harness.getState().lastCreateSessionConfig?.reasoningEffort, 'high');
    assert.equal(harness.getState().lastCreateSessionConfig?.tools, undefined);
    assert.deepEqual(harness.getState().lastCreateSessionConfig?.availableTools, []);
    assert.deepEqual(toComparableJson(harness.getState().lastCreateSessionConfig?.mcpServers), {
        code_info: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
            tools: [],
            timeout: 1800000,
        },
        deepwiki: {
            type: 'http',
            url: 'https://mcp.deepwiki.com/mcp',
            tools: [],
        },
    });
});
test('ChatInterfaceCopilot routes authenticated OpenAI-compatible providers through the shared proxy', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-authenticated-openai-provider',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Use authenticated endpoint', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: false,
        codeinfoOpenAiEndpoint: {
            endpointId: 'https://openrouter.ai/api/v1',
            baseUrl: 'https://openrouter.ai/api/v1',
            capabilities: ['responses', 'completions'],
            displayLabel: 'OpenRouter',
            authLookupKey: 'openrouter',
        },
        runtimeConfig: runtimeConfigWithMcpServers,
    }, 'copilot-conversation-auth', 'openai/gpt-oss-20b');
    assert.deepEqual(toComparableJson(harness.getState().lastCreateSessionConfig?.provider), {
        type: 'openai',
        baseUrl: buildOpenAiCompatProxyBaseUrl({
            endpoint: {
                endpointId: 'https://openrouter.ai/api/v1',
            },
            consumer: 'copilot',
        }),
        wireApi: 'responses',
    });
});
test('ChatInterfaceCopilot resume path keeps permissions allowed through the resume session config', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-resume-permission',
        resumeSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Resume with permissions', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: true,
        runtimeConfig: runtimeConfigWithMcpServers,
    }, 'copilot-conversation-4', 'copilot-gpt-5');
    const result = await harness
        .getState()
        .lastResumeSession?.config.onPermissionRequest?.({} as never, { sessionId: 'copilot-conversation-5' } as never);
    assert.deepEqual(result, { kind: 'approve-once' });
    assert.equal(harness.getState().lastResumeSession?.config.tools, undefined);
    assert.equal(harness.getState().lastResumeSession?.config.availableTools, undefined);
    assert.deepEqual(toComparableJson(harness.getState().lastResumeSession?.config.mcpServers), {
        code_info: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
            tools: ['*'],
            timeout: 1800000,
        },
        deepwiki: {
            type: 'http',
            url: 'https://mcp.deepwiki.com/mcp',
            tools: ['*'],
        },
    });
});
test('ChatInterfaceCopilot resume-session removes all tools when toolAccess is off', async () => {
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-resume-runtime-flags',
        resumeSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Resume and keep tools off', {
        provider: 'copilot',
        skipPersistence: true,
        resumeConversation: true,
        agentFlags: {
            modelReasoningEffort: 'low',
            toolAccess: 'off',
        },
        runtimeConfig: runtimeConfigWithMcpServers,
    }, 'copilot-conversation-6', 'copilot-gpt-5');
    assert.equal(harness.getState().lastResumeSession?.config.reasoningEffort, 'low');
    assert.equal(harness.getState().lastResumeSession?.config.tools, undefined);
    assert.deepEqual(harness.getState().lastResumeSession?.config.availableTools, []);
    assert.deepEqual(toComparableJson(harness.getState().lastResumeSession?.config.mcpServers), {
        code_info: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
            tools: [],
            timeout: 1800000,
        },
        deepwiki: {
            type: 'http',
            url: 'https://mcp.deepwiki.com/mcp',
            tools: [],
        },
    });
});
test('ChatInterfaceCopilot converts timeout seconds from env into sendAndWait milliseconds', async () => {
    setScopedTestEnvValue("CODEINFO_COPILOT_SEND_AND_WAIT_TIMEOUT_SEC", '600');
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-timeout-seconds',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Use configured timeout', { provider: 'copilot', skipPersistence: true, resumeConversation: false }, 'copilot-conversation-timeout', 'copilot-gpt-5');
    assert.equal(harness.getState().lastSendAndWaitTimeoutMs, 600000);
});
test('ChatInterfaceCopilot falls back to the default timeout when env is invalid', async () => {
    setScopedTestEnvValue("CODEINFO_COPILOT_SEND_AND_WAIT_TIMEOUT_SEC", 'abc');
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-timeout-invalid',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Use fallback timeout', { provider: 'copilot', skipPersistence: true, resumeConversation: false }, 'copilot-conversation-timeout-invalid', 'copilot-gpt-5');
    assert.equal(harness.getState().lastSendAndWaitTimeoutMs, 7200000);
});
test('ChatInterfaceCopilot falls back to the default timeout when env is non-positive', async () => {
    setScopedTestEnvValue("CODEINFO_COPILOT_SEND_AND_WAIT_TIMEOUT_SEC", '0');
    const harness = createMockCopilotSdkHarness({
        name: 'copilot-timeout-zero',
        createSessionEvents: [createSessionIdleEvent()],
    });
    const chat = createChat(harness);
    await chat.run('Use non-positive fallback timeout', { provider: 'copilot', skipPersistence: true, resumeConversation: false }, 'copilot-conversation-timeout-zero', 'copilot-gpt-5');
    assert.equal(harness.getState().lastSendAndWaitTimeoutMs, 7200000);
});
