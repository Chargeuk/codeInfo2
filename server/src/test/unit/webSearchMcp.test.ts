import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyManagedWebToolsToRuntimeConfig,
  applyManagedWebToolsToRuntimeConfigForMode,
  resolveConfiguredWebSearchMode,
  shouldInjectManagedWebTools,
} from '../../config/webSearchMcp.js';

describe('webSearchMcp runtime helpers', () => {
  it('resolves canonical and legacy web search modes from config', () => {
    assert.equal(
      resolveConfiguredWebSearchMode({ web_search: 'live' }),
      'live',
    );
    assert.equal(
      resolveConfiguredWebSearchMode({ web_search_mode: 'cached' }),
      'cached',
    );
    assert.equal(
      resolveConfiguredWebSearchMode({
        features: { web_search_request: false },
      }),
      'disabled',
    );
    assert.equal(
      resolveConfiguredWebSearchMode({ web_search_request: true }),
      'live',
    );
    assert.equal(
      resolveConfiguredWebSearchMode({ web_search_request: false }),
      'disabled',
    );
  });

  it('injects managed web_tools for copilot live search and strips them when disabled', () => {
    const injected = applyManagedWebToolsToRuntimeConfig({
      config: {
        web_search: 'live',
        mcp_servers: {
          code_info: { url: 'http://localhost:5010/mcp' },
        },
      },
      provider: 'copilot',
      env: { CODEINFO_WEB_MCP_PORT: '6513' } as NodeJS.ProcessEnv,
    });

    assert.deepEqual(
      (injected.mcp_servers as Record<string, unknown>).web_tools,
      {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:6513/mcp'],
        startup_timeout_sec: 60,
      },
    );

    const stripped = applyManagedWebToolsToRuntimeConfig({
      config: {
        web_search: 'disabled',
        mcp_servers: {
          code_info: { url: 'http://localhost:5010/mcp' },
          web_tools: { url: 'http://localhost:9999/mcp' },
        },
      },
      provider: 'copilot',
      env: { CODEINFO_WEB_MCP_PORT: '6513' } as NodeJS.ProcessEnv,
    });

    assert.equal(
      (stripped.mcp_servers as Record<string, unknown>).web_tools,
      undefined,
    );
  });

  it('only injects managed web_tools for codex when execution uses an OpenAI-compatible endpoint', () => {
    assert.equal(
      shouldInjectManagedWebTools({
        provider: 'codex',
        webSearchMode: 'live',
        usesOpenAiCompatEndpoint: false,
      }),
      false,
    );
    assert.equal(
      shouldInjectManagedWebTools({
        provider: 'codex',
        webSearchMode: 'live',
        usesOpenAiCompatEndpoint: true,
      }),
      true,
    );
    assert.equal(
      shouldInjectManagedWebTools({
        provider: 'lmstudio',
        webSearchMode: 'live',
      }),
      false,
    );
  });

  it('can reapply managed web_tools using an explicit effective mode', () => {
    const stripped = applyManagedWebToolsToRuntimeConfigForMode({
      config: {
        web_search: 'live',
        mcp_servers: {
          code_info: { url: 'http://localhost:5010/mcp' },
          web_tools: { url: 'http://localhost:9999/mcp' },
        },
      },
      provider: 'codex',
      webSearchMode: 'disabled',
      usesOpenAiCompatEndpoint: true,
      env: { CODEINFO_WEB_MCP_PORT: '6513' } as NodeJS.ProcessEnv,
    });

    assert.equal(
      (stripped.mcp_servers as Record<string, unknown>).web_tools,
      undefined,
    );

    const reinjected = applyManagedWebToolsToRuntimeConfigForMode({
      config: {
        mcp_servers: {
          code_info: { url: 'http://localhost:5010/mcp' },
        },
      },
      provider: 'codex',
      webSearchMode: 'live',
      usesOpenAiCompatEndpoint: true,
      env: { CODEINFO_WEB_MCP_PORT: '6513' } as NodeJS.ProcessEnv,
    });

    assert.deepEqual(
      (reinjected.mcp_servers as Record<string, unknown>).web_tools,
      {
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://localhost:6513/mcp'],
        startup_timeout_sec: 60,
      },
    );
  });
});
