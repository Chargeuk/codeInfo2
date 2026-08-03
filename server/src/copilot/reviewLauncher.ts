import { execFile as execFileCallback, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { fetchOpenAiCompatModels } from '../chat/openaiCompatAdapter.js';
import {
  normalizeOpenAiCompatEndpointId,
  resolveOpenAiCompatEndpointConfigsFromList,
  validateOpenAiCompatEndpointConfigForProvider,
  type OpenAiCompatEndpointConfig,
} from '../config/openaiCompatEndpoints.js';
import { resolveExternalOpenAiCompatEndpoints } from '../config/startupEnv.js';
import {
  COPILOT_REVIEW_REASONING_EFFORTS,
  type CopilotReviewReasoningEffort,
} from '../flows/copilotReviewModels.js';

const execFile = promisify(execFileCallback);
const SUPPORTED_REASONING = new Set<string>(COPILOT_REVIEW_REASONING_EFFORTS);

export type CopilotReviewLauncherPaths = {
  workspacePath: string;
  availabilitySpecPath: string;
  instructionsPath: string;
  stdoutPath: string;
  stderrPath: string;
  exitStatusPath: string;
  invocationPath: string;
  normalizedResultPath: string;
  usagePath: string;
};

export type CopilotReviewLauncherOptions = {
  repositoryPath: string;
  workspacePath: string;
  targetId: string;
  reviewWaveId: string;
  jobInstanceId: string;
  baseCommit: string;
  headCommit: string;
  modelId: string;
  reasoningEffort?: CopilotReviewReasoningEffort;
  endpointLabel?: string;
  endpointId?: string;
  preflightUnavailableReason?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type ResolvedCopilotReviewLauncherOptions = CopilotReviewLauncherOptions & {
  workspacePath: string;
  instructionsPath: string;
  outputPaths: CopilotReviewLauncherPaths;
};

export type CopilotReviewLauncherResult = {
  launched: boolean;
  exitStatus: number;
  status:
    | 'successful'
    | 'partial'
    | 'failed'
    | 'unavailable'
    | 'timed_out'
    | 'cancelled';
  startedAt: string;
  completedAt: string;
};

type SpawnedProcess = ReturnType<typeof spawn>;

export type CopilotReviewLauncherDeps = {
  execFile: typeof execFile;
  spawn: (
    command: string,
    args: readonly string[],
    options: Parameters<typeof spawn>[2],
  ) => SpawnedProcess;
  discoverExternalModels: (
    endpoint: OpenAiCompatEndpointConfig,
    env: NodeJS.ProcessEnv,
  ) => Promise<string[]>;
  killProcessGroup: (pid: number, signal: NodeJS.Signals) => boolean;
  now: () => Date;
};

const defaultDeps: CopilotReviewLauncherDeps = {
  execFile,
  spawn: (command, args, options) => spawn(command, args, options),
  discoverExternalModels: async (endpoint, env) =>
    (
      await fetchOpenAiCompatModels({
        endpoint,
        consumer: 'copilot',
        env,
      })
    ).map((model) => model.id),
  killProcessGroup: (pid, signal) => process.kill(-pid, signal),
  now: () => new Date(),
};

const DEFAULT_COPILOT_REVIEW_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const COPILOT_TERMINATION_GRACE_MS = 5_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const SUPPORTS_PROCESS_GROUPS = process.platform !== 'win32';

export class CopilotReviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopilotReviewUnavailableError';
  }
}

const requireValue = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const isContained = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};

const requireContainedPath = (
  workspacePath: string,
  candidatePath: string,
  label: string,
) => {
  if (!isContained(workspacePath, candidatePath)) {
    throw new Error(`${label} must remain inside the assigned workspace.`);
  }
};

export async function resolveCopilotReviewWorkspacePaths(
  rawWorkspacePath: string,
): Promise<CopilotReviewLauncherPaths> {
  const workspacePath = await fs.realpath(
    requireValue(rawWorkspacePath, 'workspacePath'),
  );
  const [inputPath, workPath, outputPath] = await Promise.all(
    ['input', 'work', 'output'].map(async (directoryName) => {
      const directoryPath = await fs.realpath(
        path.join(workspacePath, directoryName),
      );
      if (!(await fs.stat(directoryPath)).isDirectory()) {
        throw new Error(
          `Assigned workspace ${directoryName} path must be a directory.`,
        );
      }
      requireContainedPath(
        workspacePath,
        directoryPath,
        `Assigned workspace ${directoryName} path`,
      );
      return directoryPath;
    }),
  );
  return {
    workspacePath,
    availabilitySpecPath: path.join(inputPath, 'copilot-review-spec.json'),
    instructionsPath: path.join(workPath, 'copilot-review-instructions.md'),
    stdoutPath: path.join(workPath, 'copilot.stdout.jsonl'),
    stderrPath: path.join(workPath, 'copilot.stderr.log'),
    exitStatusPath: path.join(workPath, 'copilot.exit.json'),
    invocationPath: path.join(workPath, 'copilot.invocation.json'),
    normalizedResultPath: path.join(outputPath, 'copilot-review.json'),
    usagePath: path.join(workPath, 'review-usage', 'native-copilot.json'),
  };
}

