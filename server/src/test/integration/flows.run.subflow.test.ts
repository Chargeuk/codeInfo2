import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { registerPendingConversationCancel } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import {
  __resetProviderBootstrapStatusForTests,
  __setProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { validateReviewArtifacts } from '../../flows/reviewArtifacts.js';
import { startFlowRun } from '../../flows/service.js';
import type { RepoEntry } from '../../lmstudio/toolService.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const execFile = promisify(execFileCb);

const buildRepoEntry = (containerPath: string): RepoEntry => ({
  id: path.posix.basename(containerPath.replace(/\\/g, '/')) || 'repo',
  description: null,
  containerPath,
  hostPath: containerPath,
  lastIngestAt: '2026-01-01T00:00:00.000Z',
  embeddingProvider: 'lmstudio',
  embeddingModel: 'model',
  embeddingDimensions: 768,
  model: 'model',
  modelId: 'model',
  lock: {
    embeddingProvider: 'lmstudio',
    embeddingModel: 'model',
    embeddingDimensions: 768,
    lockedModelId: 'model',
    modelId: 'model',
  },
  counts: { files: 0, chunks: 0, embedded: 0 },
  lastError: null,
});

class SubflowChat extends ChatInterface {
  constructor(
    private readonly slowDelayMs: number,
    private readonly onExecute?: (params: {
      message: string;
      flags: Record<string, unknown>;
      conversationId: string;
    }) => void,
  ) {
    super();
  }

  async execute(
    message: string,
    flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _model;
    this.onExecute?.({ message, flags, conversationId });
    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    if (abortIfNeeded()) return;
    this.emit('thread', { type: 'thread', threadId: conversationId });

    if (message.includes('slow child')) {
      await delay(this.slowDelayMs);
      if (abortIfNeeded()) return;
    }

    if (message.includes('slow child fail')) {
      await delay(this.slowDelayMs);
      if (abortIfNeeded()) return;
      this.emit('error', { type: 'error', message: 'child failed' });
      return;
    }

    if (message.includes('child fail')) {
      this.emit('error', { type: 'error', message: 'child failed' });
      return;
    }

    if (
      message.includes(
        'Answer with JSON only: {"answer":"yes"} or {"answer":"no"}.',
      )
    ) {
      this.emit('final', {
        type: 'final',
        content: '{"answer":"yes"}',
      });
      this.emit('complete', { type: 'complete', threadId: conversationId });
      return;
    }

    if (abortIfNeeded()) return;
    this.emit('final', { type: 'final', content: 'child ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error('Timed out waiting for condition');
};

const waitForAssistantStatus = async (
  conversationId: string,
  status: 'ok' | 'failed' | 'stopped',
  timeoutMs = 5000,
) => {
  await waitFor(() => {
    const turns = memoryTurns.get(conversationId) ?? [];
    return turns.some(
      (turn) => turn.role === 'assistant' && turn.status === status,
    );
  }, timeoutMs);
  const turns = memoryTurns.get(conversationId) ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'assistant' && turn.status === status) {
      return turn;
    }
  }
  return undefined;
};

const waitForActiveSubflows = async (conversationId: string) => {
  await waitFor(() => {
    const conversation = memoryConversations.get(conversationId);
    return Array.isArray(
      (
        conversation?.flags as
          | { flow?: { activeSubflows?: unknown } }
          | undefined
      )?.flow?.activeSubflows,
    );
  });
  const conversation = memoryConversations.get(conversationId);
  return ((
    conversation?.flags as {
      flow?: { activeSubflows?: Record<string, unknown>[] };
    }
  )?.flow?.activeSubflows ?? []) as Record<string, unknown>[];
};

const waitForActiveSubflow = async (conversationId: string) => {
  const activeSubflows = await waitForActiveSubflows(conversationId);
  return activeSubflows[0] ?? null;
};

const waitForActiveSubflowCount = async (
  conversationId: string,
  expectedCount: number,
) => {
  await waitFor(() => {
    const conversation = memoryConversations.get(conversationId);
    const activeSubflows =
      (
        conversation?.flags as
          | { flow?: { activeSubflows?: unknown[] } }
          | undefined
      )?.flow?.activeSubflows ?? [];
    return (
      Array.isArray(activeSubflows) && activeSubflows.length === expectedCount
    );
  });
  return waitForActiveSubflows(conversationId);
};

const waitForConversationAssistantStatus = async (
  conversationId: string,
  status: 'ok' | 'failed' | 'stopped',
  timeoutMs = 5000,
) => {
  await waitFor(() => {
    const turns = memoryTurns.get(conversationId) ?? [];
    return turns.some(
      (turn) => turn.role === 'assistant' && turn.status === status,
    );
  }, timeoutMs);
};

const writeFlowFile = async (params: {
  tmpDir: string;
  flowName: string;
  steps: unknown[];
}) => {
  await fs.writeFile(
    path.join(params.tmpDir, `${params.flowName}.json`),
    JSON.stringify(
      {
        description: params.flowName,
        steps: params.steps,
      },
      null,
      2,
    ),
    'utf8',
  );
};

const llmStep = (content: string) => ({
  type: 'llm' as const,
  label: 'Child Step',
  agentType: 'planning_agent',
  identifier: 'planner',
  messages: [{ role: 'user' as const, content: [content] }],
});

const continueStep = (question: string) => ({
  type: 'continue' as const,
  agentType: 'planning_agent',
  identifier: 'planner',
  question,
  continueOn: 'yes' as const,
});

const subflowStep = (label: string, ...flowNames: string[]) => ({
  type: 'subflow' as const,
  label,
  flowNames,
});

const REVIEW_PLAN_MARKDOWN = `# Story 27

## Description

Review the intended behavior.

## Acceptance Criteria

- The review completes.

## Out Of Scope

- Planning file review.
`;

const writeExecutable = async (filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf8');
  await fs.chmod(filePath, 0o755);
};

const codexReviewPointerPath = (
  repoDir: string,
  outputKey = 'current-codex-review',
) => path.join(repoDir, 'codeInfoTmp', 'reviews', `0000027-${outputKey}.json`);

const initializeCodexReviewRepo = async (repoDir: string) => {
  await fs.mkdir(repoDir, { recursive: true });
  await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
  await execFile('git', ['config', 'user.email', 'codex@example.com'], {
    cwd: repoDir,
  });
  await execFile('git', ['config', 'user.name', 'Codex Test'], {
    cwd: repoDir,
  });
  await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
  await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(repoDir, '.gitignore'),
    'codeInfoTmp/\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(repoDir, 'planning', '0000027-codex-review.md'),
    REVIEW_PLAN_MARKDOWN,
    'utf8',
  );
  await fs.writeFile(
    path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
    JSON.stringify({
      plan_path: 'planning/0000027-codex-review.md',
      branched_from: 'main',
    }),
    'utf8',
  );
  await execFile('git', ['add', '.'], { cwd: repoDir });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
  await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
    cwd: repoDir,
  });
};

