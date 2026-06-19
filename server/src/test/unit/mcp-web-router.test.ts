import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { ArchivedConversationError } from '../../mcp2/errors.js';
import { createMcpRouter } from '../../mcpCommon/routerFactory.js';
import { handleWebRpc } from '../../mcpWeb/router.js';
import {
  InvalidParamsError,
  ProviderUnavailableError,
  ToolExecutionError,
  ToolNotFoundError,
} from '../../mcpWeb/tools.js';
import { resetWebToolDeps, setWebToolDeps } from '../../mcpWeb/tools.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function postRaw(port: number, body: string) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return response.json();
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test('web MCP tools/list returns the dedicated web tool definitions', async () => {
  const server = http.createServer(handleWebRpc);
  const port = await listen(server);

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    assert.deepEqual(
      body.result.tools.map((entry: { name: string }) => entry.name).sort(),
      ['read_web_page', 'web_search'],
    );
  } finally {
    await close(server);
  }
});

test('web MCP tools/call returns JSON text content for web_search', async () => {
  setWebToolDeps({
    webSearchImpl: async () => ({
      query: 'latest ai news',
      provider: 'duck-duck-scrape',
      noResults: false,
      results: [
        {
          title: 'Example result',
          url: 'https://example.com/news',
          hostname: 'example.com',
          snippet: 'Example snippet',
        },
      ],
      diagnostics: {
        maxResults: 5,
        resultCount: 1,
        durationMs: 12,
      },
    }),
  });

  const server = http.createServer(handleWebRpc);
  const port = await listen(server);

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'web_search',
        arguments: {
          query: 'latest ai news',
        },
      },
    });

    const content = body.result.content[0];
    assert.equal(content.type, 'text');
    const parsed = JSON.parse(content.text as string);
    assert.equal(parsed.results[0].url, 'https://example.com/news');
  } finally {
    resetWebToolDeps();
    await close(server);
  }
});

test('web MCP tools/call returns -32601 for unknown tools', async () => {
  const server = http.createServer(handleWebRpc);
  const port = await listen(server);

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'not_a_real_tool',
        arguments: {},
      },
    });

    assert.deepEqual(body.error, {
      code: -32601,
      message: 'Tool not found: not_a_real_tool',
    });
  } finally {
    await close(server);
  }
});

test('web MCP tools reject unexpected extra properties in strict schemas', async () => {
  const server = http.createServer(handleWebRpc);
  const port = await listen(server);

  try {
    const webSearchBody = await postJson(port, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'web_search',
        arguments: {
          query: 'latest ai news',
          unexpected: true,
        },
      },
    });

    assert.equal(webSearchBody.error.code, -32602);
    assert.match(
      String(webSearchBody.error.message),
      /Invalid web_search arguments/u,
    );

    const readBody = await postJson(port, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'read_web_page',
        arguments: {
          url: 'https://example.com',
          unexpected: true,
        },
      },
    });

    assert.equal(readBody.error.code, -32602);
    assert.match(
      String(readBody.error.message),
      /Invalid read_web_page arguments/u,
    );
  } finally {
    await close(server);
  }
});

test('shared MCP router surfaces unexpected tool failures as internal errors', async () => {
  const failingRouter = createMcpRouter({
    surface: 'mcpWebTest',
    serverInfo: {
      name: 'codeinfo2-web-mcp-test',
      version: '0.0.0-test',
    },
    tools: {
      listTools: async () => ({ tools: [] }),
      callTool: async () => {
        throw new Error('boom');
      },
    },
    errors: {
      InvalidParamsError,
      ArchivedConversationError,
      ProviderUnavailableError,
      ToolExecutionError,
      ToolNotFoundError,
    },
  });
  const server = http.createServer(failingRouter);
  const port = await listen(server);

  try {
    const body = await postJson(port, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'web_search',
        arguments: {
          query: 'latest ai news',
        },
      },
    });

    assert.deepEqual(body.error, {
      code: -32603,
      message: 'Internal error',
    });
  } finally {
    await close(server);
  }
});

test('shared MCP router rejects oversized request bodies before dispatch', async () => {
  const server = http.createServer(handleWebRpc);
  const port = await listen(server);

  try {
    const oversizedPayload = JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      padding: 'x'.repeat(300_000),
    });
    const body = await postRaw(port, oversizedPayload);

    assert.deepEqual(body.error, {
      code: -32600,
      message: 'Request body too large',
    });
  } finally {
    await close(server);
  }
});