const requireContainedOutputPaths = (
  workspacePath: string,
  outputPaths: CopilotReviewLauncherPaths,
) => {
  for (const [label, filePath] of Object.entries(outputPaths)) {
    requireContainedPath(workspacePath, path.resolve(filePath), label);
  }
};

const gitStdout = async (
  repositoryPath: string,
  args: string[],
  deps: CopilotReviewLauncherDeps,
): Promise<string> => {
  const result = await deps.execFile('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
  });
  return result.stdout.trim();
};

const verifyRepositoryAndCommits = async (
  options: ResolvedCopilotReviewLauncherOptions,
  deps: CopilotReviewLauncherDeps,
) => {
  const [repositoryPath, workspacePath, instructionsPath] = await Promise.all([
    fs.realpath(options.repositoryPath),
    fs.realpath(options.workspacePath),
    fs.realpath(options.instructionsPath),
  ]);
  requireContainedOutputPaths(workspacePath, options.outputPaths);
  if (!isContained(workspacePath, instructionsPath)) {
    throw new Error(
      'Review instructions must remain inside the assigned workspace.',
    );
  }
  if (!(await fs.stat(instructionsPath)).isFile()) {
    throw new Error('Review instructions must be a file.');
  }
  const repositoryRoot = await gitStdout(
    repositoryPath,
    ['rev-parse', '--show-toplevel'],
    deps,
  );
  if ((await fs.realpath(repositoryRoot)) !== repositoryPath) {
    throw new Error('Repository path is not the verified repository root.');
  }
  await gitStdout(
    repositoryPath,
    ['cat-file', '-e', `${options.baseCommit}^{commit}`],
    deps,
  );
  await gitStdout(
    repositoryPath,
    ['cat-file', '-e', `${options.headCommit}^{commit}`],
    deps,
  );
  const resolvedHead = await gitStdout(
    repositoryPath,
    ['rev-parse', 'HEAD^{commit}'],
    deps,
  );
  const expectedHead = await gitStdout(
    repositoryPath,
    ['rev-parse', `${options.headCommit}^{commit}`],
    deps,
  );
  if (resolvedHead !== expectedHead) {
    throw new Error(
      'Repository HEAD does not match the pinned review head commit.',
    );
  }
  return { repositoryPath, workspacePath, instructionsPath };
};

const readAvailabilitySnapshot = async (
  specPath: string,
): Promise<{ available: boolean; unavailableReason?: string }> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(specPath, 'utf8'));
  } catch {
    throw new Error(
      'Pinned Copilot review availability snapshot could not be read.',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Pinned Copilot review availability snapshot is invalid.');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.available !== 'boolean') {
    throw new Error('Pinned Copilot review availability snapshot is invalid.');
  }
  if (
    record.unavailableReason !== undefined &&
    (typeof record.unavailableReason !== 'string' ||
      !record.unavailableReason.trim())
  ) {
    throw new Error('Pinned Copilot review availability snapshot is invalid.');
  }
  return {
    available: record.available,
    unavailableReason:
      typeof record.unavailableReason === 'string'
        ? record.unavailableReason.trim()
        : undefined,
  };
};

export const COPILOT_REVIEW_EXCLUDED_PATHS = ['planning/**'] as const;

export function buildCopilotReviewPrompt(params: {
  baseCommit: string;
  headCommit: string;
  instructionsPath: string;
}): string {
  const excludedPath = COPILOT_REVIEW_EXCLUDED_PATHS[0];
  return [
    `/review the committed changes at ${params.headCommit} compared with ${params.baseCommit}.`,
    `Review the exact range ${params.baseCommit}...${params.headCommit}.`,
    `Read the review requirements from ${params.instructionsPath}.`,
    `Exclude all changed files under ${excludedPath} from the review. Do not inspect, read, summarize, cite, or report findings for those changes; use the supplied review requirements instead.`,
    `For Git diff inspection, use git diff ${params.baseCommit}...${params.headCommit} -- . ':(exclude)${excludedPath}' so excluded changes are not sent to the model.`,
    'Do not modify source files, Git state, branches, commits, or remotes.',
    'Do not create or submit a GitHub pull-request review and do not delegate to a remote coding agent.',
    'Return review findings only, with concrete file and line evidence where available.',
  ].join(' ');
}

