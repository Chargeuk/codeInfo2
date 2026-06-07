import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCopilotMcpServers } from '../../chat/copilotMcpConfig.js';

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

  assert.deepEqual(result, {
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
