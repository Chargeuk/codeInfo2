import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readAgentRequestedProviderMetadata } from '../../agents/config.js';
import { discoverAgents } from '../../agents/discovery.js';
import { readAndNormalizeRuntimeTomlConfig } from '../../config/runtimeConfig.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);
const catalogs = ['codeinfo_agents', 'manual_testing/codeinfo_agents'];
const read = (relativePath: string) =>
  fs.readFile(path.join(repoRoot, relativePath), 'utf8');
const readConfig = (relativePath: string) =>
  readAndNormalizeRuntimeTomlConfig(path.join(repoRoot, relativePath), {
    required: true,
  });

for (const catalog of catalogs) {
  test(`${catalog} discovers chat_search_agent with its description and prompt without seeding auth`, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-catalog-'));
    const catalogPath = path.join(repoRoot, catalog);
    const agentHome = path.join(catalogPath, 'chat_search_agent');

    try {
      await runWithTestEnvOverrides(
        {
          CODEINFO_AGENT_HOME: catalogPath,
          CODEINFO_CODEX_AGENT_HOME: path.join(tempRoot, 'unused-agents'),
          CODEX_HOME: path.join(tempRoot, 'codex-home'),
          CODEINFO_CODEX_HOME: path.join(tempRoot, 'codex-home'),
        },
        async () => {
          const agents = await discoverAgents({ seedAuth: false });
          const matches = agents.filter(
            (agent) => agent.name === 'chat_search_agent',
          );
          assert.equal(matches.length, 1);
          const agent = matches[0];
          assert.equal(agent.home, agentHome);
          assert.equal(agent.configPath, path.join(agentHome, 'config.toml'));
          assert.equal(
            agent.descriptionPath,
            path.join(agentHome, 'description.md'),
          );
          assert.equal(
            agent.description,
            await read(`${catalog}/chat_search_agent/description.md`),
          );
          assert.ok(agent.description?.trim());
          assert.equal(
            agent.systemPromptPath,
            path.join(agentHome, 'system_prompt.txt'),
          );
          assert.ok(
            (
              await read(`${catalog}/chat_search_agent/system_prompt.txt`)
            ).trim(),
          );
          assert.deepEqual(await fs.readdir(tempRoot), []);
        },
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test(`${catalog} chat search config validates and retains lite research model and documentation tools`, async () => {
    const relativePath = `${catalog}/chat_search_agent/config.toml`;
    const config = await readConfig(relativePath);
    const lite = await readConfig(
      'codeinfo_agents/research_agent_lite/config.toml',
    );
    assert.ok(config);
    assert.ok(lite);
    const metadata = await readAgentRequestedProviderMetadata({
      configPath: path.join(repoRoot, relativePath),
    });
    assert.equal(metadata.providerId, 'codex');
    assert.equal(metadata.requestedProviderId, 'codex');
    assert.deepEqual(metadata.warnings, []);
    assert.equal(config.model, lite.model);
    assert.equal(config.model_reasoning_effort, lite.model_reasoning_effort);
    assert.equal(config.web_search, 'live');

    // Inspect only the new agent's own declaration; inheritance is caller-owned.
    const servers = config.mcp_servers as Record<string, unknown>;
    const liteServers = lite.mcp_servers as Record<string, unknown>;
    assert.ok(servers);
    assert.ok(liteServers);
    assert.equal(servers.code_info, undefined);
    assert.equal(servers.codeinfo_agents, undefined);
    for (const name of ['context7', 'mui', 'deepwiki']) {
      assert.ok(servers[name], name);
      assert.deepEqual(servers[name], liteServers[name], name);
    }
  });
}

// These are static catalog policy contracts, not proof of model behavior.
test('both chat search prompts declare the same bounded read-only leaf policy', async () => {
  const prompts = await Promise.all(
    catalogs.map((catalog) =>
      read(`${catalog}/chat_search_agent/system_prompt.txt`),
    ),
  );
  assert.equal(prompts[0], prompts[1]);
  const prompt = prompts[0];
  for (const required of [
    /Never use ANY code_info tools\b[^.]*codebase_question/u,
    /never call those services indirectly/u,
    /Never spawn or delegate\b[^.]*other agents/u,
    /Never edit files\b[^.]*run tests\/builds\/typechecks\/lint\/formatting/u,
    /Bounded read-only shell\b[^.]*allowed/u,
    /Never start servers\b[^.]*background jobs[^.]*interfering processes/u,
    /Do not perform vector searches/u,
    /at most 4 evidence tool calls TOTAL/u,
    /Context7 resolve and query[^.;]*separate calls/u,
    /each underlying call counts[^.]*batched/u,
    /at most 200 lines per read/u,
    /cumulative shell output at 10000 characters/u,
    /at most 50 AST symbols/u,
    /at most 4000 characters/u,
  ]) {
    assert.match(prompt, required);
  }
});

test('planning and booklet callers explicitly declare the canonical CodeInfo delegation endpoint', async () => {
  const coding = await readConfig('codeinfo_agents/coding_agent/config.toml');
  assert.ok(coding);
  const canonical = (coding.mcp_servers as Record<string, unknown>)
    .codeinfo_agents;
  assert.deepEqual(canonical, {
    command: 'npx',
    args: [
      '-y',
      'mcp-remote',
      'http://localhost:${CODEINFO_AGENTS_MCP_PORT}/mcp',
      '--allow-http',
    ],
    startup_timeout_sec: 60,
    tool_timeout_sec: 86400,
  });

  for (const relativePath of [
    'codeinfo_agents/booklet_generation_agent/config.toml',
    'codeinfo_agents/planning_agent/config.toml',
    'codeinfo_agents/planning_agent_lite/config.toml',
    'manual_testing/codeinfo_agents/planning_agent/config.toml',
    'manual_testing/codeinfo_agents/planning_agent_lite/config.toml',
  ]) {
    const config = await readConfig(relativePath);
    assert.ok(config, relativePath);
    const servers = config.mcp_servers as Record<string, unknown>;
    assert.equal(servers.agents, undefined, relativePath);
    assert.deepEqual(servers.codeinfo_agents, canonical, relativePath);
  }
});

test('callers preserve parent-authorized depth and the narrow coder-to-tester exception', async () => {
  for (const relativePath of [
    'codeinfo_agents/research_agent/system_prompt.txt',
    'codeinfo_agents/research_agent_lite/system_prompt.txt',
    'codeinfo_agents/research_agent_max/system_prompt.txt',
    'manual_testing/codeinfo_agents/research_agent/system_prompt.txt',
    'manual_testing/codeinfo_agents/research_agent_max/system_prompt.txt',
    'codeinfo_agents/planning_agent/system_prompt.txt',
    'codeinfo_agents/planning_agent_lite/system_prompt.txt',
    'codeinfo_agents/lmstudio_agent/system_prompt.txt',
    'codeinfo_agents/vllm_agent/system_prompt.txt',
  ]) {
    const prompt = await read(relativePath);
    for (const required of [
      /Default to leaf workers/u,
      /parent may explicitly permit[^.;]*deeper delegation[^.;]*role and assignment permissions/u,
      /coding_agent[^.]*coder-owned verification/u,
      /ONLY automated_testing_agent[^.;]*required checks/u,
      /tester must remain a leaf/u,
      /exception never overrides an explicit caller ban/u,
      /implementation-only[^.]*parent invokes the tester[^.]*coder a leaf/u,
      /Unless deeper delegation is explicitly permitted[^.]*Do not spawn or delegate/u,
    ]) {
      assert.match(prompt, required, relativePath);
    }
  }
});