const SECRET_ENVIRONMENT_NAMES = [
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_PROVIDER_BEARER_TOKEN',
  'COPILOT_PROVIDER_HEADERS',
  'COPILOT_GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const;

const redactSecrets = (value: string, secrets: readonly string[]): string =>
  [...new Set(secrets)]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'),
      value,
    );

export function buildCopilotReviewArguments(params: {
  repositoryPath: string;
  prompt: string;
  modelId: string;
  reasoningEffort?: CopilotReviewReasoningEffort;
}): string[] {
  const args = [
    '-C',
    params.repositoryPath,
    '--prompt',
    params.prompt,
    '--model',
    params.modelId,
  ];
  if (params.reasoningEffort) {
    args.push('--reasoning-effort', params.reasoningEffort);
  }
  args.push(
    '--output-format',
    'json',
    '--no-ask-user',
    '--no-auto-update',
    '--no-remote',
    '--no-remote-export',
    '--no-custom-instructions',
    '--disable-builtin-mcps',
    '--allow-all',
    `--secret-env-vars=${SECRET_ENVIRONMENT_NAMES.join(',')}`,
  );
  return args;
}

const withoutProviderEnvironment = (
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const result = { ...source };
  for (const key of Object.keys(result)) {
    if (key.startsWith('COPILOT_PROVIDER_')) delete result[key];
  }
  delete result.COPILOT_MODEL;
  delete result.CODEINFO_COPILOT_REVIEW_MODELS;
  delete result.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS;
  delete result.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINT_KEYS;
  delete result.CODEINFO_OPENAI_EMBEDDING_KEY;
  delete result.CODEINFO_CONTEXT7_API_KEY;
  result.GIT_OPTIONAL_LOCKS = '0';
  result.GIT_TERMINAL_PROMPT = '0';
  result.GIT_PAGER = 'cat';
  result.PAGER = 'cat';
  return result;
};

class CopilotReviewCancelledError extends Error {
  constructor() {
    super('Copilot review was cancelled.');
    this.name = 'CopilotReviewCancelledError';
  }
}

const awaitWithAbort = async <Value>(
  operation: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> => {
  if (!signal) return await operation;
  if (signal.aborted) throw new CopilotReviewCancelledError();
  return await new Promise<Value>((resolve, reject) => {
    const finish = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      finish();
      reject(new CopilotReviewCancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(error);
      },
    );
  });
};

const EXTERNAL_COPILOT_BASELINE_ENVIRONMENT_KEYS = [
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'PATH',
  'SHELL',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  // These are supplied only by the launcher unit-test fake CLI.
  'FAKE_COPILOT_ARGS_FILE',
  'FAKE_COPILOT_COUNT_FILE',
  'FAKE_COPILOT_ENV_FILE',
  'FAKE_COPILOT_EXIT',
  'FAKE_COPILOT_STDERR',
  'FAKE_COPILOT_STDOUT',
  'FAKE_COPILOT_STDIN_FILE',
  'FAKE_COPILOT_WAIT',
] as const;

const buildExternalCopilotEnvironmentBaseline = (
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {};
  for (const key of EXTERNAL_COPILOT_BASELINE_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  result.GIT_OPTIONAL_LOCKS = '0';
  result.GIT_TERMINAL_PROMPT = '0';
  result.GIT_PAGER = 'cat';
  result.PAGER = 'cat';
  return result;
};

export function buildNativeCopilotReviewEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result = withoutProviderEnvironment(source);
  const copilotHome = source.CODEINFO_COPILOT_HOME?.trim();
  if (copilotHome) result.COPILOT_HOME = copilotHome;
  return result;
}

