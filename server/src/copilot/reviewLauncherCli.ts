import { parseArgs } from 'node:util';

import type { CopilotReviewReasoningEffort } from '../flows/copilotReviewModels.js';
import {
  runCopilotReview,
  type CopilotReviewLauncherPaths,
} from './reviewLauncher.js';

try {
  const parsed = parseArgs({
    options: {
      repository: { type: 'string' },
      workspace: { type: 'string' },
      'target-id': { type: 'string' },
      'review-wave-id': { type: 'string' },
      'job-instance-id': { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      model: { type: 'string' },
      'reasoning-effort': { type: 'string' },
      'endpoint-label': { type: 'string' },
      'endpoint-id': { type: 'string' },
      instructions: { type: 'string' },
      stdout: { type: 'string' },
      stderr: { type: 'string' },
      status: { type: 'string' },
      invocation: { type: 'string' },
      normalized: { type: 'string' },
      usage: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const required = (name: keyof typeof parsed.values): string => {
    const value = parsed.values[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Missing required --${name} argument.`);
    }
    return value;
  };
  const outputPaths: CopilotReviewLauncherPaths = {
    stdoutPath: required('stdout'),
    stderrPath: required('stderr'),
    exitStatusPath: required('status'),
    invocationPath: required('invocation'),
    normalizedResultPath: required('normalized'),
    usagePath: required('usage'),
  };
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  let result;
  try {
    result = await runCopilotReview({
      repositoryPath: required('repository'),
      workspacePath: required('workspace'),
      targetId: required('target-id'),
      reviewWaveId: required('review-wave-id'),
      jobInstanceId: required('job-instance-id'),
      baseCommit: required('base'),
      headCommit: required('head'),
      modelId: required('model'),
      reasoningEffort: required(
        'reasoning-effort',
      ) as CopilotReviewReasoningEffort,
      endpointLabel:
        typeof parsed.values['endpoint-label'] === 'string'
          ? parsed.values['endpoint-label']
          : undefined,
      endpointId:
        typeof parsed.values['endpoint-id'] === 'string'
          ? parsed.values['endpoint-id']
          : undefined,
      instructionsPath: required('instructions'),
      outputPaths,
      signal: abortController.signal,
    });
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
  process.exitCode = result.exitStatus;
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Copilot review launcher failed.'}\n`,
  );
  process.exitCode = 2;
}
