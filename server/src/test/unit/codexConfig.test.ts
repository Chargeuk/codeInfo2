import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  applyResolvedServerPortToCodexConfig,
  buildCodexOptions,
  buildDefaultCodexConfig,
} from '../../config/codexConfig.js';

describe('codexConfig', () => {
  it('buildCodexOptions sets CODEX_HOME to the resolved override path', () => {
    const options = buildCodexOptions({ codexHome: '/tmp/x' });
    assert(options);
    assert.equal(options.env?.CODEX_HOME, path.resolve('/tmp/x'));
  });

  it('buildDefaultCodexConfig uses SERVER_PORT when it is provided', () => {
    const config = buildDefaultCodexConfig({
      SERVER_PORT: '5510',
      PORT: '5010',
    });
    assert.match(config, /http:\/\/localhost:5510\/mcp/);
  });

  it('buildDefaultCodexConfig falls back to PORT when SERVER_PORT is missing', () => {
    const config = buildDefaultCodexConfig({
      PORT: '5600',
    });
    assert.match(config, /http:\/\/localhost:5600\/mcp/);
  });

  it('applyResolvedServerPortToCodexConfig rewrites legacy hard-coded MCP urls', () => {
    const input = [
      'host = "http://localhost:5010/mcp"',
      'docker = "http://server:5010/mcp"',
    ].join('\n');
    const rewritten = applyResolvedServerPortToCodexConfig(input, {
      SERVER_PORT: '5710',
    });
    assert.match(rewritten, /http:\/\/localhost:5710\/mcp/);
    assert.match(rewritten, /http:\/\/server:5710\/mcp/);
  });
});