const resolveExternalLaunch = async (
  endpointLabel: string,
  endpointId: string,
  modelId: string,
  source: NodeJS.ProcessEnv,
  deps: CopilotReviewLauncherDeps,
  signal?: AbortSignal,
): Promise<{
  endpoint: OpenAiCompatEndpointConfig;
  apiKey?: string;
}> => {
  let endpointConfigs: ReturnType<
    typeof resolveOpenAiCompatEndpointConfigsFromList
  >;
  try {
    endpointConfigs = resolveOpenAiCompatEndpointConfigsFromList({
      value: source.CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS,
      pathLabel: 'CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS',
    });
  } catch {
    throw new CopilotReviewUnavailableError(
      'External endpoint configuration could not be resolved before launch.',
    );
  }
  const pinnedEndpoint = endpointConfigs.endpoints.find(
    (candidate) => candidate.authLookupKey === endpointLabel,
  );
  if (!pinnedEndpoint) {
    throw new CopilotReviewUnavailableError(
      'The selected external endpoint is no longer configured.',
    );
  }
  if (pinnedEndpoint.endpointId !== endpointId) {
    throw new CopilotReviewUnavailableError(
      'The selected external endpoint identity changed before launch.',
    );
  }

  let resolution: ReturnType<typeof resolveExternalOpenAiCompatEndpoints>;
  try {
    resolution = resolveExternalOpenAiCompatEndpoints({ env: source });
  } catch {
    throw new CopilotReviewUnavailableError(
      'External endpoint configuration could not be resolved before launch.',
    );
  }
  const endpoint = resolution.endpoints.find(
    (candidate) =>
      candidate.authLookupKey === endpointLabel &&
      candidate.endpointId === endpointId,
  );
  if (!endpoint) {
    throw new CopilotReviewUnavailableError(
      'The selected external endpoint could not be resolved before launch.',
    );
  }
  try {
    validateOpenAiCompatEndpointConfigForProvider({
      endpoint,
      provider: 'copilot',
      pathLabel: 'selected Copilot review endpoint',
    });
  } catch {
    throw new CopilotReviewUnavailableError(
      'The selected external endpoint no longer supports completions.',
    );
  }
  let modelIds: string[];
  try {
    modelIds = await awaitWithAbort(
      deps.discoverExternalModels(endpoint, source),
      signal,
    );
  } catch (error) {
    if (error instanceof CopilotReviewCancelledError) throw error;
    throw new CopilotReviewUnavailableError(
      'The selected external endpoint could not be rediscovered before launch.',
    );
  }
  if (!modelIds.includes(modelId)) {
    throw new CopilotReviewUnavailableError(
      'The selected external model is no longer advertised before launch.',
    );
  }
  return {
    endpoint,
    apiKey: resolution.apiKeysByEndpointId.get(endpoint.endpointId),
  };
};

export function buildExternalCopilotReviewEnvironment(params: {
  source: NodeJS.ProcessEnv;
  endpoint: OpenAiCompatEndpointConfig;
  modelId: string;
  apiKey?: string;
}): NodeJS.ProcessEnv {
  const result = buildExternalCopilotEnvironmentBaseline(params.source);
  result.COPILOT_PROVIDER_TYPE = 'openai';
  result.COPILOT_PROVIDER_BASE_URL = params.endpoint.baseUrl;
  result.COPILOT_PROVIDER_WIRE_API = 'completions';
  result.COPILOT_MODEL = params.modelId;
  if (params.apiKey) result.COPILOT_PROVIDER_API_KEY = params.apiKey;
  return result;
}

