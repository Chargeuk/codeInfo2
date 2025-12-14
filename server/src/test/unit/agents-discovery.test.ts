import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { discoverAgents } from '../../agents/discovery.js';

let tmpDir: string;
let prevAgentsHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
  prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  process.env.CODEINFO_CODEX_AGENT_HOME = tmpDir;
});

afterEach(async () => {
  process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('discovery includes folders with config.toml', async () => {
  const agentHome = path.join(tmpDir, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');

  const agents = await discoverAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'coding_agent');
  assert.equal(agents[0].home, agentHome);
  assert.equal(agents[0].configPath, path.join(agentHome, 'config.toml'));
});

test('discovery ignores folders without config.toml', async () => {
  const agentHome = path.join(tmpDir, 'invalid_agent');
  await fs.mkdir(agentHome, { recursive: true });

  const agents = await discoverAgents();
  assert.equal(agents.length, 0);
});

test('discovery reads optional description.md when present', async () => {
  const agentHome = path.join(tmpDir, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');
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
  const agentHome = path.join(tmpDir, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');
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
