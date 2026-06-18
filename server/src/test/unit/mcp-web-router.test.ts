import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { handleWebRpc } from '../../mcpWeb/router.js';
import { resetWebToolDeps, setWebToolDeps } from '../../mcpWeb/tools.js';

async function postJson(port: number, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