const runProcess = async (params: {
  cliPath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  deps: CopilotReviewLauncherDeps;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<{
  launched: boolean;
  exitStatus: number;
  stdout: string;
  stderr: string;
  terminationReason?: 'aborted' | 'timeout';
}> =>
  await new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let child: SpawnedProcess;
    let terminationReason: 'aborted' | 'timeout' | undefined;
    let terminationUsesProcessGroup = false;
    let processGroupForceKilled = false;
    const timers: {
      forceKill?: NodeJS.Timeout;
      timeout?: NodeJS.Timeout;
    } = {};
    const captured = () => ({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    });
    const terminateForAbort = () => terminate('aborted');
    const signalTerminationTarget = (signal: NodeJS.Signals): boolean => {
      if (SUPPORTS_PROCESS_GROUPS && typeof child.pid === 'number') {
        try {
          params.deps.killProcessGroup(child.pid, signal);
          return true;
        } catch {
          // Fall back to the direct child if its dedicated group is already gone
          // or the current platform cannot signal it as expected.
        }
      }
      child.kill(signal);
      return false;
    };
    const finish = (result: {
      launched: boolean;
      exitStatus: number;
      stdout: string;
      stderr: string;
      terminationReason?: 'aborted' | 'timeout';
    }) => {
      if (settled) return;
      settled = true;
      if (timers.timeout) clearTimeout(timers.timeout);
      if (timers.forceKill) clearTimeout(timers.forceKill);
      params.signal?.removeEventListener('abort', terminateForAbort);
      resolve(result);
    };
    function terminate(reason: 'aborted' | 'timeout') {
      if (settled || terminationReason) return;
      terminationReason = reason;
      terminationUsesProcessGroup = signalTerminationTarget('SIGTERM');
      timers.forceKill = setTimeout(() => {
        if (settled) return;
        processGroupForceKilled = signalTerminationTarget('SIGKILL');
      }, COPILOT_TERMINATION_GRACE_MS);
      timers.forceKill.unref?.();
    }
    if (params.signal?.aborted) {
      finish({
        launched: false,
        exitStatus: 130,
        stdout: '',
        stderr: 'Copilot review was cancelled.\n',
        terminationReason: 'aborted',
      });
      return;
    }
    try {
      child = params.deps.spawn(params.cliPath, params.args, {
        cwd: params.cwd,
        env: params.env,
        detached: SUPPORTS_PROCESS_GROUPS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      finish({
        launched: false,
        exitStatus: 127,
        stdout: '',
        stderr: 'Copilot CLI could not be started.\n',
      });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer | string) =>
      stdout.push(Buffer.from(chunk)),
    );
    child.stderr?.on('data', (chunk: Buffer | string) =>
      stderr.push(Buffer.from(chunk)),
    );
    child.once('error', () => {
      const output = captured();
      finish({
        launched: false,
        exitStatus: 127,
        stdout: output.stdout,
        stderr: output.stderr || 'Copilot CLI could not be started.\n',
      });
    });
    child.once('close', (code) => {
      if (
        terminationReason &&
        terminationUsesProcessGroup &&
        !processGroupForceKilled &&
        typeof child.pid === 'number'
      ) {
        try {
          params.deps.killProcessGroup(child.pid, 'SIGKILL');
        } catch {
          // The dedicated process group has already exited.
        }
      }
      const output = captured();
      const exitStatus =
        terminationReason === 'timeout'
          ? 124
          : terminationReason === 'aborted'
            ? 130
            : typeof code === 'number'
              ? code
              : 1;
      const diagnostic =
        terminationReason === 'timeout'
          ? 'Copilot review timed out.\n'
          : terminationReason === 'aborted'
            ? 'Copilot review was cancelled.\n'
            : '';
      finish({
        launched: true,
        exitStatus,
        stdout: output.stdout,
        stderr: `${output.stderr}${diagnostic}`,
        ...(terminationReason ? { terminationReason } : {}),
      });
    });
    if (params.signal?.aborted) {
      terminateForAbort();
      return;
    }
    params.signal?.addEventListener('abort', terminateForAbort, { once: true });
    timers.timeout = setTimeout(
      () => terminate('timeout'),
      Math.max(1, params.timeoutMs),
    );
    timers.timeout.unref?.();
  });

export const resolveCopilotReviewTimeoutMs = (
  options: Pick<CopilotReviewLauncherOptions, 'timeoutMs'>,
  sourceEnv: NodeJS.ProcessEnv,
): number => {
  if (
    typeof options.timeoutMs === 'number' &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
  ) {
    return Math.min(options.timeoutMs, MAX_TIMER_DELAY_MS);
  }
  const raw = sourceEnv.CODEINFO_COPILOT_REVIEW_TIMEOUT_SEC?.trim();
  if (!raw) return DEFAULT_COPILOT_REVIEW_TIMEOUT_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_TIMER_DELAY_MS)
    : DEFAULT_COPILOT_REVIEW_TIMEOUT_MS;
};

const parseJsonLines = (raw: string): unknown[] =>
  raw.split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });

const collectReviewText = (events: readonly unknown[]): string => {
  const values = events.flatMap((event) => {
    if (!event || typeof event !== 'object') return [];
    const { type, data } = event as {
      type?: unknown;
      data?: unknown;
    };
    if (type !== 'assistant.message' || !data || typeof data !== 'object') {
      return [];
    }
    const content = (data as { content?: unknown }).content;
    if (typeof content !== 'string') return [];
    const trimmed = content.trim();
    return trimmed ? [trimmed] : [];
  });
  return [...new Set(values)].join('\n\n');
};

type NormalizedUsage = {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  premium_requests: number | null;
  total_api_duration_ms: number | null;
  session_duration_ms: number | null;
  code_changes: {
    lines_added: number | null;
    lines_removed: number | null;
    files_modified: string[];
  } | null;
};

