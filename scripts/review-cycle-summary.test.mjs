import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveReviewLaunch,
  waitForReviewCycle,
} from './review-cycle-summary.mjs';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return body;
  },
});

test('review runner resolves a host working folder to its server repository identity', async () => {
  const calls = [];
  const result = await resolveReviewLaunch({
    baseUrl: 'http://server',
    workingFolder: '/host/repo',
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/tools/ingested-repos')) {
        return response(200, {
          repos: [
            {
              id: '/data/repo',
              containerPath: '/data/repo',
              hostPath: '/host/repo',
            },
          ],
        });
      }
      return response(200, {
        flows: [
          {
            name: 'two_phase_review_cycle',
            sourceId: '/data/repo',
            disabled: false,
          },
        ],
      });
    },
  });

  assert.deepEqual(result, {
    workingFolder: '/data/repo',
    sourceId: '/data/repo',
  });
  assert.equal(calls.length, 2);
});

test('review runner waits through nonterminal status until terminal success', async () => {
  const calls = [];
  const statuses = [
    { status: 'running', terminal: false, subflowWaveProgress: null },
    {
      status: 'running',
      terminal: false,
      subflowWaveProgress: { running: 2, completed: 0, updatedAt: 'later' },
    },
    { status: 'ok', terminal: true, subflowWaveProgress: null },
  ];
  const result = await waitForReviewCycle({
    baseUrl: 'http://server',
    workingFolder: '/repo',
    pollMs: 1,
    sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET' });
      if (url.endsWith('/run')) {
        return response(202, { conversationId: 'conversation-1' });
      }
      return response(200, statuses.shift());
    },
  });

  assert.equal(result.status.status, 'ok');
  assert.equal(calls.filter((call) => call.method === 'GET').length, 3);
  assert.equal(
    calls.some((call) => call.url.endsWith('/stop')),
    false,
  );
});

test('review runner requests cancellation only after an explicit stall threshold', async () => {
  const calls = [];
  let now = 0;
  const statuses = [
    { status: 'running', terminal: false, subflowWaveProgress: null },
    { status: 'running', terminal: false, subflowWaveProgress: null },
    { status: 'stopped', terminal: true, subflowWaveProgress: null },
  ];
  const result = await waitForReviewCycle({
    baseUrl: 'http://server',
    workingFolder: '/repo',
    pollMs: 5,
    cancelAfterNoProgressMs: 10,
    now: () => now,
    sleep: async () => {
      now += 10;
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET' });
      if (url.endsWith('/run')) {
        return response(202, { conversationId: 'conversation-2' });
      }
      if (url.endsWith('/stop')) {
        return response(202, { status: 'stopping' });
      }
      return response(200, statuses.shift());
    },
  });

  assert.equal(result.status.status, 'stopped');
  assert.equal(calls.filter((call) => call.url.endsWith('/stop')).length, 1);
});