const seedStaleCodexReviewPointer = async (repoDir: string) => {
  const pointerPath = codexReviewPointerPath(repoDir);
  await fs.mkdir(path.dirname(pointerPath), { recursive: true });
  await fs.writeFile(
    pointerPath,
    `${JSON.stringify(
      {
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        codex_review_pass_id: 'stale-codex-review-pass',
        review_output_file: 'codeInfoTmp/reviews/stale-codex-review.md',
        status: 'completed',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return pointerPath;
};

const activeSubflowState = (params: {
  stepPath: number[];
  flowName: string;
  conversationId: string;
  runToken: string;
  title?: string;
}) => ({
  stepPath: params.stepPath,
  flowName: params.flowName,
  conversationId: params.conversationId,
  runToken: params.runToken,
  ...(params.title ? { title: params.title } : {}),
});

const findChildFlowConversation = (params: {
  parentConversationId: string;
  childFlowName: string;
}) =>
  Array.from(memoryConversations.values()).find(
    (conversation) =>
      conversation._id !== params.parentConversationId &&
      conversation.flowName === params.childFlowName,
  );

const findChildFlowConversations = (params: {
  parentConversationId: string;
  childFlowNames: string[];
}) =>
  Array.from(memoryConversations.values()).filter(
    (conversation) =>
      conversation._id !== params.parentConversationId &&
      params.childFlowNames.includes(String(conversation.flowName ?? '')),
  );

let previousAgentsHome: string | undefined;
let previousFlowsDir: string | undefined;

beforeEach(() => {
  previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  previousFlowsDir = process.env.FLOWS_DIR;
  installDeterministicCodexAvailabilityBootstrap();
  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  memoryConversations.clear();
  memoryTurns.clear();
});

afterEach(async () => {
  resetDeterministicCodexAvailabilityBootstrap();
  __resetProviderBootstrapStatusForTests();
  if (previousAgentsHome === undefined) {
    delete process.env.CODEINFO_CODEX_AGENT_HOME;
  } else {
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
  }
  if (previousFlowsDir === undefined) {
    delete process.env.FLOWS_DIR;
  } else {
    process.env.FLOWS_DIR = previousFlowsDir;
  }
  memoryConversations.clear();
  memoryTurns.clear();
});

test('subflow step launches a child flow, waits for completion, and uses the generated child title', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-ok-'));
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-ok',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-ok',
      steps: [subflowStep('Run Child', 'child-ok')],
    });

    const result = await startFlowRun({
      flowName: 'parent-ok',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(150),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');

    const childConversation = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-ok',
    });
    assert.ok(childConversation);
    assert.notEqual(childConversation?._id, result.conversationId);
    assert.equal(childConversation?.title, 'Parent Review-Run Child');

    const parentTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.ok(
      parentTurns.some(
        (turn) =>
          turn.role === 'user' && turn.content === 'Run subflow child-ok',
      ),
    );
    assert.ok(
      parentTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          turn.content === 'Completed subflow Parent Review-Run Child',
      ),
    );

    const parentConversation = memoryConversations.get(result.conversationId);
    assert.equal(
      (
        parentConversation?.flags as
          | { flow?: { activeSubflows?: unknown } }
          | undefined
      )?.flow?.activeSubflows,
      undefined,
    );
  } finally {
    resetDeterministicCodexAvailabilityBootstrap();
    installDeterministicCodexAvailabilityBootstrap();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow step launches multiple child flows in parallel and waits for all of them before continuing', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-parallel-ok-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fast',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-parallel',
      steps: [subflowStep('Run Child Batch', 'child-fast', 'child-slow')],
    });

    const result = await startFlowRun({
      flowName: 'parent-parallel',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(140),
    });

    const activeSubflows = await waitForActiveSubflowCount(
      result.conversationId,
      2,
    );
    assert.equal(activeSubflows.length, 2);

    const childConversations = findChildFlowConversations({
      parentConversationId: result.conversationId,
      childFlowNames: ['child-fast', 'child-slow'],
    });
    assert.equal(childConversations.length, 2);
    assert.equal(
      childConversations.some(
        (conversation) =>
          conversation.title === 'Parent Review-Run Child Batch-child-fast',
      ),
      true,
    );
    assert.equal(
      childConversations.some(
        (conversation) =>
          conversation.title === 'Parent Review-Run Child Batch-child-slow',
      ),
      true,
    );

    const fastChild = childConversations.find(
      (conversation) => conversation.flowName === 'child-fast',
    );
    const slowChild = childConversations.find(
      (conversation) => conversation.flowName === 'child-slow',
    );
    assert.ok(fastChild?._id);
    assert.ok(slowChild?._id);

    await waitForConversationAssistantStatus(String(fastChild?._id), 'ok');
    await delay(40);
    const parentTurnsBeforeSlowChildCompletes =
      memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsBeforeSlowChildCompletes.some(
        (turn) => turn.role === 'assistant',
      ),
      false,
    );

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'ok',
    );
    assert.equal(
      finalAssistant?.content,
      'Completed subflows Parent Review-Run Child Batch-child-fast, Parent Review-Run Child Batch-child-slow',
    );

    const parentTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.ok(
      parentTurns.some(
        (turn) =>
          turn.role === 'user' &&
          turn.content === 'Run subflows child-fast, child-slow',
      ),
    );
    const parentConversation = memoryConversations.get(result.conversationId);
    assert.equal(
      (
        parentConversation?.flags as
          | { flow?: { activeSubflows?: unknown } }
          | undefined
      )?.flow?.activeSubflows,
      undefined,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow forwards codexReviewModelId into child flows so codex_review can run with a parent-supplied model override', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-codex-model-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  process.env.FLOWS_DIR = tmpDir;

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });
    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'codex-child',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          reasoningEffort: 'medium',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-codex-subflow',
      steps: [subflowStep('Run Codex Review Child', 'codex-child')],
    });

    const result = await startFlowRun({
      flowName: 'parent-codex-subflow',
      source: 'REST',
      working_folder: repoDir,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');

    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
      model?: string;
      reasoning_effort?: string | null;
      merged_into_canonical_findings?: boolean;
    };

    assert.equal(pointer.model, 'gpt-5.4');
    assert.equal(pointer.reasoning_effort, 'medium');
    assert.equal(pointer.merged_into_canonical_findings, false);
    const validation = await validateReviewArtifacts({
      workingRepositoryPath: repoDir,
      pointerKeys: ['current-codex-review'],
    });
    assert.equal(validation.status, 'passed');
    assert.deepEqual(validation.errors, []);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview resolves model and reasoning effort from its configured agent', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-agent-profile-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const agentsHome = path.join(tmpDir, 'codeinfo_agents');
  const agentHome = path.join(agentsHome, 'review_agent_heavy');
  const previousPath = process.env.PATH;
  const previousPreferredAgentHome = process.env.CODEINFO_AGENT_HOME;
  process.env.FLOWS_DIR = tmpDir;

  resetDeterministicCodexAvailabilityBootstrap();
  installDeterministicCodexAvailabilityBootstrap({
    models: [
      {
        model: 'gpt-5.6-sol',
        supportedReasoningEfforts: ['high', 'xhigh'],
        defaultReasoningEffort: 'high',
      },
    ],
  });

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(agentHome, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;
    process.env.CODEINFO_AGENT_HOME = agentsHome;
    await fs.writeFile(
      path.join(agentHome, 'config.toml'),
      [
        'codeinfo_provider = "codex"',
        'model = "gpt-5.6-sol"',
        'model_reasoning_effort = "xhigh"',
        'approval_policy = "never"',
        'sandbox_mode = "danger-full-access"',
      ].join('\n'),
      'utf8',
    );
    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );
    await writeFlowFile({
      tmpDir,
      flowName: 'agent-backed-codex-review',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Agent-Backed Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step_or_agent',
          agentType: 'review_agent_heavy',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'agent-backed-codex-review',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    assert.equal(result.modelId, 'gpt-5.6-sol');
    await waitForAssistantStatus(result.conversationId, 'ok');

    const pointer = JSON.parse(
      await fs.readFile(codexReviewPointerPath(repoDir), 'utf8'),
    ) as {
      model?: string;
      reasoning_effort?: string | null;
      agent_type?: string | null;
    };
    assert.equal(pointer.model, 'gpt-5.6-sol');
    assert.equal(pointer.reasoning_effort, 'xhigh');
    assert.equal(pointer.agent_type, 'review_agent_heavy');
  } finally {
    process.env.PATH = previousPath;
    if (previousPreferredAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousPreferredAgentHome;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume skips validating a completed codexReview step when resuming at the next step', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-resume-validation-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'resume-codex-review',
      steps: [
        {
          type: 'codexReview',
          label: 'Completed Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
        },
        llmStep('after resumed codex review'),
      ],
    });

    const conversationId = 'resume-codex-review-conversation';
    const now = new Date();
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Codex Review',
      flowName: 'resume-codex-review',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-codex-review-execution',
          stepPath: [0],
          loopStack: [],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const executions: string[] = [];
    const resumed = await startFlowRun({
      flowName: 'resume-codex-review',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
    });

    assert.equal(resumed.conversationId, conversationId);
    await waitForAssistantStatus(conversationId, 'ok');
    assert.deepEqual(executions, ['after resumed codex review']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview ignores a stale pending cancel that belongs to a different run token', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-stale-pending-cancel-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  process.env.FLOWS_DIR = tmpDir;

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'codex-stale-pending-cancel',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'codex-stale-pending-cancel',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken: `${runToken}-stale`,
        });
      },
    });

    await waitForAssistantStatus(result.conversationId, 'ok');
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    assert.equal(existsSync(pointerPath), true);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('prepareReviewBase consumes a pending cancel before starting review-base git work', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-prepare-review-base-pending-cancel-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await fs.mkdir(repoDir, { recursive: true });

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeFlowFile({
      tmpDir,
      flowName: 'prepare-review-base-stop',
      steps: [
        {
          type: 'prepareReviewBase',
          label: 'Prepare Shared Review Base',
          outputKey: 'current-review-base',
          basePolicy: 'branched_from_or_default_if_merged',
        },
      ],
    });

    const result = await startFlowRun({
      flowName: 'prepare-review-base-stop',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });

    await waitForAssistantStatus(result.conversationId, 'stopped');
    assert.equal(
      existsSync(
        path.join(
          repoDir,
          'codeInfoTmp',
          'reviews',
          '0000027-current-review-base.json',
        ),
      ),
      false,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('sourceId-only launches support prepareReviewBase and codexReview without working_folder', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-sourceid-review-steps-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const repoFlowsDir = path.join(repoDir, 'flows');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  const previousFlowsDir = process.env.FLOWS_DIR;
  process.env.FLOWS_DIR = path.join(tmpDir, 'local-flows-unused');

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(repoFlowsDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await fs.writeFile(
      path.join(repoFlowsDir, 'sourceid-review.json'),
      JSON.stringify({
        steps: [
          {
            type: 'prepareReviewBase',
            label: 'Prepare Shared Review Base',
            outputKey: 'current-review-base',
            basePolicy: 'branched_from_or_default_if_merged',
          },
          {
            type: 'codexReview',
            label: 'Run Codex Review',
            outputKey: 'current-codex-review',
            basePolicy: 'branched_from_or_default_if_merged',
            modelSource: 'flow_request_or_step',
            reasoningEffort: 'medium',
          },
        ],
      }),
      'utf8',
    );

    const result = await startFlowRun({
      flowName: 'sourceid-review',
      source: 'REST',
      sourceId: repoDir,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    assert.equal(result.providerId, 'codex');
    assert.equal(result.modelId, 'gpt-5.4');
    await waitForAssistantStatus(result.conversationId, 'ok');
    const preparedBasePath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-review-base.json',
    );
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    await waitFor(() => existsSync(preparedBasePath));
    await waitFor(() => existsSync(pointerPath));
    assert.equal(existsSync(preparedBasePath), true);
    assert.equal(existsSync(pointerPath), true);
  } finally {
    process.env.PATH = previousPath;
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('local review-git flows fail instead of silently targeting the harness repo', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-local-review-base-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const previousPreferredAgentHome = process.env.CODEINFO_AGENT_HOME;
  const previousAgentHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  const previousFlowsDir = process.env.FLOWS_DIR;

  try {
    await fs.mkdir(path.join(repoDir, 'flows'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.mkdir(path.join(repoDir, 'codeinfo_agents'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codex_agents'), { recursive: true });
    process.env.CODEINFO_AGENT_HOME = path.join(repoDir, 'codeinfo_agents');
    process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoDir, 'codex_agents');
    process.env.FLOWS_DIR = path.join(repoDir, 'flows');

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'flows', 'local-review-base.json'),
      JSON.stringify({
        description: 'Local review base',
        steps: [
          {
            type: 'prepareReviewBase',
            label: 'Prepare Shared Review Base',
            outputKey: 'current-review-base',
            basePolicy: 'branched_from_or_default_if_merged',
          },
        ],
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    const result = await startFlowRun({
      flowName: 'local-review-base',
      source: 'REST',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    assert.ok(result.conversationId);
    await waitForAssistantStatus(result.conversationId, 'failed', 15_000);
    assert.equal(
      existsSync(
        path.join(
          repoDir,
          'codeInfoTmp',
          'reviews',
          '0000027-current-review-base.json',
        ),
      ),
      false,
    );
  } finally {
    if (previousPreferredAgentHome === undefined) {
      delete process.env.CODEINFO_AGENT_HOME;
    } else {
      process.env.CODEINFO_AGENT_HOME = previousPreferredAgentHome;
    }
    if (previousAgentHome === undefined) {
      delete process.env.CODEINFO_CODEX_AGENT_HOME;
    } else {
      process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentHome;
    }
    if (previousFlowsDir === undefined) {
      delete process.env.FLOWS_DIR;
    } else {
      process.env.FLOWS_DIR = previousFlowsDir;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test(
  'parent flows continue best-effort when child codexReview work is unavailable',
  { concurrency: false },
  async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'flow-subflow-codex-preflight-'),
    );
    process.env.FLOWS_DIR = tmpDir;

    try {
      await writeFlowFile({
        tmpDir,
        flowName: 'child-codex-review',
        steps: [
          {
            type: 'codexReview',
            label: 'Run Codex Review',
            outputKey: 'current-codex-review',
            basePolicy: 'branched_from_or_default_if_merged',
            modelSource: 'flow_request_or_step',
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
          },
        ],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'parent-preflight',
        steps: [
          subflowStep('Run Codex Review Child', 'child-codex-review'),
          llmStep('parent after unavailable child codex review'),
        ],
      });

      __setProviderBootstrapStatusForTests('codex', {
        healthy: false,
        reason: 'codex unavailable for parent preflight',
        warnings: [],
      });

      const executions: string[] = [];
      const result = await startFlowRun({
        flowName: 'parent-preflight',
        source: 'REST',
        working_folder: repoRoot,
        chatFactory: () =>
          new SubflowChat(25, ({ message }) => {
            executions.push(message);
          }),
        listIngestedRepositories: async () => ({
          repos: [buildRepoEntry(repoRoot)],
          lockedModelId: null,
        }),
      });
      await waitFor(() =>
        executions.includes('parent after unavailable child codex review'),
      );
      await waitForAssistantStatus(result.conversationId, 'ok');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test('parent flows continue best-effort when child codexReview model requirements are missing', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-codex-model-validation-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-codex-review-missing-model',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-codex-model-validation',
      steps: [
        subflowStep(
          'Run Codex Review Child',
          'child-codex-review-missing-model',
        ),
        llmStep('parent after child codex model skip'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-codex-model-validation',
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });
    await waitFor(() =>
      executions.includes('parent after child codex model skip'),
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent flows continue best-effort when child command steps are invalid', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-command-validation-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-command-validation',
      steps: [
        {
          type: 'command',
          label: 'Missing Child Command',
          agentType: 'planning_agent',
          identifier: 'planner',
          commandName: 'missing-child-command',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-command-validation',
      steps: [
        subflowStep('Run Child Command', 'child-command-validation'),
        llmStep('parent after child command failure'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-command-validation',
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });
    await waitFor(() =>
      executions.includes('parent after child command failure'),
    );
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 0 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume skips validating child subflow commands that are already behind resumeStepPath', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-command-resume-validation-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-command-resume-validation',
      steps: [
        {
          type: 'command',
          label: 'Removed Child Command',
          agentType: 'planning_agent',
          identifier: 'planner',
          commandName: 'missing-child-command',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-command-resume-validation',
      steps: [
        subflowStep(
          'Completed Child Command',
          'child-command-resume-validation',
        ),
        llmStep('after resumed child subflow'),
      ],
    });

    const conversationId = 'resume-child-command-validation-conversation';
    const now = new Date();
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Child Command Validation',
      flowName: 'parent-command-resume-validation',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-child-command-validation-execution',
          stepPath: [0],
          loopStack: [],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const executions: string[] = [];
    const resumed = await startFlowRun({
      flowName: 'parent-command-resume-validation',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      working_folder: repoRoot,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    assert.equal(resumed.conversationId, conversationId);
    await waitForAssistantStatus(conversationId, 'ok');
    assert.deepEqual(executions, ['after resumed child subflow']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed flows reuse persisted codexReviewModelId for pending codexReview steps', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-resume-codex-model-id-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  process.env.FLOWS_DIR = tmpDir;

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'resume-pending-codex-model',
      steps: [
        llmStep('before review'),
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          reasoningEffort: 'medium',
        },
      ],
    });

    const conversationId = 'resume-pending-codex-model-conversation';
    const now = new Date();
    memoryConversations.set(conversationId, {
      _id: conversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Pending Codex Model',
      flowName: 'resume-pending-codex-model',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-pending-codex-model-execution',
          stepPath: [0],
          loopStack: [],
          codexReviewModelId: 'gpt-5.4',
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'resume-pending-codex-model',
      conversationId,
      resumeStepPath: [0],
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    assert.equal(resumed.conversationId, conversationId);
    await waitForAssistantStatus(conversationId, 'ok');
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    await waitFor(() => {
      if (!existsSync(pointerPath)) return false;
      try {
        return (
          (JSON.parse(readFileSync(pointerPath, 'utf8')) as { status?: string })
            .status === 'completed'
        );
      } catch {
        return false;
      }
    });
    const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
      model: string;
    };
    assert.equal(pointer.model, 'gpt-5.4');
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('flow step-boundary persistence keeps request-scoped codexReviewModelId', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-runtime-codex-model-persist-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'persist-requested-codex-model',
      steps: [llmStep('before review')],
    });

    const result = await startFlowRun({
      flowName: 'persist-requested-codex-model',
      source: 'REST',
      working_folder: repoRoot,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(25),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoRoot)],
        lockedModelId: null,
      }),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');
    const flowState = (
      memoryConversations.get(result.conversationId)?.flags as
        | { flow?: { codexReviewModelId?: string } }
        | undefined
    )?.flow;
    assert.equal(flowState?.codexReviewModelId, 'gpt-5.4');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test(
  'resumed flows continue best-effort for later Codex work after resuming inside loops',
  { concurrency: false },
  async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'flow-resume-loop-codex-preflight-'),
    );
    process.env.FLOWS_DIR = tmpDir;

    try {
      await writeFlowFile({
        tmpDir,
        flowName: 'child-codex-review',
        steps: [
          {
            type: 'codexReview',
            label: 'Run Codex Review',
            outputKey: 'current-codex-review',
            basePolicy: 'branched_from_or_default_if_merged',
            modelSource: 'flow_request_or_step',
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
          },
        ],
      });
      await writeFlowFile({
        tmpDir,
        flowName: 'resume-loop-parent',
        steps: [
          {
            type: 'startLoop',
            label: 'Outer Loop',
            steps: [llmStep('loop step')],
          },
          subflowStep('Run Codex Review Child', 'child-codex-review'),
        ],
      });

      const conversationId = 'resume-loop-parent-conversation';
      const now = new Date();
      memoryConversations.set(conversationId, {
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        title: 'Resume Loop Parent',
        flowName: 'resume-loop-parent',
        source: 'REST',
        flags: {
          flow: {
            executionId: 'resume-loop-parent-execution',
            stepPath: [0, 0],
            loopStack: [],
            agentConversations: {},
            agentThreads: {},
          },
        },
        lastMessageAt: now,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      } as Conversation);

      __setProviderBootstrapStatusForTests('codex', {
        healthy: false,
        reason: 'codex unavailable for resume loop preflight',
        warnings: [],
      });

      const result = await startFlowRun({
        flowName: 'resume-loop-parent',
        conversationId,
        resumeStepPath: [0, 0],
        source: 'REST',
        working_folder: repoRoot,
        chatFactory: () => new SubflowChat(25),
        listIngestedRepositories: async () => ({
          repos: [buildRepoEntry(repoRoot)],
          lockedModelId: null,
        }),
      });
      assert.equal(result.conversationId, conversationId);
      await waitForAssistantStatus(conversationId, 'ok');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  },
);

test('prepareReviewBase can precede a parallel review subflow batch on the shared checkout', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-review-base-parallel-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  process.env.FLOWS_DIR = tmpDir;

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await fs.mkdir(path.join(repoDir, 'codeInfoTmp', 'reviews'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        repoDir,
        'codeInfoTmp',
        'reviews',
        '0000027-current-review.json',
      ),
      JSON.stringify({
        story_id: '0000027',
        review_pass_id: '0000027-20260703T175948Z-f2f7904eb-stale',
        head_commit: 'f'.repeat(40),
        status: 'completed',
      }),
      'utf8',
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow-review',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-child-review',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          reasoningEffort: 'medium',
        },
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-shared-review-base',
      steps: [
        {
          type: 'prepareReviewBase',
          label: 'Prepare Shared Review Base',
          outputKey: 'current-review-base',
          basePolicy: 'branched_from_or_default_if_merged',
        },
        subflowStep(
          'Run Review Batch',
          'child-slow-review',
          'codex-child-review',
        ),
      ],
    });

    const result = await startFlowRun({
      flowName: 'parent-shared-review-base',
      customTitle: 'Parent Review',
      source: 'REST',
      working_folder: repoDir,
      codexReviewModelId: 'gpt-5.4',
      chatFactory: () => new SubflowChat(140),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitForActiveSubflowCount(result.conversationId, 2);

    const basePath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-review-base.json',
    );
    const pointerPath = path.join(
      repoDir,
      'codeInfoTmp',
      'reviews',
      '0000027-current-codex-review.json',
    );
    await waitFor(() => {
      if (!existsSync(pointerPath)) return false;
      try {
        return (
          (JSON.parse(readFileSync(pointerPath, 'utf8')) as { status?: string })
            .status === 'completed'
        );
      } catch {
        return false;
      }
    });
    await waitForAssistantStatus(result.conversationId, 'ok');
    const preparedBase = JSON.parse(await fs.readFile(basePath, 'utf8')) as {
      comparison_base_ref?: string;
      review_session_id?: string;
      review_pass_id?: string;
    };
    const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
      comparison_base_ref?: string;
      model?: string;
      reasoning_effort?: string | null;
      review_session_id?: string;
      canonical_review_pass_id?: string;
    };

    assert.equal(preparedBase.comparison_base_ref, 'main');
    assert.equal(pointer.comparison_base_ref, 'main');
    assert.equal(pointer.model, 'gpt-5.4');
    assert.equal(pointer.reasoning_effort, 'medium');
    assert.equal(pointer.review_session_id, preparedBase.review_session_id);
    assert.equal(pointer.canonical_review_pass_id, preparedBase.review_pass_id);
    assert.notEqual(
      pointer.canonical_review_pass_id,
      '0000027-20260703T175948Z-f2f7904eb-stale',
    );
    assert.equal(
      (await fs.readdir(path.dirname(pointerPath))).some((name) =>
        name.startsWith('13-'),
      ),
      false,
    );
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent step after a successful codexReview gets a fresh inflight id', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-inflight-rotation-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  process.env.FLOWS_DIR = tmpDir;

  try {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

    await execFile('git', ['init', '-b', 'main'], { cwd: repoDir });
    await execFile('git', ['config', 'user.email', 'codex@example.com'], {
      cwd: repoDir,
    });
    await execFile('git', ['config', 'user.name', 'Codex Test'], {
      cwd: repoDir,
    });
    await fs.mkdir(path.join(repoDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'codeInfoStatus', 'flow-state'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, '.gitignore'),
      'codeInfoTmp/\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      REVIEW_PLAN_MARKDOWN,
      'utf8',
    );
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      JSON.stringify({
        plan_path: 'planning/0000027-codex-review.md',
        branched_from: 'main',
      }),
      'utf8',
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'init'], { cwd: repoDir });
    await execFile('git', ['checkout', '-b', 'feature/0000027-codex-review'], {
      cwd: repoDir,
    });

    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$out")"
printf '# Codex Review\\n\\nNo issues.\\n' > "$out"
`,
    );

    await writeFlowFile({
      tmpDir,
      flowName: 'codex-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
        llmStep('parent after codex review'),
      ],
    });

    const executions: Array<{
      message: string;
      conversationId: string;
      inflightId: string | null;
    }> = [];
    const result = await startFlowRun({
      flowName: 'codex-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message, flags, conversationId }) => {
          executions.push({
            message,
            conversationId,
            inflightId:
              typeof flags.inflightId === 'string' ? flags.inflightId : null,
          });
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() => executions.length === 1);
    await waitForAssistantStatus(result.conversationId, 'ok');

    const followUpExecution = executions[0];
    assert.ok(followUpExecution);
    assert.equal(followUpExecution?.message, 'parent after codex review');
    assert.equal(typeof followUpExecution?.inflightId, 'string');
    assert.notEqual(followUpExecution?.inflightId, result.inflightId);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview steps skip cleanly when Codex is unavailable and later parent steps still run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-skip-unavailable-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-skip-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
        llmStep('parent after skipped codex review'),
      ],
    });
    const pointerPath = await seedStaleCodexReviewPointer(repoDir);

    __setProviderBootstrapStatusForTests('codex', {
      healthy: false,
      reason: 'codex unavailable for direct skip',
      warnings: [],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'codex-skip-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() =>
      executions.includes('parent after skipped codex review'),
    );
    assert.equal(existsSync(pointerPath), false);
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('Codex review skipped.') &&
          String(turn.content).includes('codex unavailable for direct skip'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview steps skip cleanly when no review model can be resolved and later parent steps still run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-skip-missing-model-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-missing-model-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
        },
        llmStep('parent after skipped missing-model codex review'),
      ],
    });
    const pointerPath = await seedStaleCodexReviewPointer(repoDir);

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'codex-missing-model-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() =>
      executions.includes('parent after skipped missing-model codex review'),
    );
    assert.equal(existsSync(pointerPath), false);
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('Codex review skipped.') &&
          String(turn.content).includes(
            'codexReview requires codexReviewModelId, a model on the flow step, or a model from its configured agent.',
          ),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('codexReview clears a stale pointer when the Codex run fails and later parent steps still run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-codex-review-skip-failing-run-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  const binDir = path.join(tmpDir, 'bin');
  const previousPath = process.env.PATH;
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.mkdir(binDir, { recursive: true });
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;
    await writeExecutable(
      path.join(binDir, 'codex'),
      `#!/usr/bin/env bash
set -euo pipefail
echo "codex failed" >&2
exit 1
`,
    );
    await writeFlowFile({
      tmpDir,
      flowName: 'codex-failing-run-then-llm',
      steps: [
        {
          type: 'codexReview',
          label: 'Run Codex Review',
          outputKey: 'current-codex-review',
          basePolicy: 'branched_from_or_default_if_merged',
          modelSource: 'flow_request_or_step',
          model: 'gpt-5.4',
          reasoningEffort: 'medium',
        },
        llmStep('parent after failed codex review'),
      ],
    });
    const pointerPath = await seedStaleCodexReviewPointer(repoDir);

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'codex-failing-run-then-llm',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => {
          executions.push(message);
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() =>
      executions.includes('parent after failed codex review'),
    );
    assert.equal(existsSync(pointerPath), false);
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('Codex review skipped.'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('validateReviewArtifacts records stale child evidence and continues the parent', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-review-artifacts-validation-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    const headCommit = (
      await execFile('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repoDir })
    ).stdout.trim();
    const reviewDir = path.join(repoDir, 'codeInfoTmp', 'reviews');
    await fs.mkdir(reviewDir, { recursive: true });
    const identity = {
      story_id: '0000027',
      plan_path: 'planning/0000027-codex-review.md',
      review_session_id: '0000027-rs-20260713T102726Z-d30c1246-session',
      review_pass_id: '0000027-20260713T102726Z-d30c1246-session',
      parent_execution_id: 'parent-execution-27',
      head_commit: headCommit,
      comparison_base_commit: headCommit,
    };
    const contextMarkdown = [
      '## Description\n\nReview the intended behavior.',
      '## Acceptance Criteria\n\n- The review completes.',
      '## Out Of Scope\n\n- Planning file review.',
    ].join('\n\n');
    const scope = {
      repo_alias: 'current_repository',
      repo_root: repoDir,
      branch: 'feature/0000027-codex-review',
      branched_from: 'main',
      logical_base_branch: 'main',
      resolved_base_branch: 'main',
      resolved_base_source: 'local_fallback',
      remote_name: 'origin',
      remote_fetch_status: 'missing_remote',
      local_fallback_reason: 'missing_remote',
      comparison_base_ref: 'main',
      comparison_head_ref: 'HEAD',
      comparison_rule: 'local_head_vs_resolved_base',
      review_context_file:
        'codeInfoTmp/reviews/0000027-current-review-context.json',
      review_context_sha256: crypto
        .createHash('sha256')
        .update(contextMarkdown)
        .digest('hex'),
      review_context_source_plan_sha256: crypto
        .createHash('sha256')
        .update(REVIEW_PLAN_MARKDOWN)
        .digest('hex'),
      review_excluded_paths: ['planning/**'],
    };
    const currentRepository = {
      repo_alias: scope.repo_alias,
      repo_root: scope.repo_root,
      branch: scope.branch,
      logical_base_branch: scope.logical_base_branch,
      resolved_base_branch: scope.resolved_base_branch,
      resolved_base_source: scope.resolved_base_source,
      remote_name: scope.remote_name,
      remote_fetch_status: scope.remote_fetch_status,
      local_fallback_reason: scope.local_fallback_reason,
      comparison_base_ref: scope.comparison_base_ref,
      comparison_base_commit: identity.comparison_base_commit,
      comparison_head_ref: scope.comparison_head_ref,
      comparison_rule: scope.comparison_rule,
      head_commit: identity.head_commit,
    };
    await Promise.all([
      fs.writeFile(path.join(reviewDir, 'evidence.md'), '# Evidence\n'),
      fs.writeFile(path.join(reviewDir, 'findings.md'), '# Findings\n'),
      fs.writeFile(path.join(reviewDir, 'codex.md'), '# Codex\n'),
      fs.writeFile(
        path.join(reviewDir, '0000027-current-review-context.json'),
        JSON.stringify({
          schema_version: 'codeinfo-review-context/v1',
          story_id: identity.story_id,
          plan_path: identity.plan_path,
          branch: scope.branch,
          source_plan_sha256: scope.review_context_source_plan_sha256,
          context_sha256: scope.review_context_sha256,
          sections: {
            overview: {
              source_heading: 'Description',
              markdown: '## Description\n\nReview the intended behavior.',
            },
            acceptance_criteria: {
              source_heading: 'Acceptance Criteria',
              markdown: '## Acceptance Criteria\n\n- The review completes.',
            },
            out_of_scope: {
              source_heading: 'Out Of Scope',
              markdown: '## Out Of Scope\n\n- Planning file review.',
            },
          },
          excluded_paths: ['planning/**'],
          warnings: [],
          status: 'completed',
        }),
      ),
      fs.writeFile(
        path.join(reviewDir, '0000027-current-review-base.json'),
        JSON.stringify({ ...identity, ...scope, status: 'completed' }),
      ),
      fs.writeFile(
        path.join(reviewDir, '0000027-current-review.json'),
        JSON.stringify({
          ...identity,
          ...scope,
          evidence_file: 'codeInfoTmp/reviews/evidence.md',
          findings_file: 'codeInfoTmp/reviews/findings.md',
          repos: [currentRepository],
          status: 'completed',
        }),
      ),
      fs.writeFile(
        path.join(reviewDir, '0000027-current-codex-review.json'),
        JSON.stringify({
          ...identity,
          ...scope,
          review_session_id: '0000027-rs-20260703T175948Z-f2f7904eb-stale',
          canonical_review_pass_id: identity.review_pass_id,
          review_output_file: 'codeInfoTmp/reviews/codex.md',
          status: 'completed',
        }),
      ),
    ]);
    await writeFlowFile({
      tmpDir,
      flowName: 'validate-stale-review-session',
      steps: [
        {
          type: 'validateReviewArtifacts',
          label: 'Validate Joined Review Artifacts',
          pointerKeys: ['current-review', 'current-codex-review'],
        },
        llmStep('runs after stale review validation'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'validate-stale-review-session',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => executions.push(message)),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitFor(() =>
      executions.includes('runs after stale review validation'),
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
    assert.equal(
      executions.includes('runs after stale review validation'),
      true,
    );
    const blocker = JSON.parse(
      await fs.readFile(
        path.join(reviewDir, '0000027-current-review-validation.json'),
        'utf8',
      ),
    ) as { status?: string; errors?: string[] };
    assert.equal(blocker.status, 'partial');
    assert.match(blocker.errors?.join('\n') ?? '', /review_session_id/u);

    await Promise.all([
      fs.writeFile(
        path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
        JSON.stringify({
          plan_path: identity.plan_path,
          additional_repositories: { path: '/missing/repository' },
        }),
      ),
      fs.writeFile(
        path.join(reviewDir, '0000027-current-codex-review.json'),
        JSON.stringify({
          ...identity,
          ...scope,
          canonical_review_pass_id: identity.review_pass_id,
          codex_review_pass_id: `${identity.review_pass_id}-codex`,
          review_output_file: 'codeInfoTmp/reviews/codex.md',
          status: 'completed',
        }),
      ),
    ]);
    await writeFlowFile({
      tmpDir,
      flowName: 'validate-malformed-additional-scope',
      steps: [
        {
          type: 'validateReviewArtifacts',
          label: 'Validate Joined Review Artifacts',
          pointerKeys: ['current-review', 'current-codex-review'],
        },
        llmStep('runs after malformed additional scope'),
      ],
    });
    const malformedResult = await startFlowRun({
      flowName: 'validate-malformed-additional-scope',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => executions.push(message)),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });
    await waitFor(() =>
      executions.includes('runs after malformed additional scope'),
    );
    await waitForAssistantStatus(malformedResult.conversationId, 'ok');
    const malformedValidation = JSON.parse(
      await fs.readFile(
        path.join(reviewDir, '0000027-current-review-validation.json'),
        'utf8',
      ),
    ) as {
      status?: string;
      errors?: string[];
      fallback_findings_file?: string;
    };
    assert.equal(malformedValidation.status, 'partial');
    assert.match(
      malformedValidation.errors?.join('\n') ?? '',
      /must be an array/u,
    );
    assert.ok(malformedValidation.fallback_findings_file);

    const staleSession =
      '0000027-rs-20260703T175948Z-f2f7904eb-all-reviewers-stale';
    await Promise.all([
      fs.writeFile(
        path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
        JSON.stringify({ plan_path: identity.plan_path }),
      ),
      fs.writeFile(
        path.join(reviewDir, '0000027-current-review.json'),
        JSON.stringify({
          ...identity,
          ...scope,
          review_session_id: staleSession,
          evidence_file: 'codeInfoTmp/reviews/evidence.md',
          findings_file: 'codeInfoTmp/reviews/findings.md',
          repos: [currentRepository],
          status: 'completed',
        }),
      ),
      fs.writeFile(
        path.join(reviewDir, '0000027-current-codex-review.json'),
        JSON.stringify({
          ...identity,
          ...scope,
          review_session_id: staleSession,
          canonical_review_pass_id: identity.review_pass_id,
          codex_review_pass_id: `${identity.review_pass_id}-codex`,
          review_output_file: 'codeInfoTmp/reviews/codex.md',
          status: 'completed',
        }),
      ),
    ]);
    await writeFlowFile({
      tmpDir,
      flowName: 'validate-blocked-review-session',
      steps: [
        {
          type: 'validateReviewArtifacts',
          label: 'Validate Joined Review Artifacts',
          pointerKeys: ['current-review', 'current-codex-review'],
        },
        llmStep('runs after blocked review validation'),
      ],
    });
    const blockedResult = await startFlowRun({
      flowName: 'validate-blocked-review-session',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => executions.push(message)),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });
    await waitFor(() =>
      executions.includes('runs after blocked review validation'),
    );
    await waitForAssistantStatus(blockedResult.conversationId, 'ok');
    const blockedValidation = JSON.parse(
      await fs.readFile(
        path.join(reviewDir, '0000027-current-review-validation.json'),
        'utf8',
      ),
    ) as { status?: string };
    assert.equal(blockedValidation.status, 'blocked');
    const blockedTurns = memoryTurns.get(blockedResult.conversationId) ?? [];
    assert.equal(
      blockedTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes(
            'continuing without usable review evidence',
          ),
      ),
      true,
    );
    assert.equal(
      blockedTurns.some((turn) =>
        String(turn.content).includes(
          'continuing with usable review evidence',
        ),
      ),
      false,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parallel subflow waits for every child and continues best-effort when one child fails', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-parallel-fail-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fast-fail',
      steps: [llmStep('child fail')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow-success',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-parallel-fail',
      steps: [
        subflowStep(
          'Run Failure Batch',
          'child-fast-fail',
          'child-slow-success',
        ),
        llmStep('parent after best-effort subflow batch'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-parallel-fail',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(140, ({ message }) => {
          executions.push(message);
        }),
    });

    await waitFor(() =>
      Boolean(
        findChildFlowConversation({
          parentConversationId: result.conversationId,
          childFlowName: 'child-slow-success',
        }),
      ),
    );
    const slowChild = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-slow-success',
    });
    assert.ok(slowChild?._id);
    await waitForConversationAssistantStatus(String(slowChild?._id), 'ok');

    await waitFor(() =>
      executions.includes('parent after best-effort subflow batch'),
    );
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 1 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('nested subflows track only direct children per conversation and still complete recursively', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-nested-parallel-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'grandchild-ok',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-nested',
      steps: [subflowStep('Run Grandchild', 'grandchild-ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-direct',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-nested',
      steps: [subflowStep('Run Child Batch', 'child-nested', 'child-direct')],
    });

    const result = await startFlowRun({
      flowName: 'parent-nested',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(140),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');

    const nestedChild = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-nested',
    });
    assert.ok(nestedChild?._id);

    const directChild = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-direct',
    });
    assert.ok(directChild?._id);

    const grandchild = findChildFlowConversation({
      parentConversationId: String(nestedChild?._id),
      childFlowName: 'grandchild-ok',
    });
    assert.ok(grandchild?._id);

    const nestedFlags = memoryConversations.get(String(nestedChild?._id))
      ?.flags as { flow?: { activeSubflows?: unknown } } | undefined;
    assert.equal(nestedFlags?.flow?.activeSubflows, undefined);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent step after a successful subflow gets a fresh inflight id', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-inflight-rotation-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-ok',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-two-step',
      steps: [
        subflowStep('Run Child', 'child-ok'),
        llmStep('parent after subflow'),
      ],
    });

    const executions: Array<{
      message: string;
      conversationId: string;
      inflightId: string | null;
    }> = [];
    const result = await startFlowRun({
      flowName: 'parent-two-step',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(150, ({ message, flags, conversationId }) => {
          executions.push({
            message,
            conversationId,
            inflightId:
              typeof flags.inflightId === 'string' ? flags.inflightId : null,
          });
        }),
    });

    await waitFor(() => executions.length === 2);
    await waitForAssistantStatus(result.conversationId, 'ok');
    assert.equal(executions.length, 2);
    const parentFollowUpExecution = executions[1];
    assert.ok(parentFollowUpExecution);
    assert.equal(typeof parentFollowUpExecution?.inflightId, 'string');
    assert.notEqual(parentFollowUpExecution?.inflightId, result.inflightId);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow step keeps the parent flow running when a single child fails', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-fail-'));
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fail',
      steps: [llmStep('child fail')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-fail',
      steps: [
        subflowStep('Run Broken Child', 'child-fail'),
        llmStep('parent after failed child'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-fail',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(150, ({ message }) => {
          executions.push(message);
        }),
    });

    await waitFor(() => executions.includes('parent after failed child'));
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 0 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow waits for the full child flow and still continues best-effort after a later child failure', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-fail-later-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fail-later',
      steps: [llmStep('child ok'), llmStep('slow child fail')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-fail-later',
      steps: [
        subflowStep('Run Later Failure', 'child-fail-later'),
        llmStep('parent after later child failure'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-fail-later',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(160, ({ message }) => {
          executions.push(message);
        }),
    });

    const childConversation = await waitFor(() => {
      const found = findChildFlowConversation({
        parentConversationId: result.conversationId,
        childFlowName: 'child-fail-later',
      });
      return Boolean(found);
    }).then(() =>
      findChildFlowConversation({
        parentConversationId: result.conversationId,
        childFlowName: 'child-fail-later',
      }),
    );

    assert.ok(childConversation?._id);
    await waitForConversationAssistantStatus(
      String(childConversation?._id),
      'ok',
    );
    await delay(40);
    const parentTurnsWhileChildContinues =
      memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsWhileChildContinues.some((turn) => turn.role === 'assistant'),
      false,
    );

    await waitFor(() =>
      executions.includes('parent after later child failure'),
    );
    const assistantTurns = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      assistantTurns.some(
        (turn) =>
          turn.role === 'assistant' &&
          turn.status === 'ok' &&
          String(turn.content).includes('best effort: 0 succeeded, 1 failed'),
      ),
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow continues best-effort when the child crashes after a prior successful step', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-stale-ok-crash-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-crash-after-ok',
      steps: [llmStep('child ok'), continueStep('Keep going?')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-crash-after-ok',
      steps: [
        subflowStep('Run Crashing Child', 'child-crash-after-ok'),
        llmStep('parent after crashing child'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-crash-after-ok',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(100, ({ message }) => {
          executions.push(message);
        }),
    });

    await waitFor(() => executions.includes('parent after crashing child'));
    await waitForAssistantStatus(result.conversationId, 'ok');

    const childConversation = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-crash-after-ok',
    });
    assert.ok(childConversation?._id);

    const childTurns = memoryTurns.get(String(childConversation?._id)) ?? [];
    const latestChildAssistant = [...childTurns]
      .reverse()
      .find((turn) => turn.role === 'assistant');
    assert.equal(
      latestChildAssistant?.status,
      'failed',
      'child crash should persist a terminal failed assistant turn',
    );
    assert.equal(
      latestChildAssistant?.content,
      'A continue step was reached outside of a startLoop context.',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow keeps the parent running when child flows reference each other recursively', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-recursive-cycle-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-cycle-b',
      steps: [subflowStep('Back To Parent', 'parent-cycle-a')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-cycle-a',
      steps: [
        subflowStep('Run Child', 'child-cycle-b'),
        llmStep('parent after recursive child failure'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-cycle-a',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(100, ({ message }) => {
          executions.push(message);
        }),
    });

    await waitFor(() =>
      executions.includes('parent after recursive child failure'),
    );
    await waitForAssistantStatus(result.conversationId, 'ok');

    const childConversation = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-cycle-b',
    });
    assert.ok(childConversation?._id);

    const childTurns = memoryTurns.get(String(childConversation?._id)) ?? [];
    const latestChildAssistant = [...childTurns]
      .reverse()
      .find((turn) => turn.role === 'assistant');
    assert.equal(latestChildAssistant?.status, 'ok');

    const childCycleConversations = Array.from(memoryConversations.values())
      .filter((conversation) => conversation.flowName === 'parent-cycle-a')
      .map((conversation) => conversation._id);
    assert.deepEqual(childCycleConversations, [result.conversationId]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('stopping the parent flow stops the running child subflow', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-subflow-stop-'));
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow',
      steps: [llmStep('child ok'), llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stop',
      steps: [subflowStep('Run Slow Child', 'child-slow')],
    });

    let parentRunToken: string | undefined;
    const result = await startFlowRun({
      flowName: 'parent-stop',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(250),
      onOwnershipReady: ({ runToken }) => {
        parentRunToken = runToken;
      },
    });

    const activeSubflow = await waitForActiveSubflow(result.conversationId);
    assert.ok(activeSubflow);
    assert.ok(parentRunToken);

    await waitForConversationAssistantStatus(
      String(activeSubflow?.conversationId),
      'ok',
    );

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken: parentRunToken as string,
    });

    await waitForAssistantStatus(result.conversationId, 'stopped');
    await waitForAssistantStatus(
      String(activeSubflow?.conversationId),
      'stopped',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('stopping the parent flow stops every running child in a parallel subflow step', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-stop-parallel-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow-a',
      steps: [llmStep('child ok'), llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-slow-b',
      steps: [llmStep('child ok'), llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stop-parallel',
      steps: [subflowStep('Run Slow Batch', 'child-slow-a', 'child-slow-b')],
    });

    let parentRunToken: string | undefined;
    const result = await startFlowRun({
      flowName: 'parent-stop-parallel',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(250),
      onOwnershipReady: ({ runToken }) => {
        parentRunToken = runToken;
      },
    });

    const activeSubflows = await waitForActiveSubflowCount(
      result.conversationId,
      2,
    );
    assert.equal(activeSubflows.length, 2);
    assert.ok(parentRunToken);

    await Promise.all(
      activeSubflows.map((activeSubflow) =>
        waitForConversationAssistantStatus(
          String(activeSubflow.conversationId),
          'ok',
        ),
      ),
    );

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken: parentRunToken as string,
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'stopped',
    );
    assert.equal(
      finalAssistant?.content,
      'Stopped subflows Parent Review-Run Slow Batch-child-slow-a, Parent Review-Run Slow Batch-child-slow-b',
    );
    await Promise.all(
      activeSubflows.map((activeSubflow) =>
        waitForAssistantStatus(String(activeSubflow.conversationId), 'stopped'),
      ),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parent stop stays stopped even if the child reports ok after cancel', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-sticky-parent-stop-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-fast-ok',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-sticky-stop',
      steps: [
        subflowStep('Run Fast Child', 'child-fast-ok'),
        llmStep('should not run'),
      ],
    });

    let parentRunToken: string | undefined;
    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-sticky-stop',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(10, ({ message }) => {
          executions.push(message);
        }),
      onOwnershipReady: ({ runToken }) => {
        parentRunToken = runToken;
      },
    });

    const activeSubflow = await waitForActiveSubflow(result.conversationId);
    assert.ok(activeSubflow);
    assert.ok(parentRunToken);

    await waitForConversationAssistantStatus(
      String(activeSubflow?.conversationId),
      'ok',
    );
    const parentTurnsBeforeStop = memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsBeforeStop.some((turn) => turn.role === 'assistant'),
      false,
    );

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken: parentRunToken as string,
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'stopped',
    );
    assert.equal(
      finalAssistant?.content,
      'Stopped subflow Parent Review-Run Fast Child',
    );
    assert.equal(
      executions.some((message) => message.includes('should not run')),
      false,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('pending parent stop prevents launching a new child subflow', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-stop-before-launch-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-never-started',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stop-before-launch',
      steps: [subflowStep('Run Child', 'child-never-started')],
    });

    const result = await startFlowRun({
      flowName: 'parent-stop-before-launch',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(250),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'stopped',
    );
    assert.equal(finalAssistant?.content, 'Stopped');

    const childFlowConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-never-started');
    assert.equal(childFlowConversations.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume reattaches to an already running child subflow instead of launching a second child run', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume',
      steps: [subflowStep('Run Slow Child', 'child-resume')],
    });

    let childRunToken: string | undefined;
    const childStart = await startFlowRun({
      flowName: 'child-resume',
      customTitle: 'Resume Parent-Run Slow Child',
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
      onOwnershipReady: ({ runToken }) => {
        childRunToken = runToken;
      },
    });
    assert.ok(childRunToken);

    const parentConversationId = 'resume-parent-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume',
              conversationId: childStart.conversationId,
              runToken: childRunToken as string,
              title: 'Resume Parent-Run Slow Child',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-resume',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');

    const childFlowConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-resume');
    assert.equal(childFlowConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume reattaches when persisted state still uses legacy activeSubflow', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-legacy-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-legacy',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-legacy',
      steps: [subflowStep('Run Slow Child', 'child-resume-legacy')],
    });

    let childRunToken: string | undefined;
    const childStart = await startFlowRun({
      flowName: 'child-resume-legacy',
      customTitle: 'Resume Parent-Run Slow Child',
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
      onOwnershipReady: ({ runToken }) => {
        childRunToken = runToken;
      },
    });
    assert.ok(childRunToken);

    const parentConversationId = 'resume-parent-legacy-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume-legacy',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-legacy-execution',
          stepPath: [],
          loopStack: [],
          activeSubflow: activeSubflowState({
            stepPath: [0],
            flowName: 'child-resume-legacy',
            conversationId: childStart.conversationId,
            runToken: childRunToken as string,
            title: 'Resume Parent-Run Slow Child',
          }),
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-resume-legacy',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');

    const childFlowConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-resume-legacy');
    assert.equal(childFlowConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume reattaches to already running parallel child subflows instead of launching duplicate runs', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-parallel-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-a',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-b',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-parallel',
      steps: [
        subflowStep('Run Slow Batch', 'child-resume-a', 'child-resume-b'),
      ],
    });

    let childRunTokenA: string | undefined;
    let childRunTokenB: string | undefined;
    const childStartA = await startFlowRun({
      flowName: 'child-resume-a',
      customTitle: 'Resume Parent-Run Slow Batch-child-resume-a',
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
      onOwnershipReady: ({ runToken }) => {
        childRunTokenA = runToken;
      },
    });
    const childStartB = await startFlowRun({
      flowName: 'child-resume-b',
      customTitle: 'Resume Parent-Run Slow Batch-child-resume-b',
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
      onOwnershipReady: ({ runToken }) => {
        childRunTokenB = runToken;
      },
    });
    assert.ok(childRunTokenA);
    assert.ok(childRunTokenB);

    const parentConversationId = 'resume-parent-parallel-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume-parallel',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-parallel-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-a',
              conversationId: childStartA.conversationId,
              runToken: childRunTokenA as string,
              title: 'Resume Parent-Run Slow Batch-child-resume-a',
            }),
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-b',
              conversationId: childStartB.conversationId,
              runToken: childRunTokenB as string,
              title: 'Resume Parent-Run Slow Batch-child-resume-b',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-resume-parallel',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(180),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');

    const childAConversations = Array.from(memoryConversations.values()).filter(
      (conversation) => conversation.flowName === 'child-resume-a',
    );
    const childBConversations = Array.from(memoryConversations.values()).filter(
      (conversation) => conversation.flowName === 'child-resume-b',
    );
    assert.equal(childAConversations.length, 1);
    assert.equal(childBConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent stop wins when the restored child already finished', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-terminal-stop-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-terminal',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-terminal',
      steps: [subflowStep('Run Finished Child', 'child-resume-terminal')],
    });

    let childRunToken: string | undefined;
    const childStart = await startFlowRun({
      flowName: 'child-resume-terminal',
      customTitle: 'Resume Parent-Run Finished Child',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ runToken }) => {
        childRunToken = runToken;
      },
    });
    assert.ok(childRunToken);
    await waitForAssistantStatus(childStart.conversationId, 'ok');

    const parentConversationId = 'resume-parent-terminal-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume-terminal',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-terminal-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-terminal',
              conversationId: childStart.conversationId,
              runToken: childRunToken as string,
              title: 'Resume Parent-Run Finished Child',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-resume-terminal',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'stopped',
    );
    assert.equal(finalAssistant?.content, 'Stopped');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent stop clears remembered terminal parallel child tracking before returning stopped', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-terminal-parallel-stop-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-terminal-a',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-resume-terminal-b',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-resume-terminal-parallel',
      steps: [
        subflowStep(
          'Run Finished Batch',
          'child-resume-terminal-a',
          'child-resume-terminal-b',
        ),
      ],
    });

    let childRunTokenA: string | undefined;
    let childRunTokenB: string | undefined;
    const childStartA = await startFlowRun({
      flowName: 'child-resume-terminal-a',
      customTitle: 'Resume Parent-Run Finished Batch-child-resume-terminal-a',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ runToken }) => {
        childRunTokenA = runToken;
      },
    });
    const childStartB = await startFlowRun({
      flowName: 'child-resume-terminal-b',
      customTitle: 'Resume Parent-Run Finished Batch-child-resume-terminal-b',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ runToken }) => {
        childRunTokenB = runToken;
      },
    });
    assert.ok(childRunTokenA);
    assert.ok(childRunTokenB);
    await waitForAssistantStatus(childStartA.conversationId, 'ok');
    await waitForAssistantStatus(childStartB.conversationId, 'ok');

    const parentConversationId = 'resume-parent-terminal-parallel-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Resume Parent',
      flowName: 'parent-resume-terminal-parallel',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'resume-parent-terminal-parallel-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-terminal-a',
              conversationId: childStartA.conversationId,
              runToken: childRunTokenA as string,
              title: 'Resume Parent-Run Finished Batch-child-resume-terminal-a',
            }),
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-terminal-b',
              conversationId: childStartB.conversationId,
              runToken: childRunTokenB as string,
              title: 'Resume Parent-Run Finished Batch-child-resume-terminal-b',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-resume-terminal-parallel',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
      onOwnershipReady: ({ conversationId, runToken }) => {
        registerPendingConversationCancel({
          conversationId,
          runToken,
        });
      },
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'stopped',
    );
    assert.equal(finalAssistant?.content, 'Stopped');

    const parentConversation = memoryConversations.get(parentConversationId);
    assert.ok(parentConversation);
    assert.equal(
      (
        parentConversation.flags as
          | { flow?: { activeSubflows?: unknown } }
          | undefined
      )?.flow?.activeSubflows,
      undefined,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume tolerates stale subflows that have no active child run or terminal result', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-stale-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-stale',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stale',
      steps: [subflowStep('Run Stale Child', 'child-stale')],
    });

    const childConversationId = 'stale-child-conversation';
    const parentConversationId = 'stale-parent-conversation';
    const now = new Date();

    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Child',
      flowName: 'child-stale',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-child-execution',
          stepPath: [],
          loopStack: [],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Parent',
      flowName: 'parent-stale',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-stale',
              conversationId: childConversationId,
              runToken: 'stale-child-run-token',
              title: 'Stale Parent-Run Stale Child',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-stale',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'ok',
    );
    assert.match(
      String(finalAssistant?.content ?? ''),
      /best effort: 0 succeeded, 1 failed/u,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume tolerates stale legacy activeSubflow state that has no active child run or terminal result', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-stale-legacy-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-stale-legacy',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stale-legacy',
      steps: [subflowStep('Run Stale Child', 'child-stale-legacy')],
    });

    const childConversationId = 'stale-legacy-child-conversation';
    const parentConversationId = 'stale-legacy-parent-conversation';
    const now = new Date();

    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Child',
      flowName: 'child-stale-legacy',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-legacy-child-execution',
          stepPath: [],
          loopStack: [],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Parent',
      flowName: 'parent-stale-legacy',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-legacy-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflow: activeSubflowState({
            stepPath: [0],
            flowName: 'child-stale-legacy',
            conversationId: childConversationId,
            runToken: 'stale-legacy-child-run-token',
            title: 'Stale Parent-Run Stale Child',
          }),
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-stale-legacy',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'ok',
    );
    assert.match(
      String(finalAssistant?.content ?? ''),
      /best effort: 0 succeeded, 1 failed/u,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume tolerates stale remembered subflows before launching missing parallel children', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-resume-stale-before-launch-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-stale',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'child-missing',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-stale-parallel',
      steps: [subflowStep('Run Child Batch', 'child-stale', 'child-missing')],
    });

    const childConversationId = 'stale-before-launch-child-conversation';
    const parentConversationId = 'stale-before-launch-parent-conversation';
    const now = new Date();

    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Child',
      flowName: 'child-stale',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-before-launch-child-execution',
          stepPath: [],
          loopStack: [],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Stale Parent',
      flowName: 'parent-stale-parallel',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'stale-before-launch-parent-execution',
          stepPath: [],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-stale',
              conversationId: childConversationId,
              runToken: 'stale-before-launch-child-run-token',
              title: 'Stale Parent-Run Child Batch-child-stale',
            }),
          ],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-stale-parallel',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    const finalAssistant = await waitForAssistantStatus(
      parentConversationId,
      'ok',
    );
    assert.match(
      String(finalAssistant?.content ?? ''),
      /best effort: 1 succeeded, 1 failed/u,
    );

    const missingChildConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-missing');
    assert.equal(missingChildConversations.length, 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resumed parent flow uses its persisted conversation title for new subflow titles', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-persisted-title-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-title',
      steps: [llmStep('child ok')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-title',
      steps: [subflowStep('Run Child', 'child-title')],
    });

    const parentConversationId = 'persisted-title-parent';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Persisted Parent Title',
      flowName: 'parent-title',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'persisted-title-execution',
          stepPath: [],
          loopStack: [],
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    const resumed = await startFlowRun({
      flowName: 'parent-title',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    await waitForAssistantStatus(resumed.conversationId, 'ok');
    const childConversation = findChildFlowConversation({
      parentConversationId,
      childFlowName: 'child-title',
    });
    assert.equal(childConversation?.title, 'Persisted Parent Title-Run Child');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
