import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, mock } from 'node:test';

import {
  applyResolvedServerPortToCodexConfig,
  buildCodexOptions,
  buildDefaultCodexConfig,
  ensureCodexConfigSeeded,
} from '../../config/codexConfig.js';
import {
  detectCodex,
  refreshCodexDetection,
} from '../../providers/codexDetection.js';
import {
  getCodexDetection,
  setCodexDetection,
} from '../../providers/codexRegistry.js';

describe('codexConfig', () => {
  const TASK2_BOOTSTRAP_MARKER = 'DEV_0000047_T02_BASE_CONFIG_BOOTSTRAP';

  it('buildCodexOptions sets CODEX_HOME to the resolved override path', () => {
    const options = buildCodexOptions({ codexHome: '/tmp/x' });
    assert(options);
    assert.equal(options.env?.CODEX_HOME, path.resolve('/tmp/x'));
  });

  it('buildDefaultCodexConfig uses CODEINFO_SERVER_PORT when it is provided', () => {
    const config = buildDefaultCodexConfig({
      CODEINFO_SERVER_PORT: '5510',
      PORT: '5010',
    });
    assert.match(config, /http:\/\/localhost:5510\/mcp/);
  });

  it('buildDefaultCodexConfig falls back to PORT when CODEINFO_SERVER_PORT is missing', () => {
    const config = buildDefaultCodexConfig({
      PORT: '5600',
    });
    assert.match(config, /http:\/\/localhost:5600\/mcp/);
  });

  it('buildDefaultCodexConfig seeds the canonical base template without a Context7 api key pair', () => {
    const config = buildDefaultCodexConfig();

    assert.match(config, /model = "gpt-5\.3-codex"/u);
    assert.match(config, /args = \['-y', '@upstash\/context7-mcp'\]/u);
    assert.doesNotMatch(config, /ctx7sk-adf8774f-5b36-4181-bff4-e8f01b6e7866/u);
    assert.doesNotMatch(config, /--api-key/u);
  });

  it('applyResolvedServerPortToCodexConfig rewrites legacy hard-coded MCP urls', () => {
    const input = [
      'host = "http://localhost:5010/mcp"',
      'docker = "http://server:5010/mcp"',
    ].join('\n');
    const rewritten = applyResolvedServerPortToCodexConfig(input, {
      CODEINFO_SERVER_PORT: '5710',
    });
    assert.match(rewritten, /http:\/\/localhost:5710\/mcp/);
    assert.match(rewritten, /http:\/\/server:5710\/mcp/);
  });

  it('ensureCodexConfigSeeded writes the in-code template when config.toml is missing', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;
      const configPath = ensureCodexConfigSeeded();
      const seeded = await fs.readFile(configPath, 'utf8');

      assert.equal(configPath, path.join(codexHome, 'config.toml'));
      assert.match(seeded, /model = "gpt-5\.3-codex"/u);
      assert.match(seeded, /command = "npx"/u);
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded preserves server-port substitution in the in-code template', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const originalServerPort = process.env.CODEINFO_SERVER_PORT;
    const originalPort = process.env.PORT;

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;
      process.env.CODEINFO_SERVER_PORT = '5876';
      process.env.PORT = '5010';

      const configPath = ensureCodexConfigSeeded();
      const seeded = await fs.readFile(configPath, 'utf8');

      assert.match(seeded, /http:\/\/localhost:5876\/mcp/u);
      assert.doesNotMatch(seeded, /__SERVER_PORT__/u);
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      if (originalServerPort === undefined) {
        delete process.env.CODEINFO_SERVER_PORT;
      } else {
        process.env.CODEINFO_SERVER_PORT = originalServerPort;
      }
      if (originalPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = originalPort;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded leaves the seeded file unchanged on repeated calls', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;

      const configPath = ensureCodexConfigSeeded();
      const first = await fs.readFile(configPath, 'utf8');
      const secondPath = ensureCodexConfigSeeded();
      const second = await fs.readFile(configPath, 'utf8');

      assert.equal(secondPath, configPath);
      assert.equal(second, first);
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded never overwrites an existing config.toml', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const configPath = path.join(codexHome, 'config.toml');

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;
      await fs.writeFile(configPath, 'model = "user-kept"\n', 'utf8');

      const resolvedPath = ensureCodexConfigSeeded();
      const preserved = await fs.readFile(configPath, 'utf8');

      assert.equal(resolvedPath, configPath);
      assert.equal(preserved, 'model = "user-kept"\n');
    } finally {
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('ensureCodexConfigSeeded emits Story 47 bootstrap markers for seeded and existing paths', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const originalCodeinfoHome = process.env.CODEINFO_CODEX_HOME;
    const infoLogs: unknown[][] = [];
    mock.method(console, 'info', (...args: unknown[]) => {
      infoLogs.push(args);
    });

    try {
      process.env.CODEINFO_CODEX_HOME = codexHome;

      ensureCodexConfigSeeded();
      ensureCodexConfigSeeded();

      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | { outcome?: string; template_source?: string; success?: boolean }
            | undefined;
          return (
            String(entry[0]) === TASK2_BOOTSTRAP_MARKER &&
            payload?.outcome === 'seeded' &&
            payload.template_source === 'in_code' &&
            payload.success === true
          );
        }),
      );
      assert(
        infoLogs.some((entry) => {
          const payload = entry[1] as
            | { outcome?: string; template_source?: string; success?: boolean }
            | undefined;
          return (
            String(entry[0]) === TASK2_BOOTSTRAP_MARKER &&
            payload?.outcome === 'existing' &&
            payload.template_source === 'in_code' &&
            payload.success === true
          );
        }),
      );
    } finally {
      mock.restoreAll();
      if (originalCodeinfoHome === undefined) {
        delete process.env.CODEINFO_CODEX_HOME;
      } else {
        process.env.CODEINFO_CODEX_HOME = originalCodeinfoHome;
      }
      await fs.rm(codexHome, { recursive: true, force: true });
    }
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

  it('keeps codex registry fresh across direct-home detection failure and success refreshes', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const authPath = path.join(codexHome, 'auth.json');
    const configPath = path.join(codexHome, 'config.toml');
    setCodexDetection({
      available: true,
      authPresent: true,
      configPresent: true,
      reason: undefined,
    });

    try {
      await fs.writeFile(configPath, 'model = "gpt-5.3-codex"\n', 'utf8');

      const failed = refreshCodexDetection({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });
      assert.equal(failed.available, false);
      assert.equal(getCodexDetection().available, false);

      await fs.writeFile(authPath, '{"token":"seeded"}', 'utf8');
      const recovered = refreshCodexDetection({
        codexHome,
        resolveCliPath: () => '/usr/local/bin/codex',
      });
      assert.equal(recovered.available, true);
      assert.equal(getCodexDetection().available, true);
    } finally {
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });
});
