import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, mock } from 'node:test';

import {
  applyResolvedServerPortToCodexConfig,
  buildCodexOptions,
  buildDefaultCodexConfig,
} from '../../config/codexConfig.js';
import { getCodexDetection } from '../../providers/codexRegistry.js';
import { detectCodex } from '../../providers/codexDetection.js';

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

  it('reports shared-home availability as available when auth/config are present at startup', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const authPath = path.join(codexHome, 'auth.json');
    const configPath = path.join(codexHome, 'config.toml');
    const infoLogs: string[] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args.map(String).join(' '));
    });

    try {
      await fs.writeFile(authPath, '{"token":"shared"}', 'utf8');
      await fs.writeFile(configPath, 'model = "gpt-5.3-codex"\n', 'utf8');

      const detection = detectCodex({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });

      assert.equal(detection.available, true);
      assert.equal(detection.authPresent, true);
      assert.equal(detection.configPresent, true);
      assert.equal(getCodexDetection().available, true);
      assert(
        infoLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T08] event=shared_home_detection_completed result=success',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('reports shared-home availability as unavailable when auth is missing at startup', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const configPath = path.join(codexHome, 'config.toml');
    const errorLogs: string[] = [];
    mock.method(console, 'error', (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });

    try {
      await fs.writeFile(configPath, 'model = "gpt-5.3-codex"\n', 'utf8');

      const detection = detectCodex({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });

      assert.equal(detection.available, false);
      assert.equal(detection.authPresent, false);
      assert.equal(detection.configPresent, true);
      assert.match(detection.reason ?? '', /Missing auth\.json/u);
      assert.equal(getCodexDetection().available, false);
      assert(
        errorLogs.some((line) =>
          line.includes(
            '[DEV-0000037][T08] event=shared_home_detection_completed result=error',
          ),
        ),
      );
    } finally {
      mock.restoreAll();
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