const numeric = (
  record: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};

const extractUsage = (events: readonly unknown[]): NormalizedUsage => {
  const usageRecords: Record<string, unknown>[] = [];
  const visit = (value: unknown, key?: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry));
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      key === 'usage' ||
      'input_tokens' in record ||
      'inputTokens' in record ||
      'output_tokens' in record ||
      'outputTokens' in record ||
      'premiumRequests' in record ||
      'premium_requests' in record
    ) {
      usageRecords.push(record);
    }
    for (const [childKey, childValue] of Object.entries(record)) {
      visit(childValue, childKey);
    }
  };
  events.forEach((event) => visit(event));
  const lastNumeric = (...keys: string[]): number | null => {
    for (let index = usageRecords.length - 1; index >= 0; index -= 1) {
      const value = numeric(usageRecords[index] ?? {}, ...keys);
      if (value !== null) return value;
    }
    return null;
  };
  let codeChanges: NormalizedUsage['code_changes'] = null;
  for (let index = usageRecords.length - 1; index >= 0; index -= 1) {
    const candidate = usageRecords[index]?.codeChanges;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      continue;
    const record = candidate as Record<string, unknown>;
    codeChanges = {
      lines_added: numeric(record, 'linesAdded', 'lines_added'),
      lines_removed: numeric(record, 'linesRemoved', 'lines_removed'),
      files_modified: Array.isArray(record.filesModified)
        ? record.filesModified.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
    };
    break;
  }
  return {
    input_tokens: lastNumeric('input_tokens', 'inputTokens', 'prompt_tokens'),
    cached_input_tokens: lastNumeric(
      'cached_input_tokens',
      'cachedInputTokens',
    ),
    output_tokens: lastNumeric(
      'output_tokens',
      'outputTokens',
      'completion_tokens',
    ),
    reasoning_output_tokens: lastNumeric(
      'reasoning_output_tokens',
      'reasoningOutputTokens',
      'reasoning_tokens',
    ),
    premium_requests: lastNumeric('premiumRequests', 'premium_requests'),
    total_api_duration_ms: lastNumeric(
      'totalApiDurationMs',
      'total_api_duration_ms',
    ),
    session_duration_ms: lastNumeric(
      'sessionDurationMs',
      'session_duration_ms',
    ),
    code_changes: codeChanges,
  };
};

