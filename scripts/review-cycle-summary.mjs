import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { createSummaryWrapperRun } from './summary-wrapper-runner.mjs';
import { writeLogLine } from './summary-wrapper-protocol.mjs';

const DEFAULT_BASE_URL = 'http://localhost:5010';
const DEFAULT_POLL_MS = 5_000;
const MAX_TIMER_MS = 2_147_483_647;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const parseTimerMs = (value, name) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_TIMER_MS) {
    throw new Error(
      `${name} must be an integer from 1 through ${MAX_TIMER_MS} milliseconds.`,
    );
  }
  return parsed;
};

export const normalizeBaseUrl = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const selected = normalized || DEFAULT_BASE_URL;
  const parsed = new URL(selected);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('--base-url must use http or https.');
  }
  return parsed.toString().replace(/\/$/u, '');
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

export const buildReviewRetryOwnershipId = ({
  workingFolder,
  sourceId,
  customTitle,
  flowName = 'two_phase_review_cycle',
  launchNonce = null,
}) => {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        workingFolder,
        sourceId: sourceId ?? null,
        customTitle: customTitle ?? null,
        flowName,
        launchNonce,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  return `review-cycle-${digest}`;
};

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
    const matchingSource = repos.find(
      (repo) =>
        repo &&
        (repo.containerPath === sourceId ||
          repo.hostPath === sourceId ||
          repo.id === sourceId),
    );
    if (
      !matchingSource ||
      matchingSource.containerPath !== matchingRepo.containerPath
    ) {
      throw new Error(
        `Working folder and source id identify different ingested repositories: ${workingFolder} vs ${sourceId}`,
      );
    }
    return {
      workingFolder: matchingRepo.containerPath,
      sourceId: matchingSource.containerPath,
    };
  }

  const flowsResponse = await fetchImpl(`${baseUrl}/flows`);
  const flowsBody = await readJsonResponse(
    flowsResponse,
    'Flow catalog lookup',
  );
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
    (uniqueSourceIds.length === 1 &&
    uniqueSourceIds[0] === matchingRepo.containerPath
      ? uniqueSourceIds[0]
      : undefined);
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
  flowName = 'two_phase_review_cycle',
  conversationId: attachedConversationId,
  resumeOrphaned = false,
  retryOwnershipId = buildReviewRetryOwnershipId({
    workingFolder,
    sourceId,
    customTitle,
    flowName,
    launchNonce: randomUUID(),
  }),
  pollMs = DEFAULT_POLL_MS,
  cancelAfterNoProgressMs = null,
  fetchImpl = fetch,
  sleep = delay,
  now = Date.now,
  onStatus = () => {},
}) => {
  let conversationId = attachedConversationId;
  if (!conversationId) {
    const startResponse = await fetchImpl(`${baseUrl}/flows/${flowName}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        working_folder: workingFolder,
        retryOwnershipId,
        ...(sourceId ? { sourceId } : {}),
        ...(customTitle ? { customTitle } : {}),
      }),
    });
    const started = await readJsonResponse(startResponse, 'Review start');
    if (!started || typeof started.conversationId !== 'string') {
      throw new Error('Review start did not return a conversationId.');
    }
    conversationId = started.conversationId;
  }
  let lastFingerprint = '';
  let lastProgressAt = now();
  let stopRequested = false;
  let resumeRequested = false;

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

    if (
      status.status === 'orphaned' &&
      resumeOrphaned &&
      !resumeRequested &&
      Array.isArray(status.resumeStepPath)
    ) {
      const resumeResponse = await fetchImpl(
        `${baseUrl}/flows/${flowName}/run`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            resumeStepPath: status.resumeStepPath,
            working_folder: workingFolder,
            ...(sourceId ? { sourceId } : {}),
          }),
        },
      );
      await readJsonResponse(resumeResponse, 'Review resume');
      resumeRequested = true;
    } else if (status.terminal) {
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
        name: 'conversation-id',
        type: 'string',
        description:
          'Attach to an accepted review conversation instead of starting another copy.',
      },
      {
        name: 'resume-orphaned',
        type: 'boolean',
        description:
          'Explicitly resume an interrupted attached run from its server-provided safe checkpoint.',
      },
      {
        name: 'diagnostic',
        type: 'boolean',
        description:
          'Run the isolated diagnostic review flow without final disposition or convergence ownership.',
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
  if (!values['working-folder'] && !values['conversation-id']) {
    return run.failCli('--working-folder is required.');
  }
  if (values['resume-orphaned'] && !values['conversation-id']) {
    return run.failCli('--resume-orphaned requires --conversation-id.');
  }
  if (values['resume-orphaned'] && !values['working-folder']) {
    return run.failCli('--resume-orphaned requires --working-folder.');
  }

  let pollMs;
  let cancelAfterNoProgressMs = null;
  try {
    pollMs = values['poll-ms']
      ? parseTimerMs(values['poll-ms'], '--poll-ms')
      : DEFAULT_POLL_MS;
    cancelAfterNoProgressMs = values['cancel-after-no-progress-ms']
      ? parseTimerMs(
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
    const baseUrl = normalizeBaseUrl(values['base-url']);
    const launch = values['working-folder']
      ? await resolveReviewLaunch({
          baseUrl,
          workingFolder: values['working-folder'],
          sourceId: values['source-id'],
        })
      : {
          workingFolder: undefined,
          sourceId: values['source-id'],
        };
    const result = await waitForReviewCycle({
      baseUrl,
      workingFolder: launch.workingFolder,
      sourceId: launch.sourceId,
      customTitle: values['custom-title'],
      flowName: values.diagnostic
        ? 'diagnostic_review_cycle'
        : 'two_phase_review_cycle',
      conversationId: values['conversation-id'],
      resumeOrphaned: Boolean(values['resume-orphaned']),
      pollMs,
      cancelAfterNoProgressMs,
      onStatus: ({ conversationId, status, stopRequested }) => {
        run.protocol.setHeartbeatFields({
          conversation_id: conversationId,
        });
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
    const skipped = result.status.terminalOutcome === 'not_applicable';
    await run.closeLog();
    run.protocol.emitFinal({
      status: passed ? 'passed' : 'failed',
      reason: skipped
        ? 'terminal_review_skipped'
        : passed
          ? 'terminal_review_success'
          : 'terminal_review_failure',
      extraFields: {
        conversation_id: result.conversationId,
        terminal_status: result.status.status,
        terminal_outcome: result.status.terminalOutcome ?? null,
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
