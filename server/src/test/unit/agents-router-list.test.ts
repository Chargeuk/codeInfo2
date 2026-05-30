import assert from 'node:assert/strict';
import { test } from 'node:test';

import express from 'express';
import request from 'supertest';

import type { AgentDetails, AgentSummary } from '../../agents/types.js';
import { createAgentsRouter } from '../../routes/agents.js';

function buildApp(overrides?: {
  listAgents?: () => Promise<{
    agents: AgentSummary[];
  }>;
  getAgentDetails?: (agentName: string) => Promise<AgentDetails>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createAgentsRouter({
      listAgents:
        overrides?.listAgents ??
        (async () => ({
          agents: [{ name: 'coding_agent' }],
        })),
      getAgentDetails:
        overrides?.getAgentDetails ??
        (async (agentName: string) => ({
          name: agentName,
          description: '# Hello agent',
          disabled: false,
          warnings: [],
          fallbackCandidates: [],
        })),
    }),
  );
  return app;
}

test('GET /agents returns discovered agents', async () => {
  const res = await request(buildApp()).get('/agents');

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body.agents), true);
  assert.equal(res.body.agents.length, 1);
  assert.equal(res.body.agents[0].name, 'coding_agent');
});

test('GET /agents includes description when provided by the list payload', async () => {
  const res = await request(
    buildApp({
      listAgents: async () => ({
        agents: [
          {
            name: 'coding_agent',
            description: '# Hello agent',
            requestedProviderId: 'codex',
            executionProviderId: 'copilot',
          },
        ],
      }),
    }),
  ).get('/agents');

  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 1);
  assert.equal(res.body.agents[0].description, '# Hello agent');
  assert.equal(res.body.agents[0].requestedProviderId, 'codex');
  assert.equal(res.body.agents[0].executionProviderId, 'copilot');
});

test('GET /agents keeps invalid-provider warnings off the list payload and exposes them on details only', async () => {
  const details: AgentDetails = {
    name: 'coding_agent',
    description: '# Hello agent',
    disabled: false,
    warnings: [
      {
        code: 'duplicate_root',
        message:
          'Agent "coding_agent" exists in both codeinfo_agents and codex_agents under "/repo"; using codeinfo_agents and ignoring the legacy codex_agents copy.',
        visibility: 'list',
      },
      {
        code: 'invalid_provider',
        message:
          'Agent config requested unsupported provider "not-a-provider".',
        visibility: 'details',
        providerId: 'not-a-provider',
      },
    ],
    fallbackCandidates: [
      {
        providerId: 'copilot',
        available: true,
      },
    ],
    requestedProviderId: 'not-a-provider',
    executionProviderId: 'copilot',
  };

  const app = buildApp({
    listAgents: async () => ({
      agents: [
        {
          name: 'coding_agent',
          description: '# Hello agent',
          disabled: false,
          warnings: [
            'Agent "coding_agent" exists in both codeinfo_agents and codex_agents under "/repo"; using codeinfo_agents and ignoring the legacy codex_agents copy.',
          ],
          requestedProviderId: 'not-a-provider',
          executionProviderId: 'copilot',
        },
      ],
    }),
    getAgentDetails: async () => details,
  });

  const listRes = await request(app).get('/agents');
  assert.equal(listRes.status, 200);
  assert.deepEqual(listRes.body.agents[0].warnings, [
    'Agent "coding_agent" exists in both codeinfo_agents and codex_agents under "/repo"; using codeinfo_agents and ignoring the legacy codex_agents copy.',
  ]);

  const detailsRes = await request(app).get('/agents/coding_agent');
  assert.equal(detailsRes.status, 200);
  assert.equal(Array.isArray(detailsRes.body.agent.warnings), true);
  assert.equal(
    detailsRes.body.agent.warnings.some(
      (warning: { code?: string }) => warning.code === 'invalid_provider',
    ),
    true,
  );
});
