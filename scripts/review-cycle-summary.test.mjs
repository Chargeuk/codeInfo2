import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReviewRetryOwnershipId,
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

test('review runner rejects a source id belonging to a different repository', async () => {
  await assert.rejects(
    resolveReviewLaunch({
      baseUrl: 'http://server',
      workingFolder: '/host/repo-a',
      sourceId: '/data/repo-b',
      fetchImpl: async () =>
        response(200, {
          repos: [
            {
              id: '/data/repo-a',
              containerPath: '/data/repo-a',
              hostPath: '/host/repo-a',
            },
            {
              id: '/data/repo-b',
              containerPath: '/data/repo-b',
              hostPath: '/host/repo-b',
            },
          ],
        }),
    }),
    /identify different ingested repositories/u,
  );
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

test('review runner gives equivalent launches the same retry ownership', () => {
  const launch = {
    workingFolder: '/repo',
    sourceId: '/repo',
    customTitle: 'Review story',
  };

  assert.equal(
    buildReviewRetryOwnershipId(launch),
    buildReviewRetryOwnershipId({ ...launch }),
  );
  assert.notEqual(
    buildReviewRetryOwnershipId(launch),
    buildReviewRetryOwnershipId({ ...launch, workingFolder: '/other' }),
  );
  assert.notEqual(
    buildReviewRetryOwnershipId(launch),
    buildReviewRetryOwnershipId({
      ...launch,
      flowName: 'diagnostic_review_cycle',
    }),
  );
});

test('diagnostic review uses its isolated flow endpoint', async () => {
  const calls = [];
  await waitForReviewCycle({
    baseUrl: 'http://server',
    workingFolder: '/repo',
    flowName: 'diagnostic_review_cycle',
    pollMs: 1,
    sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET' });
      if (url.endsWith('/run')) {
        return response(202, { conversationId: 'diagnostic-1' });
      }
      return response(200, { status: 'ok', terminal: true });
    },
  });
  assert.equal(
    calls[0]?.url,
    'http://server/flows/diagnostic_review_cycle/run',
  );
});

test('review runner attaches to an accepted conversation without starting a copy', async () => {
  const calls = [];
  const result = await waitForReviewCycle({
    baseUrl: 'http://server',
    conversationId: 'conversation-existing',
    pollMs: 1,
    sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET' });
      return response(200, { status: 'ok', terminal: true });
    },
  });

  assert.equal(result.conversationId, 'conversation-existing');
  assert.deepEqual(calls, [
    {
      url: 'http://server/flows/runs/conversation-existing',
      method: 'GET',
    },
  ]);
});

test('review runner resumes an orphan only when explicitly requested', async () => {
  const calls = [];
  const statuses = [
    {
      status: 'orphaned',
      terminal: true,
      resumeStepPath: [0, 2],
    },
    { status: 'ok', terminal: true },
  ];
  const result = await waitForReviewCycle({
    baseUrl: 'http://server',
    workingFolder: '/repo',
    sourceId: '/repo',
    conversationId: 'conversation-orphaned',
    resumeOrphaned: true,
    pollMs: 1,
    sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url,
        method: options.method ?? 'GET',
        body: options.body ? JSON.parse(options.body) : undefined,
      });
      if (url.endsWith('/run')) {
        return response(202, { conversationId: 'conversation-orphaned' });
      }
      return response(200, statuses.shift());
    },
  });

  assert.equal(result.status.status, 'ok');
  assert.equal(calls.filter((call) => call.url.endsWith('/run')).length, 1);
  assert.deepEqual(calls.find((call) => call.url.endsWith('/run'))?.body, {
    conversationId: 'conversation-orphaned',
    resumeStepPath: [0, 2],
    working_folder: '/repo',
    sourceId: '/repo',
  });
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
