import assert from 'node:assert/strict';
import http from 'node:http';
import test, { afterEach } from 'node:test';
import express from 'express';
import { resetMcpStatusCache, getMcpStatus, } from '../../providers/mcpStatus.js';
const originalServerPort = process.env.CODEINFO_SERVER_PORT;
const originalMcpUrl = process.env.MCP_URL;
afterEach(() => {
    resetMcpStatusCache();
    if (originalServerPort === undefined) {
        clearScopedTestEnvValue("CODEINFO_SERVER_PORT");
    }
    else {
        setScopedTestEnvValue("CODEINFO_SERVER_PORT", originalServerPort);
    }
    if (originalMcpUrl === undefined) {
        clearScopedTestEnvValue("MCP_URL");
    }
    else {
        setScopedTestEnvValue("MCP_URL", originalMcpUrl);
    }
});
async function startMcpServer() {
    const app = express();
    app.use(express.json());
    app.post('/mcp', (_req, res) => {
        res.json({ result: { ok: true } });
    });
    const httpServer = http.createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    assert(address && typeof address === 'object');
    return {
        httpServer,
        port: address.port,
    };
}
async function stopServer(server: {
    httpServer: http.Server;
}) {
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}
test('provider status probing uses the shared normalized classic MCP endpoint instead of MCP_URL', async () => {
    const server = await startMcpServer();
    setScopedTestEnvValue("CODEINFO_SERVER_PORT", String(server.port));
    setScopedTestEnvValue("MCP_URL", 'http://127.0.0.1:9/legacy-bypass');
    try {
        const status = await getMcpStatus();
        assert.deepEqual(status, { available: true });
    }
    finally {
        await stopServer(server);
    }
});
test('provider status probing fails clearly when the normalized MCP endpoint is unresolved', async () => {
    setScopedTestEnvValue("CODEINFO_SERVER_PORT", '${CODEINFO_SERVER_PORT}');
    clearScopedTestEnvValue("MCP_URL");
    const status = await getMcpStatus();
    assert.equal(status.available, false);
    assert.match(status.reason ?? '', /CODEINFO_SERVER_PORT must be a TCP port integer between 1 and 65535/u);
});
test('provider status probing fails clearly when the normalized MCP endpoint is unreachable', async () => {
    setScopedTestEnvValue("CODEINFO_SERVER_PORT", '9');
    clearScopedTestEnvValue("MCP_URL");
    const status = await getMcpStatus();
    assert.equal(status.available, false);
    assert.match(status.reason ?? '', /(fetch failed|ECONNREFUSED|bad port)/iu);
});
