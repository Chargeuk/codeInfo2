import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { discoverAgents } from '../../agents/discovery.js';
import {
  resolveAgentHomeEnv,
  resolveAgentHomeForRepository,
} from '../../agents/roots.js';

let tmpDir: string;
let prevAgentHome: string | undefined;
let prevLegacyAgentHome: string | undefined;

const writeAgent = async (params: {
  rootDirName: 'codeinfo_agents' | 'codex_agents';
  agentName: string;
  withConfig?: boolean;
}) => {
  const agentHome = path.join(tmpDir, params.rootDirName, params.agentName);
  await fs.mkdir(agentHome, { recursive: true });
  if (params.withConfig !== false) {
    await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');
  }
  return agentHome;
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
  prevAgentHome = process.env.CODEINFO_AGENT_HOME;
  prevLegacyAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  process.env.CODEINFO_AGENT_HOME = path.join(tmpDir, 'codeinfo_agents');
  delete process.env.CODEINFO_CODEX_AGENT_HOME;
});

afterEach(async () => {
  if (prevAgentHome === undefined) {
    delete process.env.CODEINFO_AGENT_HOME;
  } else {
    process.env.CODEINFO_AGENT_HOME = prevAgentHome;
  }
  if (prevLegacyAgentHome === undefined) {
    delete process.env.CODEINFO_CODEX_AGENT_HOME;
  } else {
    process.env.CODEINFO_CODEX_AGENT_HOME = prevLegacyAgentHome;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('discovery includes folders with config.toml from codeinfo_agents', async () => {
  const agentHome = await writeAgent({
    rootDirName: 'codeinfo_agents',
    agentName: 'coding_agent',
  });

  const agents = await discoverAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'coding_agent');
  assert.equal(agents[0].home, agentHome);
  assert.equal(agents[0].configPath, path.join(agentHome, 'config.toml'));
});

test('discovery ignores folders without config.toml', async () => {
  await writeAgent({
    rootDirName: 'codeinfo_agents',
    agentName: 'invalid_agent',
    withConfig: false,
  });

  const agents = await discoverAgents();
  assert.equal(agents.length, 0);
});

test('discovery reads optional description.md when present', async () => {
  const agentHome = await writeAgent({
    rootDirName: 'codeinfo_agents',
    agentName: 'coding_agent',
  });
  await fs.writeFile(path.join(agentHome, 'description.md'), '# Hello agent');

  const agents = await discoverAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].description, '# Hello agent');
  assert.equal(
    agents[0].descriptionPath,
    path.join(agentHome, 'description.md'),
  );
});

test('discovery detects optional system_prompt.txt presence', async () => {
  const agentHome = await writeAgent({
    rootDirName: 'codeinfo_agents',
    agentName: 'coding_agent',
  });
  await fs.writeFile(
    path.join(agentHome, 'system_prompt.txt'),
    'You are a helpful agent.',
  );

  const agents = await discoverAgents();
  assert.equal(agents.length, 1);
  assert.equal(
    agents[0].systemPromptPath,
    path.join(agentHome, 'system_prompt.txt'),
  );
});

test('resolveAgentHomeEnv treats a blank CODEINFO_AGENT_HOME input as unset', () => {
  const resolution = resolveAgentHomeEnv({
    CODEINFO_AGENT_HOME: '',
    CODEINFO_CODEX_AGENT_HOME: path.join(tmpDir, 'codex_agents'),
  });

  assert.equal(resolution.activeEnvName, 'CODEINFO_CODEX_AGENT_HOME');
  assert.equal(resolution.activeAgentHome, path.join(tmpDir, 'codex_agents'));
});

test('resolveAgentHomeEnv treats a whitespace-only CODEINFO_AGENT_HOME input as unset', () => {
  const resolution = resolveAgentHomeEnv({
    CODEINFO_AGENT_HOME: '   ',
    CODEINFO_CODEX_AGENT_HOME: path.join(tmpDir, 'codex_agents'),
  });

  assert.equal(resolution.activeEnvName, 'CODEINFO_CODEX_AGENT_HOME');
  assert.equal(resolution.activeAgentHome, path.join(tmpDir, 'codex_agents'));
});

test('resolveAgentHomeEnv treats a blank CODEINFO_CODEX_AGENT_HOME input as unset', () => {
  const resolution = resolveAgentHomeEnv({
    CODEINFO_AGENT_HOME: path.join(tmpDir, 'codeinfo_agents'),
    CODEINFO_CODEX_AGENT_HOME: '',
  });

  assert.equal(resolution.activeEnvName, 'CODEINFO_AGENT_HOME');
  assert.equal(resolution.legacyAgentHome, path.join(tmpDir, 'codex_agents'));
});

test('resolveAgentHomeEnv treats a whitespace-only CODEINFO_CODEX_AGENT_HOME input as unset', () => {
  const resolution = resolveAgentHomeEnv({
    CODEINFO_AGENT_HOME: path.join(tmpDir, 'codeinfo_agents'),
    CODEINFO_CODEX_AGENT_HOME: '   ',
  });

  assert.equal(resolution.activeEnvName, 'CODEINFO_AGENT_HOME');
  assert.equal(resolution.legacyAgentHome, path.join(tmpDir, 'codex_agents'));
});

test('resolveAgentHomeEnv gives CODEINFO_AGENT_HOME precedence when both env vars are present', () => {
  const resolution = resolveAgentHomeEnv({
    CODEINFO_AGENT_HOME: path.join(tmpDir, 'codeinfo_agents'),
    CODEINFO_CODEX_AGENT_HOME: path.join(tmpDir, 'codex_agents'),
  });

  assert.equal(resolution.activeEnvName, 'CODEINFO_AGENT_HOME');
  assert.equal(
    resolution.activeAgentHome,
    path.join(tmpDir, 'codeinfo_agents'),
  );
});

test('resolveAgentHomeForRepository prefers codeinfo_agents over codex_agents', async () => {
  const preferredHome = await writeAgent({
    rootDirName: 'codeinfo_agents',
    agentName: 'planning_agent',
  });
  await writeAgent({
    rootDirName: 'codex_agents',
    agentName: 'planning_agent',
  });

  const resolved = await resolveAgentHomeForRepository({
    repositoryRoot: tmpDir,
    agentName: 'planning_agent',
  });

  assert.equal(resolved.home, preferredHome);
  assert.equal(resolved.rootKind, 'codeinfo_agents');
});

test('resolveAgentHomeForRepository emits duplicate-warning metadata and discovery surfaces it', async () => {
  const preferredHome = await writeAgent({
    rootDirName: 'codeinfo_agents',
    agentName: 'planning_agent',
  });
  await writeAgent({
    rootDirName: 'codex_agents',
    agentName: 'planning_agent',
  });

  const resolved = await resolveAgentHomeForRepository({
    repositoryRoot: tmpDir,
    agentName: 'planning_agent',
  });
  assert.equal(resolved.home, preferredHome);
  assert.equal(resolved.warnings.length, 1);
  assert.match(resolved.warnings[0] ?? '', /using codeinfo_agents/u);

  const agents = await discoverAgents();
  assert.equal(agents.length, 1);
  assert.deepEqual(agents[0].warnings, resolved.warnings);
});
