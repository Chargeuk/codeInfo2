import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { handleRpc } from '../../mcp2/router.js';
import { closeHttpServer, waitForHttpServerPort } from '../support/httpServer.js';
async function postJson(port: number, body: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return response.json();
}
test('tools/call with unknown tool name returns -32601 with ToolNotFoundError message', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'true');
    const server = http.createServer(handleRpc);
    server.listen(0);
    const port = await waitForHttpServerPort(server);
    try {
        const body = await postJson(port, {
            jsonrpc: '2.0',
            id: 11,
            method: 'tools/call',
            params: { name: 'nope', arguments: {} },
        });
        assert.equal(body.id, 11);
        assert.deepEqual(body.error, {
            code: -32601,
            message: 'Tool not found: nope',
        });
    }
    finally {
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        await closeHttpServer(server);
    }
});
test('unknown tool contract is unchanged even when Codex is unavailable', async () => {
    const original = process.env.MCP_FORCE_CODEX_AVAILABLE;
    setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", 'false');
    const server = http.createServer(handleRpc);
    server.listen(0);
    const port = await waitForHttpServerPort(server);
    try {
        const body = await postJson(port, {
            jsonrpc: '2.0',
            id: 12,
            method: 'tools/call',
            params: { name: 'still-nope', arguments: {} },
        });
        assert.equal(body.id, 12);
        assert.deepEqual(body.error, {
            code: -32601,
            message: 'Tool not found: still-nope',
        });
    }
    finally {
        setScopedTestEnvValue("MCP_FORCE_CODEX_AVAILABLE", original);
        await closeHttpServer(server);
    }
});
