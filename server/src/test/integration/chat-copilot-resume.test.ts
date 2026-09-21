import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import nodeTest from 'node:test';
import request from 'supertest';
import { memoryConversations } from '../../chat/memoryPersistence.js';
import { buildOpenAiCompatProxyBaseUrl } from '../../chat/openaiCompatAdapter.js';
import { startExternalOpenAiCompatServer } from '../support/externalOpenAiCompatServer.js';
import {
  beginScopedTestEnvIsolation,
  endScopedTestEnvIsolation,
} from '../support/processEnvIsolation.js';
import { startCopilotChatServer, waitForAssistantTurn, waitForAssistantTurnCount, } from './support/copilotChatHarness.js';

const test = (name: string, fn: () => Promise<void> | void) =>
  nodeTest(name, async () => {
    beginScopedTestEnvIsolation();
    try {
      await fn();
    } finally {
      endScopedTestEnvIsolation();
    }
  });
async function withTempCopilotHome(chatToml: string): Promise<{
    copilotHome: string;
    cleanup: () => Promise<void>;
}> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeinfo2-copilot-endpoint-'));
    const copilotHome = path.join(root, 'copilot');
    await fs.mkdir(path.join(copilotHome, 'chat'), { recursive: true });
    await fs.writeFile(path.join(copilotHome, 'chat', 'config.toml'), chatToml, 'utf8');
    return {
        copilotHome,
        cleanup: async () => {
            await fs.rm(root, { recursive: true, force: true });
        },
    };
}
const getMcpServerTools = (mcpServers: Record<string, {
    tools?: string[];
}> | undefined): Record<string, string[] | undefined> => Object.fromEntries(Object.entries(mcpServers ?? {}).map(([name, config]) => [
    name,
    config.tools,
]));
test('copilot resume failures stay explicit instead of silently creating a fresh session', async () => {
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-resume-failure',
            resumeSessionError: new Error('resume failed'),
        },
    });
    try {
        const conversationId = 'copilot-resume-failure';
        await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId,
            message: 'First turn',
        })
            .expect(202);
        await waitForAssistantTurn(conversationId);
        await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId,
            message: 'Second turn',
        })
            .expect(202);
        const assistantTurns = await waitForAssistantTurnCount(conversationId, 2);
        const failedTurn = assistantTurns.find((turn) => turn.content.includes('Copilot session resume failed'))?.content ?? '';
        assert.match(failedTurn, /Copilot session resume failed/u);
        assert.equal(server.harness.getState().lastCreateSessionConfig?.sessionId, conversationId);
    }
    finally {
        await server.stop();
    }
});
test('copilot resume-session path uses MCP-configured servers instead of custom SDK tools', async () => {
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-tool-access',
        },
    });
    try {
        await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId: 'copilot-tool-access-on',
            message: 'Tools on',
            agentFlags: {
                toolAccess: 'on',
            },
        });
        await waitForAssistantTurn('copilot-tool-access-on');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.tools, undefined);
        assert.equal(server.harness.getState().lastCreateSessionConfig?.availableTools, undefined);
        assert.deepEqual(Object.keys(server.harness.getState().lastCreateSessionConfig?.mcpServers ?? {}).sort(), ['code_info', 'context7', 'deepwiki', 'mui', 'web_tools']);
        await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId: 'copilot-tool-access-on',
            message: 'Tools still on',
            agentFlags: {
                toolAccess: 'on',
            },
        });
        await waitForAssistantTurnCount('copilot-tool-access-on', 2);
        assert.equal(server.harness.getState().lastResumeSession?.sessionId, 'copilot-tool-access-on');
        assert.equal(server.harness.getState().lastResumeSession?.config.tools, undefined);
        assert.equal(server.harness.getState().lastResumeSession?.config.availableTools, undefined);
        assert.deepEqual(Object.keys(server.harness.getState().lastResumeSession?.config.mcpServers ?? {}).sort(), ['code_info', 'context7', 'deepwiki', 'mui', 'web_tools']);
        await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId: 'copilot-tool-access-off',
            message: 'Tools off',
            agentFlags: {
                toolAccess: 'off',
            },
        });
        await waitForAssistantTurn('copilot-tool-access-off');
        assert.equal(server.harness.getState().lastCreateSessionConfig?.tools, undefined);
        assert.deepEqual(server.harness.getState().lastCreateSessionConfig?.availableTools, []);
        assert.deepEqual(getMcpServerTools(server.harness.getState().lastCreateSessionConfig?.mcpServers), {
            code_info: [],
            context7: [],
            deepwiki: [],
            mui: [],
            web_tools: [],
        });
        await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId: 'copilot-tool-access-off',
            message: 'Tools still off',
            agentFlags: {
                toolAccess: 'off',
            },
        });
        await waitForAssistantTurnCount('copilot-tool-access-off', 2);
        assert.equal(server.harness.getState().lastResumeSession?.sessionId, 'copilot-tool-access-off');
        assert.equal(server.harness.getState().lastResumeSession?.config.tools, undefined);
        assert.deepEqual(server.harness.getState().lastResumeSession?.config.availableTools, []);
        assert.deepEqual(getMcpServerTools(server.harness.getState().lastResumeSession?.config.mcpServers), {
            code_info: [],
            context7: [],
            deepwiki: [],
            mui: [],
            web_tools: [],
        });
    }
    finally {
        await server.stop();
    }
});
test('copilot create-session path builds an OpenAI-compatible provider config from codeinfo_openai_endpoint', async () => {
    const originalCopilotHome = process.env.CODEINFO_COPILOT_HOME;
    const originalCompatEndpoints = process.env.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
    const externalServer = await startExternalOpenAiCompatServer({
        models: ['alpha'],
    });
    const tempHome = await withTempCopilotHome([
        'model = "copilot-gpt-5"',
        `codeinfo_openai_endpoint = "${externalServer.baseUrl}/v1|responses,completions"`,
        '',
    ].join('\n'));
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", tempHome.copilotHome);
    setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", `${externalServer.baseUrl}/v1|responses,completions`);
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-openai-compat-provider',
        },
    });
    try {
        await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId: 'copilot-openai-compat',
            message: 'OpenAI-compatible endpoint please',
            endpointId: `${externalServer.baseUrl}/v1`,
        })
            .expect(202);
        await waitForAssistantTurn('copilot-openai-compat');
        assert.deepEqual(server.harness.getState().lastCreateSessionConfig?.provider, {
            type: 'openai',
            baseUrl: buildOpenAiCompatProxyBaseUrl({
                endpoint: {
                    endpointId: `${externalServer.baseUrl}/v1`,
                },
                consumer: 'copilot',
                env: process.env,
            }),
            wireApi: 'responses',
        });
    }
    finally {
        await server.stop();
        await externalServer.stop();
        if (originalCopilotHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalCopilotHome);
        }
        if (originalCompatEndpoints === undefined) {
            clearScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS");
        }
        else {
            setScopedTestEnvValue("CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS", originalCompatEndpoints);
        }
        await tempHome.cleanup();
    }
});
test('copilot chat rejects malformed pinned endpoint defaults instead of silently degrading to native success', async () => {
    const originalCopilotHome = process.env.CODEINFO_COPILOT_HOME;
    const tempHome = await withTempCopilotHome([
        'model = "copilot-gpt-5"',
        'codeinfo_openai_endpoint = "https://alpha.example|responses,completions"',
        '',
    ].join('\n'));
    setScopedTestEnvValue("CODEINFO_COPILOT_HOME", tempHome.copilotHome);
    const server = await startCopilotChatServer({
        scenario: {
            name: 'copilot-chat-malformed-openai-compat-pin',
        },
    });
    try {
        const response = await request(server.httpServer)
            .post('/chat')
            .send({
            provider: 'copilot',
            model: 'copilot-gpt-5',
            conversationId: 'copilot-malformed-openai-compat',
            message: 'Do not swallow malformed pinned endpoints',
        })
            .expect(400);
        assert.equal(response.body.code, 'VALIDATION_FAILED');
        assert.match(String(response.body.message), /codeinfo_openai_endpoint: the endpoint path must end at \/v1/u);
        assert.equal(memoryConversations.get('copilot-malformed-openai-compat'), undefined);
        assert.equal(server.harness.getState().lastCreateSessionConfig, undefined);
    }
    finally {
        await server.stop();
        if (originalCopilotHome === undefined) {
            clearScopedTestEnvValue("CODEINFO_COPILOT_HOME");
        }
        else {
            setScopedTestEnvValue("CODEINFO_COPILOT_HOME", originalCopilotHome);
        }
        await tempHome.cleanup();
    }
});
