import { execFile as execFileCallback, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { fetchOpenAiCompatModels } from '../chat/openaiCompatAdapter.js';
import {
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
  reasoningEffort: CopilotReviewReasoningEffort;
  endpointLabel?: string;
  instructionsPath: string;
  outputPaths: CopilotReviewLauncherPaths;
  env?: NodeJS.ProcessEnv;
};

export type CopilotReviewLauncherResult = {
  launched: boolean;
  exitStatus: number;
  status: 'successful' | 'partial' | 'failed' | 'unavailable';
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
  now: () => new Date(),
};

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

const requireContainedOutputPaths = (
  workspacePath: string,
  outputPaths: CopilotReviewLauncherPaths,
) => {
  for (const [label, filePath] of Object.entries(outputPaths)) {
    if (!isContained(workspacePath, path.resolve(filePath))) {
      throw new Error(`${label} must remain inside the assigned workspace.`);
    }
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
  options: CopilotReviewLauncherOptions,
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

export function buildCopilotReviewPrompt(params: {
  baseCommit: string;
  headCommit: string;
  instructionsPath: string;
}): string {
  return [
    `/review the committed changes at ${params.headCommit} compared with ${params.baseCommit}.`,
    `Review the exact range ${params.baseCommit}...${params.headCommit}.`,
    `Read the review requirements from ${params.instructionsPath}.`,
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
    .filter((secret) => secret.length >= 6)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'),
      value,
    );

const READ_ONLY_GIT_MUTATION_DENIES = [
  'add',
  'am',
  'apply',
  'branch',
  'checkout',
  'cherry-pick',
  'clean',
  'commit',
  'fetch',
  'merge',
  'mv',
  'pull',
  'push',
  'rebase',
  'reset',
  'restore',
  'rm',
  'stash',
  'switch',
  'tag',
] as const;

export function buildCopilotReviewArguments(params: {
  repositoryPath: string;
  prompt: string;
  modelId: string;
  reasoningEffort: CopilotReviewReasoningEffort;
}): string[] {
  return [
    '-C',
    params.repositoryPath,
    '--prompt',
    params.prompt,
    '--model',
    params.modelId,
    '--reasoning-effort',
    params.reasoningEffort,
    '--output-format',
    'json',
    '--no-ask-user',
    '--no-auto-update',
    '--no-remote',
    '--no-remote-export',
    '--no-custom-instructions',
    '--disable-builtin-mcps',
    '--available-tools=read,shell',
    '--allow-tool=read',
    '--allow-tool=shell(git:*)',
    '--deny-tool=write',
    ...READ_ONLY_GIT_MUTATION_DENIES.map(
      (command) => `--deny-tool=shell(git ${command}:*)`,
    ),
    `--secret-env-vars=${SECRET_ENVIRONMENT_NAMES.join(',')}`,
  ];
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
  modelId: string,
  source: NodeJS.ProcessEnv,
  deps: CopilotReviewLauncherDeps,
): Promise<{
  endpoint: OpenAiCompatEndpointConfig;
  apiKey?: string;
}> => {
  const resolution = resolveExternalOpenAiCompatEndpoints({ env: source });
  const endpoint = resolution.endpoints.find(
    (candidate) => candidate.authLookupKey === endpointLabel,
  );
  if (!endpoint) {
    throw new Error('The selected external endpoint is no longer configured.');
  }
  try {
    validateOpenAiCompatEndpointConfigForProvider({
      endpoint,
      provider: 'copilot',
      pathLabel: 'selected Copilot review endpoint',
    });
  } catch {
    throw new Error(
      'The selected external endpoint no longer supports completions.',
    );
  }
  let modelIds: string[];
  try {
    modelIds = await deps.discoverExternalModels(endpoint, source);
  } catch {
    throw new Error(
      'The selected external endpoint could not be rediscovered before launch.',
    );
  }
  if (!modelIds.includes(modelId)) {
    throw new Error(
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
  const result = withoutProviderEnvironment(params.source);
  const copilotHome = params.source.CODEINFO_COPILOT_HOME?.trim();
  if (copilotHome) result.COPILOT_HOME = copilotHome;
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
}): Promise<{
  launched: boolean;
  exitStatus: number;
  stdout: string;
  stderr: string;
}> =>
  await new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let child: SpawnedProcess;
    try {
      child = params.deps.spawn(params.cliPath, params.args, {
        cwd: params.cwd,
        env: params.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve({
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
      if (settled) return;
      settled = true;
      resolve({
        launched: false,
        exitStatus: 127,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr:
          Buffer.concat(stderr).toString('utf8') ||
          'Copilot CLI could not be started.\n',
      });
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({
        launched: true,
        exitStatus: typeof code === 'number' ? code : 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });

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
  const values: string[] = [];
  const visit = (value: unknown, key?: string) => {
    if (typeof value === 'string') {
      if (
        key === 'content' ||
        key === 'text' ||
        key === 'message' ||
        key === 'result' ||
        key === 'output'
      ) {
        const trimmed = value.trim();
        if (trimmed) values.push(trimmed);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  };
  events.forEach((event) => visit(event));
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
  options: CopilotReviewLauncherOptions;
  args: string[];
  launched: boolean;
  exitStatus: number;
  stdout: string;
  stderr: string;
  status: CopilotReviewLauncherResult['status'];
  startedAt: string;
  completedAt: string;
  failureReason?: string;
}) => {
  const events = parseJsonLines(params.stdout);
  const review = collectReviewText(events);
  const usage = extractUsage(events);
  await Promise.all(
    Object.values(params.options.outputPaths).map((filePath) =>
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
          model_id: params.options.modelId,
          reasoning_effort: params.options.reasoningEffort,
          repository_path: params.options.repositoryPath,
          workspace_path: params.options.workspacePath,
          repository_target_id: params.options.targetId,
          review_wave_id: params.options.reviewWaveId,
          job_instance_id: params.options.jobInstanceId,
          base_commit: params.options.baseCommit,
          head_commit: params.options.headCommit,
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
          model_id: params.options.modelId,
          reasoning_effort: params.options.reasoningEffort,
          repository_path: params.options.repositoryPath,
          repository_target_id: params.options.targetId,
          review_wave_id: params.options.reviewWaveId,
          job_instance_id: params.options.jobInstanceId,
          base_commit: params.options.baseCommit,
          head_commit: params.options.headCommit,
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
  const options: CopilotReviewLauncherOptions = {
    ...rawOptions,
    repositoryPath: requireValue(rawOptions.repositoryPath, 'repositoryPath'),
    workspacePath: requireValue(rawOptions.workspacePath, 'workspacePath'),
    targetId: requireValue(rawOptions.targetId, 'targetId'),
    reviewWaveId: requireValue(rawOptions.reviewWaveId, 'reviewWaveId'),
    jobInstanceId: requireValue(rawOptions.jobInstanceId, 'jobInstanceId'),
    baseCommit: requireValue(rawOptions.baseCommit, 'baseCommit'),
    headCommit: requireValue(rawOptions.headCommit, 'headCommit'),
    modelId: requireValue(rawOptions.modelId, 'modelId'),
    instructionsPath: requireValue(
      rawOptions.instructionsPath,
      'instructionsPath',
    ),
    endpointLabel: rawOptions.endpointLabel?.trim() || undefined,
  };
  if (!SUPPORTED_REASONING.has(options.reasoningEffort)) {
    throw new Error('reasoningEffort is unsupported.');
  }
  const validatedWorkspace = await fs.realpath(options.workspacePath);
  requireContainedOutputPaths(validatedWorkspace, options.outputPaths);
  const startedAt = deps.now().toISOString();
  let args: string[] = [];
  let processResult = {
    launched: false,
    exitStatus: 2,
    stdout: '',
    stderr: '',
  };
  let failureReason: string | undefined;
  const secretValues: string[] = [];
  try {
    const verified = await verifyRepositoryAndCommits(options, deps);
    const sourceEnv = options.env ?? process.env;
    let childEnv: NodeJS.ProcessEnv;
    if (options.endpointLabel) {
      const external = await resolveExternalLaunch(
        options.endpointLabel,
        options.modelId,
        sourceEnv,
        deps,
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
      reasoningEffort: options.reasoningEffort,
    });
    processResult = await runProcess({
      cliPath: sourceEnv.CODEINFO_COPILOT_CLI_PATH?.trim() || 'copilot',
      args,
      cwd: verified.repositoryPath,
      env: childEnv,
      deps,
    });
  } catch (error) {
    failureReason =
      error instanceof Error ? error.message : 'Copilot review setup failed.';
    processResult.stderr = `${failureReason}\n`;
  }
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
  const events = parseJsonLines(processResult.stdout);
  const review = collectReviewText(events);
  const status: CopilotReviewLauncherResult['status'] =
    !processResult.launched && processResult.exitStatus === 127
      ? 'unavailable'
      : !processResult.launched
        ? failureReason?.includes('no longer') ||
          failureReason?.includes('rediscovered')
          ? 'unavailable'
          : 'failed'
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
  });
  return {
    launched: processResult.launched,
    exitStatus: processResult.exitStatus,
    status,
    startedAt,
    completedAt,
  };
}
