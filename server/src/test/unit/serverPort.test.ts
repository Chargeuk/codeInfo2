import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveCodeinfoAgentsMcpPort,
  resolveCodeinfoChatMcpPort,
} from '../../config/mcpEndpoints.js';
import {
  DEFAULT_SERVER_PORT,
  assertValidPortString,
  resolveServerPort,
} from '../../config/serverPort.js';

describe('resolveServerPort', () => {
  it('uses CODEINFO_SERVER_PORT when it is provided', () => {
    const port = resolveServerPort({
      CODEINFO_SERVER_PORT: '5510',
      PORT: '5010',
    } as NodeJS.ProcessEnv);
    assert.equal(port, '5510');
  });

  it('falls back to PORT when CODEINFO_SERVER_PORT is not provided', () => {
    const port = resolveServerPort({
      PORT: '5010',
    } as NodeJS.ProcessEnv);
    assert.equal(port, '5010');
  });

  it('falls back to default when neither is set', () => {
    const port = resolveServerPort({} as NodeJS.ProcessEnv);
    assert.equal(port, DEFAULT_SERVER_PORT);
  });

  it('ignores blank values', () => {
    const port = resolveServerPort({
      CODEINFO_SERVER_PORT: '   ',
      PORT: '  ',
    } as NodeJS.ProcessEnv);
    assert.equal(port, DEFAULT_SERVER_PORT);
  });

  it('rejects malformed numeric domains early', () => {
    assert.throws(
      () =>
        resolveServerPort({
          CODEINFO_SERVER_PORT: 'not-a-port',
        } as NodeJS.ProcessEnv),
      /CODEINFO_SERVER_PORT must be a TCP port integer between 1 and 65535/u,
    );
    assert.throws(
      () =>
        resolveServerPort({
          CODEINFO_SERVER_PORT: '-1',
        } as NodeJS.ProcessEnv),
      /CODEINFO_SERVER_PORT must be a TCP port integer between 1 and 65535/u,
    );
    assert.throws(
      () =>
        resolveServerPort({
          CODEINFO_SERVER_PORT: '65536',
        } as NodeJS.ProcessEnv),
      /CODEINFO_SERVER_PORT must be a TCP port integer between 1 and 65535/u,
    );
  });
});

describe('MCP port resolvers', () => {
  it('rejects malformed chat and agents MCP ports before URL construction', () => {
    assert.throws(
      () =>
        resolveCodeinfoChatMcpPort({
          CODEINFO_CHAT_MCP_PORT: 'abc',
        } as NodeJS.ProcessEnv),
      /CODEINFO_CHAT_MCP_PORT must be a TCP port integer between 1 and 65535/u,
    );
    assert.throws(
      () =>
        resolveCodeinfoAgentsMcpPort({
          CODEINFO_AGENTS_MCP_PORT: '70000',
        } as NodeJS.ProcessEnv),
      /CODEINFO_AGENTS_MCP_PORT must be a TCP port integer between 1 and 65535/u,
    );
  });

  it('normalizes valid port strings', () => {
    assert.equal(assertValidPortString('PORT', '05010'), '5010');
    assert.equal(
      resolveCodeinfoChatMcpPort({
        CODEINFO_CHAT_MCP_PORT: '05011',
      } as NodeJS.ProcessEnv),
      '5011',
    );
    assert.equal(
      resolveCodeinfoAgentsMcpPort({
        CODEINFO_AGENTS_MCP_PORT: '05012',
      } as NodeJS.ProcessEnv),
      '5012',
    );
  });
});
