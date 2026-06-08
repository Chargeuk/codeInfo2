import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCopilotMcpServers } from '../../chat/copilotMcpConfig.js';

const toComparableJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as unknown;

test('buildCopilotMcpServers maps local and remote runtime MCP definitions into the Copilot SDK shape', () => {
  const result = buildCopilotMcpServers({
    mcp_servers: {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
        env: {
          CONTEXT7_API_KEY: 'ctx7-key',
        },
        cwd: '/tmp/context7',
      },
      code_info: {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
        tool_timeout_sec: 1800,
        tools: ['*'],
      },
      github: {
        url: 'https://api.githubcopilot.com/mcp/',
        http_headers: {
          Authorization: 'Bearer test-token',
        },
        type: 'http',
      },
      stream: {
        url: 'https://example.com/sse',
        type: 'sse',
        tools: [],
      },
    },
  });

  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(toComparableJson(result), {
    context7: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: {
        CONTEXT7_API_KEY: 'ctx7-key',
      },
      cwd: '/tmp/context7',
      tools: ['*'],
    },
    code_info: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-remote', 'http://localhost:5010/mcp'],
      tools: ['*'],
      timeout: 1_800_000,
    },
    github: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: {
        Authorization: 'Bearer test-token',
      },
      tools: ['*'],
    },
    stream: {
      type: 'sse',
      url: 'https://example.com/sse',
      tools: [],
    },
  });
});

test('buildCopilotMcpServers returns undefined when runtime config has no MCP servers', () => {
  assert.equal(buildCopilotMcpServers(undefined), undefined);
  assert.equal(buildCopilotMcpServers({}), undefined);
  assert.equal(buildCopilotMcpServers({ mcp_servers: undefined }), undefined);
});

test('buildCopilotMcpServers rejects malformed MCP definitions', () => {
  assert.throws(
    () =>
      buildCopilotMcpServers({
        mcp_servers: {
          broken: 'bad',
        },
      }),
    /copilot mcp server "broken" must be a table/u,
  );

  assert.throws(
    () =>
      buildCopilotMcpServers({
        mcp_servers: {
          broken: {
            command: 'npx',
            args: ['ok'],
            env: {
              DEBUG: true,
            },
          },
        },
      }),
    /field "env\.DEBUG" must be a string/u,
  );

  assert.throws(
    () =>
      buildCopilotMcpServers({
        mcp_servers: {
          broken: {
            url: 'https://example.com/mcp',
            type: 'local',
          },
        },
      }),
    /field "type" must be "http" or "sse"/u,
  );
});

test('buildCopilotMcpServers rejects reserved keys in MCP server maps', () => {
  const reservedServerMap = Object.create(null) as Record<string, unknown>;
  reservedServerMap['__proto__'] = {
    command: 'npx',
    args: ['-y', 'reserved-server'],
  };

  assert.throws(
    () =>
      buildCopilotMcpServers({
        mcp_servers: reservedServerMap,
      }),
    /uses a reserved key/u,
  );

  const reservedHeaders = Object.create(null) as Record<string, unknown>;
  reservedHeaders['__proto__'] = 'blocked';

  assert.throws(
    () =>
      buildCopilotMcpServers({
        mcp_servers: {
          broken: {
            url: 'https://example.com/mcp',
            http_headers: reservedHeaders,
          },
        },
      }),
    /field "http_headers\.__proto__" uses a reserved key/u,
  );

  const reservedEnv = Object.create(null) as Record<string, unknown>;
  reservedEnv['constructor'] = 'blocked';

  assert.throws(
    () =>
      buildCopilotMcpServers({
        mcp_servers: {
          broken: {
            command: 'npx',
            args: ['-y', 'reserved-env'],
            env: reservedEnv,
          },
        },
      }),
    /field "env\.constructor" uses a reserved key/u,
  );
});
