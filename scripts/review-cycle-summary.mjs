import { pathToFileURL } from 'node:url';

import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';
import { writeLogLine } from './summary-wrapper-protocol.mjs';

const DEFAULT_BASE_URL = 'http://localhost:5010';
const DEFAULT_POLL_MS = 5_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveNumber = (value, name) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
};

const readJsonResponse = async (response, label) => {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body.message === 'string'
        ? body.message
        : `${label} returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
};

const progressFingerprint = (status) =>
  JSON.stringify({
    status: status.status,
    latestAssistantAt: status.latestAssistantAt,
    subflowWaveProgress: status.subflowWaveProgress,
  });

export const resolveReviewLaunch = async ({
  baseUrl,
  workingFolder,
  sourceId,
  fetchImpl = fetch,
}) => {
  const reposResponse = await fetchImpl(`${baseUrl}/tools/ingested-repos`);
  const reposBody = await readJsonResponse(
    reposResponse,
    'Ingested repository lookup',
  );
  const repos = Array.isArray(reposBody?.repos) ? reposBody.repos : [];
  const matchingRepo = repos.find(
    (repo) =>
      repo &&
      (repo.hostPath === workingFolder ||
        repo.containerPath === workingFolder ||
        repo.id === workingFolder),
  );
  if (!matchingRepo || typeof matchingRepo.containerPath !== 'string') {
    throw new Error(
      `Working folder is not an ingested repository root: ${workingFolder}`,
    );
  }

  if (sourceId) {
    return {
      workingFolder: matchingRepo.containerPath,
      sourceId,
    };
  }

  const flowsResponse = await fetchImpl(`${baseUrl}/flows`);
  const flowsBody = await readJsonResponse(flowsResponse, 'Flow catalog lookup');
  const flows = Array.isArray(flowsBody?.flows) ? flowsBody.flows : [];
  const candidates = flows.filter(
    (flow) =>
      flow?.name === 'two_phase_review_cycle' &&
      flow.disabled !== true &&
      typeof flow.sourceId === 'string',
  );
  const matchingFlow = candidates.find(
    (flow) => flow.sourceId === matchingRepo.containerPath,
  );
  const uniqueSourceIds = [...new Set(candidates.map((flow) => flow.sourceId))];
  const resolvedSourceId =
    matchingFlow?.sourceId ??
    (uniqueSourceIds.length === 1 ? uniqueSourceIds[0] : undefined);
  if (!resolvedSourceId) {
    throw new Error(
      'Could not uniquely resolve the repository-backed two_phase_review_cycle sourceId.',
    );
  }

  return {
    workingFolder: matchingRepo.containerPath,
    sourceId: resolvedSourceId,
  };
};

export const waitForReviewCycle = async ({
  baseUrl,
  workingFolder,
  sourceId,
  customTitle,
  pollMs = DEFAULT_POLL_MS,
  cancelAfterNoProgressMs = null,
  fetchImpl = fetch,
  sleep = delay,
  now = Date.now,
  onStatus = () => {},
}) => {
  const startResponse = await fetchImpl(
    `${baseUrl}/flows/two_phase_review_cycle/run`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        working_folder: workingFolder,
        ...(sourceId ? { sourceId } : {}),
        ...(customTitle ? { customTitle } : {}),
      }),
    },
  );
  const started = await readJsonResponse(startResponse, 'Review start');
  if (!started || typeof started.conversationId !== 'string') {
    throw new Error('Review start did not return a conversationId.');
  }

  const conversationId = started.conversationId;
  let lastFingerprint = '';
  let lastProgressAt = now();
  let stopRequested = false;

  while (true) {
    const response = await fetchImpl(
      `${baseUrl}/flows/runs/${encodeURIComponent(conversationId)}`,
    );
    const status = await readJsonResponse(response, 'Review status');
    onStatus({ conversationId, status, stopRequested });

    const fingerprint = progressFingerprint(status);
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      lastProgressAt = now();
    }

    if (status.terminal) {
      return { conversationId, status };
    }

    if (
      cancelAfterNoProgressMs !== null &&
      !stopRequested &&
      now() - lastProgressAt >= cancelAfterNoProgressMs
    ) {
      const stopResponse = await fetchImpl(
        `${baseUrl}/flows/runs/${encodeURIComponent(conversationId)}/stop`,
        { method: 'POST' },
      );
      await readJsonResponse(stopResponse, 'Review stop');
      stopRequested = true;
    }

    await sleep(pollMs);
  }
};

const main = async () => {
  const run = createSummaryWrapperRun({
    wrapperName: 'review-cycle-summary',
    logBaseName: 'review-cycle',
    description:
      'Start one two-phase review cycle and wait for its terminal server-owned state.',
    allowedFlags: [
      {
        name: 'working-folder',
        alias: 'w',
        type: 'string',
        description: 'Repository working folder passed to the flow.',
      },
      {
        name: 'base-url',
        type: 'string',
        description: `Server base URL (default ${DEFAULT_BASE_URL}).`,
      },
      {
        name: 'source-id',
        type: 'string',
        description: 'Optional ingested repository source id.',
      },
      {
        name: 'custom-title',
        type: 'string',
        description: 'Optional flow conversation title.',
      },
      {
        name: 'poll-ms',
        type: 'string',
        description: `Status poll interval (default ${DEFAULT_POLL_MS}).`,
      },
      {
        name: 'cancel-after-no-progress-ms',
        type: 'string',
        description:
          'Optional explicit stall threshold. Omit to wait without a time limit.',
      },
      {
        name: 'help',
        alias: 'h',
        type: 'boolean',
        description: 'Show this help text.',
      },
    ],
  });
  const parsed = run.parseArgs(process.argv.slice(2));
  if (parsed.error) return run.failCli(parsed.error);
  if (parsed.helpRequested) {
    process.stdout.write(run.renderHelp());
    await run.closeLog({ promoteLatest: false });
    return 0;
  }
  const values = parsed.values;
  if (!values['working-folder']) {
    return run.failCli('--working-folder is required.');
  }

  let pollMs;
  let cancelAfterNoProgressMs = null;
  try {
    pollMs = values['poll-ms']
      ? parsePositiveNumber(values['poll-ms'], '--poll-ms')
      : DEFAULT_POLL_MS;
    cancelAfterNoProgressMs = values['cancel-after-no-progress-ms']
      ? parsePositiveNumber(
          values['cancel-after-no-progress-ms'],
          '--cancel-after-no-progress-ms',
        )
      : null;
  } catch (error) {
    return run.failCli(error instanceof Error ? error.message : String(error));
  }

  run.protocol.setPhase('starting_review');
  run.startHeartbeat();
  try {
    const baseUrl = values['base-url'] ?? DEFAULT_BASE_URL;
    const launch = await resolveReviewLaunch({
      baseUrl,
      workingFolder: values['working-folder'],
      sourceId: values['source-id'],
    });
    const result = await waitForReviewCycle({
      baseUrl,
      workingFolder: launch.workingFolder,
      sourceId: launch.sourceId,
      customTitle: values['custom-title'],
      pollMs,
      cancelAfterNoProgressMs,
      onStatus: ({ conversationId, status, stopRequested }) => {
        run.protocol.setPhase(
          stopRequested ? 'waiting_for_stop' : `review_${status.status}`,
        );
        writeLogLine(
          run.logStream,
          JSON.stringify({
            timestamp: new Date().toISOString(),
            conversationId,
            status,
            stopRequested,
          }),
        );
      },
    });
    const passed = result.status.status === 'ok';
    await run.closeLog();
    run.protocol.emitFinal({
      status: passed ? 'passed' : 'failed',
      reason: passed ? 'terminal_review_success' : 'terminal_review_failure',
      extraFields: {
        conversation_id: result.conversationId,
        terminal_status: result.status.status,
      },
    });
    return passed ? 0 : 1;
  } catch (error) {
    writeLogLine(
      run.logStream,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    await run.closeLog();
    run.protocol.emitFinal({
      status: 'failed',
      reason: 'review_runner_failure',
    });
    return 1;
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