const writeArtifacts = async (params: {
  options: ResolvedCopilotReviewLauncherOptions;
  args: string[];
  launched: boolean;
  exitStatus: number;
  stdout: string;
  stderr: string;
  status: CopilotReviewLauncherResult['status'];
  startedAt: string;
  completedAt: string;
  failureReason?: string;
  events: readonly unknown[];
  secretValues: readonly string[];
}) => {
  const review = redactSecrets(
    collectReviewText(params.events),
    params.secretValues,
  );
  const extractedUsage = extractUsage(params.events);
  const usage: NormalizedUsage = {
    ...extractedUsage,
    code_changes: extractedUsage.code_changes
      ? {
          ...extractedUsage.code_changes,
          files_modified: extractedUsage.code_changes.files_modified.map(
            (filePath) => redactSecrets(filePath, params.secretValues),
          ),
        }
      : null,
  };
  const artifactPaths = [
    params.options.outputPaths.stdoutPath,
    params.options.outputPaths.stderrPath,
    params.options.outputPaths.exitStatusPath,
    params.options.outputPaths.invocationPath,
    params.options.outputPaths.normalizedResultPath,
    params.options.outputPaths.usagePath,
  ];
  await Promise.all(
    artifactPaths.map((filePath) =>
      fs.mkdir(path.dirname(filePath), { recursive: true }),
    ),
  );
  await Promise.all([
    fs.writeFile(params.options.outputPaths.stdoutPath, params.stdout, 'utf8'),
    fs.writeFile(params.options.outputPaths.stderrPath, params.stderr, 'utf8'),
    fs.writeFile(
      params.options.outputPaths.exitStatusPath,
      `${JSON.stringify(
        {
          schema_version: 'codeinfo-copilot-review-exit/v1',
          launched: params.launched,
          exit_status: params.exitStatus,
          started_at: params.startedAt,
          completed_at: params.completedAt,
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    fs.writeFile(
      params.options.outputPaths.invocationPath,
      `${JSON.stringify(
        {
          schema_version: 'codeinfo-copilot-review-invocation/v1',
          provider_mode: params.options.endpointLabel ? 'external' : 'native',
          endpoint_label: params.options.endpointLabel ?? null,
          endpoint_id: params.options.endpointId ?? null,
          model_id: params.options.modelId,
          reasoning_effort: params.options.reasoningEffort ?? null,
          repository_path: params.options.repositoryPath,
          workspace_path: params.options.workspacePath,
          repository_target_id: params.options.targetId,
          review_wave_id: params.options.reviewWaveId,
          job_instance_id: params.options.jobInstanceId,
          base_commit: params.options.baseCommit,
          head_commit: params.options.headCommit,
          excluded_paths: [...COPILOT_REVIEW_EXCLUDED_PATHS],
          instructions_path: params.options.instructionsPath,
          arguments: params.args,
          launched: params.launched,
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    fs.writeFile(
      params.options.outputPaths.usagePath,
      `${JSON.stringify(
        {
          schema_version: 'codeinfo-review-usage/v1',
          provider: 'copilot',
          usage_source: 'inner Copilot CLI invocation',
          ...usage,
          cached_input_note:
            'Cached input is part of input tokens and must not be added to input_tokens.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    fs.writeFile(
      params.options.outputPaths.normalizedResultPath,
      `${JSON.stringify(
        {
          schema_version: 'codeinfo-normalized-review/v1',
          reviewer: 'github-copilot-cli',
          status: params.status,
          provider_mode: params.options.endpointLabel ? 'external' : 'native',
          endpoint_label: params.options.endpointLabel ?? null,
          endpoint_id: params.options.endpointId ?? null,
          model_id: params.options.modelId,
          reasoning_effort: params.options.reasoningEffort ?? null,
          repository_path: params.options.repositoryPath,
          repository_target_id: params.options.targetId,
          review_wave_id: params.options.reviewWaveId,
          job_instance_id: params.options.jobInstanceId,
          base_commit: params.options.baseCommit,
          head_commit: params.options.headCommit,
          excluded_paths: [...COPILOT_REVIEW_EXCLUDED_PATHS],
          launched: params.launched,
          exit_status: params.exitStatus,
          review: review || null,
          failure_reason: params.failureReason ?? null,
          raw_jsonl_path: params.options.outputPaths.stdoutPath,
          raw_stderr_path: params.options.outputPaths.stderrPath,
          started_at: params.startedAt,
          completed_at: params.completedAt,
          usage,
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  ]);
};

export async function runCopilotReview(
  rawOptions: CopilotReviewLauncherOptions,
  injectedDeps: Partial<CopilotReviewLauncherDeps> = {},
): Promise<CopilotReviewLauncherResult> {
  const deps = { ...defaultDeps, ...injectedDeps };
  const workspacePaths = await resolveCopilotReviewWorkspacePaths(
    rawOptions.workspacePath,
  );
  const options: ResolvedCopilotReviewLauncherOptions = {
    ...rawOptions,
    repositoryPath: requireValue(rawOptions.repositoryPath, 'repositoryPath'),
    workspacePath: workspacePaths.workspacePath,
    targetId: requireValue(rawOptions.targetId, 'targetId'),
    reviewWaveId: requireValue(rawOptions.reviewWaveId, 'reviewWaveId'),
    jobInstanceId: requireValue(rawOptions.jobInstanceId, 'jobInstanceId'),
    baseCommit: requireValue(rawOptions.baseCommit, 'baseCommit'),
    headCommit: requireValue(rawOptions.headCommit, 'headCommit'),
    modelId: requireValue(rawOptions.modelId, 'modelId'),
    instructionsPath: workspacePaths.instructionsPath,
    outputPaths: workspacePaths,
    endpointLabel: rawOptions.endpointLabel?.trim() || undefined,
    endpointId: rawOptions.endpointId?.trim()
      ? normalizeOpenAiCompatEndpointId(rawOptions.endpointId, {
          pathLabel: 'endpointId',
        })
      : undefined,
  };
  if (
    options.reasoningEffort !== undefined &&
    !SUPPORTED_REASONING.has(options.reasoningEffort)
  ) {
    throw new Error('reasoningEffort is unsupported.');
  }
  requireContainedOutputPaths(options.workspacePath, options.outputPaths);
  const availability = await readAvailabilitySnapshot(
    options.outputPaths.availabilitySpecPath,
  );
  if (
    availability.available &&
    Boolean(options.endpointLabel) !== Boolean(options.endpointId)
  ) {
    throw new Error(
      'endpointLabel and endpointId must be supplied together for an available external review.',
    );
  }
  const startedAt = deps.now().toISOString();
  let args: string[] = [];
  let processResult: Awaited<ReturnType<typeof runProcess>> = {
    launched: false,
    exitStatus: 2,
    stdout: '',
    stderr: '',
  };
  let failureReason: string | undefined;
  let setupUnavailable = false;
  const secretValues: string[] = [];
  try {
    if (options.preflightUnavailableReason) {
      throw new CopilotReviewUnavailableError(
        options.preflightUnavailableReason,
      );
    }
    if (!availability.available) {
      throw new CopilotReviewUnavailableError(
        availability.unavailableReason ??
          'The configured Copilot review model was unavailable when this batch was prepared.',
      );
    }
    const verified = await verifyRepositoryAndCommits(options, deps);
    const sourceEnv = options.env ?? process.env;
    let childEnv: NodeJS.ProcessEnv;
    if (options.endpointLabel) {
      if (!options.endpointId) {
        throw new Error('endpointId is required for an external review.');
      }
      const external = await resolveExternalLaunch(
        options.endpointLabel,
        options.endpointId,
        options.modelId,
        sourceEnv,
        deps,
        options.signal,
      );
      childEnv = buildExternalCopilotReviewEnvironment({
        source: sourceEnv,
        endpoint: external.endpoint,
        modelId: options.modelId,
        apiKey: external.apiKey,
      });
      if (external.apiKey) secretValues.push(external.apiKey);
    } else {
      childEnv = buildNativeCopilotReviewEnvironment(sourceEnv);
    }
    for (const name of SECRET_ENVIRONMENT_NAMES) {
      const value = childEnv[name]?.trim();
      if (value) secretValues.push(value);
    }
    const prompt = buildCopilotReviewPrompt({
      baseCommit: options.baseCommit,
      headCommit: options.headCommit,
      instructionsPath: verified.instructionsPath,
    });
    args = buildCopilotReviewArguments({
      repositoryPath: verified.repositoryPath,
      prompt,
      modelId: options.modelId,
      ...(options.reasoningEffort
        ? { reasoningEffort: options.reasoningEffort }
        : {}),
    });
    processResult = await runProcess({
      cliPath: sourceEnv.CODEINFO_COPILOT_CLI_PATH?.trim() || 'copilot',
      args,
      cwd: verified.repositoryPath,
      env: childEnv,
      deps,
      signal: options.signal,
      timeoutMs: resolveCopilotReviewTimeoutMs(options, sourceEnv),
    });
  } catch (error) {
    if (error instanceof CopilotReviewCancelledError) {
      processResult = {
        launched: false,
        exitStatus: 130,
        stdout: '',
        stderr: 'Copilot review was cancelled.\n',
        terminationReason: 'aborted',
      };
    } else {
      setupUnavailable = error instanceof CopilotReviewUnavailableError;
      failureReason =
        error instanceof Error ? error.message : 'Copilot review setup failed.';
      processResult.stderr = `${failureReason}\n`;
    }
  }
  const events = parseJsonLines(processResult.stdout);
  const review = collectReviewText(events);
  processResult.stdout = redactSecrets(processResult.stdout, secretValues);
  processResult.stderr = redactSecrets(processResult.stderr, secretValues);
  if (!failureReason && processResult.exitStatus !== 0) {
    failureReason =
      processResult.stderr.trim() ||
      (processResult.launched
        ? `Copilot CLI exited with status ${processResult.exitStatus}.`
        : 'Copilot CLI could not be started.');
  }
  if (failureReason) {
    failureReason = redactSecrets(failureReason, secretValues);
  }
  const status: CopilotReviewLauncherResult['status'] =
    !processResult.launched && processResult.terminationReason === 'aborted'
      ? 'cancelled'
      : !processResult.launched && processResult.exitStatus === 127
        ? 'unavailable'
        : !processResult.launched
          ? setupUnavailable
            ? 'unavailable'
            : 'failed'
          : processResult.terminationReason === 'timeout'
            ? 'timed_out'
            : processResult.terminationReason === 'aborted'
              ? 'cancelled'
              : processResult.exitStatus === 0 && review
                ? 'successful'
                : processResult.stdout.trim()
                  ? 'partial'
                  : 'failed';
  const completedAt = deps.now().toISOString();
  await writeArtifacts({
    options,
    args,
    ...processResult,
    status,
    startedAt,
    completedAt,
    failureReason,
    events,
    secretValues,
  });
  return {
    launched: processResult.launched,
    exitStatus: processResult.exitStatus,
    status,
    startedAt,
    completedAt,
  };
}
