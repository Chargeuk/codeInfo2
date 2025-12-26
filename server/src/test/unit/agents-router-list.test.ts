import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import express from 'express';
import request from 'supertest';
import { createAgentsRouter } from '../../routes/agents.js';

let tmpDir: string;
let prevAgentsHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-router-'));
  prevAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  process.env.CODEINFO_CODEX_AGENT_HOME = tmpDir;
});

afterEach(async () => {
  process.env.CODEINFO_CODEX_AGENT_HOME = prevAgentsHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createAgentsRouter());
  return app;
}

test('GET /agents returns discovered agents', async () => {
  const agentHome = path.join(tmpDir, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');

  const res = await request(buildApp()).get('/agents');

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body.agents), true);
  assert.equal(res.body.agents.length, 1);
  assert.equal(res.body.agents[0].name, 'coding_agent');
});

test('GET /agents includes description when description.md exists', async () => {
  const agentHome = path.join(tmpDir, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');
  await fs.writeFile(path.join(agentHome, 'description.md'), '# Hello agent');

  const res = await request(buildApp()).get('/agents');

  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 1);
  assert.equal(res.body.agents[0].description, '# Hello agent');
});

test('GET /agents succeeds when description.md is missing', async () => {
  const agentHome = path.join(tmpDir, 'coding_agent');
  await fs.mkdir(agentHome, { recursive: true });
  await fs.writeFile(path.join(agentHome, 'config.toml'), '# config');

  const res = await request(buildApp()).get('/agents');

  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 1);
  assert.equal('description' in res.body.agents[0], false);
});
