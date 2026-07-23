import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReviewRetryOwnershipId,
  isSuccessfulTerminalReview,
  normalizeBaseUrl,
  parseTimerMs,
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

const flowStatus = (status, terminal, overrides = {}) => ({
  status,
  terminal,
  latestAssistantAt: null,
  subflowWaveProgress: null,
  ...overrides,
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

test('review runner does not bind a unique foreign review flow to the requested working folder', async () => {
  await assert.rejects(
    resolveReviewLaunch({
      baseUrl: 'http://server',
      workingFolder: '/host/repo-a',
      fetchImpl: async (url) => {
        if (url.endsWith('/tools/ingested-repos')) {
          return response(200, {
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
          });
        }
        return response(200, {
          flows: [
            {
              name: 'two_phase_review_cycle',
              sourceId: '/data/repo-b',
              disabled: false,
            },
          ],
        });
      },
    }),
    /Could not uniquely resolve the repository-backed two_phase_review_cycle sourceId/u,
  );
});

test('review runner waits through nonterminal status until terminal success', async () => {
  const calls = [];
  const statuses = [
    flowStatus('running', false),
    flowStatus('running', false, {
      subflowWaveProgress: { running: 2, completed: 0, updatedAt: 'later' },
    }),
    flowStatus('ok', true),
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

test('review runner rejects malformed successful status responses with an actionable diagnostic', async () => {
  await assert.rejects(
    waitForReviewCycle({
      baseUrl: 'http://server',
      workingFolder: '/repo',
      pollMs: 1,
      sleep: async () => {},
      fetchImpl: async (url) =>
        url.endsWith('/run')
          ? response(202, { conversationId: 'conversation-malformed' })
          : response(200, { terminal: false }),
    }),
    /Review status returned an invalid response shape; missing status, latestAssistantAt, subflowWaveProgress/u,
  );
  await assert.rejects(
    waitForReviewCycle({
      baseUrl: 'http://server',
      workingFolder: '/repo',
      pollMs: 1,
      sleep: async () => {},
      fetchImpl: async (url) =>
        url.endsWith('/run')
          ? response(202, { conversationId: 'conversation-missing-terminal' })
          : response(200, {
              status: 'running',
              latestAssistantAt: null,
              subflowWaveProgress: null,
            }),
    }),
    /Review status returned an invalid response shape; missing terminal/u,
  );
  await assert.rejects(
    waitForReviewCycle({
      baseUrl: 'http://server',
      workingFolder: '/repo',
      pollMs: 1,
      sleep: async () => {},
      fetchImpl: async (url) =>
        url.endsWith('/run')
          ? response(202, { conversationId: 'conversation-invalid-terminal' })
          : response(200, {
              status: 'running',
              terminal: 'false',
              latestAssistantAt: null,
              subflowWaveProgress: null,
            }),
    }),
    /terminal must be a boolean/u,
  );
});

test('review runner requires completed durable settlement before reporting success', () => {
  assert.equal(
    isSuccessfulTerminalReview({
      status: 'ok',
      terminal: true,
      reviewCycleStatus: 'completed',
    }),
    true,
  );
  assert.equal(
    isSuccessfulTerminalReview({
      status: 'ok',
      terminal: true,
      reviewCycleStatus: 'incomplete',
    }),
    false,
  );
  assert.equal(
    isSuccessfulTerminalReview({
      status: 'ok',
      terminal: true,
      terminalOutcome: 'not_applicable',
      reviewCycleStatus: 'incomplete',
    }),
    true,
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

test('separate wrapper launches receive distinct retry ownership identities', () => {
  const launch = { workingFolder: '/repo', sourceId: '/repo' };
  assert.notEqual(
    buildReviewRetryOwnershipId({ ...launch, launchNonce: 'first' }),
    buildReviewRetryOwnershipId({ ...launch, launchNonce: 'second' }),
  );
});

test('base URL defaults on blank input and rejects non-http protocols', () => {
  assert.equal(normalizeBaseUrl('  '), 'http://localhost:5010');
  assert.equal(
    normalizeBaseUrl('https://example.test/'),
    'https://example.test',
  );
  assert.throws(() => normalizeBaseUrl('file:///tmp/server'), /http or https/u);
});

test('timer arguments stay inside the integer setTimeout domain', () => {
  assert.equal(parseTimerMs('1', '--poll-ms'), 1);
  assert.equal(parseTimerMs('2147483647', '--poll-ms'), 2_147_483_647);
  for (const invalid of ['0', '1.5', '2147483648', 'NaN']) {
    assert.throws(
      () => parseTimerMs(invalid, '--poll-ms'),
      /must be an integer/u,
    );
  }
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
      return response(200, flowStatus('ok', true));
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
      return response(200, flowStatus('ok', true));
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
    flowStatus('orphaned', true, { resumeStepPath: [0, 2] }),
    flowStatus('ok', true),
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
    flowStatus('running', false),
    flowStatus('running', false),
    flowStatus('stopped', true),
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
