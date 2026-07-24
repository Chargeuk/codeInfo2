import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getActiveRunOwnership } from '../../agents/runLock.js';
import {
  abortInflight,
  registerPendingConversationCancel,
} from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
  recordMemoryTurn,
} from '../../chat/memoryPersistence.js';
import {
  __resetProviderBootstrapStatusForTests,
} from '../../config/runtimeConfig.js';
import { hashFlowInput } from '../../flows/flowInput.js';
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
    }) => unknown,
    private readonly slowChildGate?: Promise<void>,
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
    await this.onExecute?.({ message, flags, conversationId });
    const signal = (flags as { signal?: AbortSignal }).signal;
    const abortIfNeeded = () => {
      if (!signal?.aborted) return false;
      this.emit('error', { type: 'error', message: 'aborted' });
      return true;
    };

    if (abortIfNeeded()) return;
    this.emit('thread', { type: 'thread', threadId: conversationId });

    if (message.includes('slow child')) {
      if (this.slowChildGate) await this.slowChildGate;
      else await delay(this.slowDelayMs);
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

const activeSubflowState = (params: {
  stepPath: number[];
  flowName: string;
  conversationId: string;
  runToken: string;
  instanceId?: string;
  waveInvocationId?: string;
  title?: string;
}) => ({
  stepPath: params.stepPath,
  flowName: params.flowName,
  conversationId: params.conversationId,
  runToken: params.runToken,
  ...(params.instanceId ? { instanceId: params.instanceId } : {}),
  ...(params.waveInvocationId
    ? { waveInvocationId: params.waveInvocationId }
    : {}),
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

test('review initialization failures fail the flow instead of silently skipping the review cycle', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-review-initialization-failure-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, 'codeInfoStatus', 'flow-state', 'current-plan.json'),
      '{ malformed current plan',
      'utf8',
    );
    await writeFlowFile({
      tmpDir,
      flowName: 'review-initialization-failure',
      steps: [
        {
          type: 'initializeReviewCycle',
          label: 'Initialize Final Review',
          outputKey: 'review-cycle',
          mode: 'final',
        },
        llmStep('must not run after review initialization failure'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'review-initialization-failure',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => executions.push(message)),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    const failedTurn = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.match(failedTurn?.content ?? '', /Review initialization failed:/u);
    assert.equal(
      executions.includes('must not run after review initialization failure'),
      false,
    );
    const failure = JSON.parse(
      await fs.readFile(
        path.join(
          repoDir,
          'codeInfoStatus',
          'flow-state',
          'review-initialization-failure.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(failure.status, 'failed');
    assert.equal('parent_execution_id' in failure, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a final review skipped for incomplete story work does not relabel an older cycle as completed', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-review-skipped-incomplete-story-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      `${REVIEW_PLAN_MARKDOWN}\n### Task 1. Incomplete\n\n- Task Status: \`__in_progress__\`\n\n#### Subtasks\n\n1. [ ] Implement this first.\n`,
      'utf8',
    );
    const activePath = path.join(
      repoDir,
      'codeInfoStatus',
      'flow-state',
      'active-review-cycle.json',
    );
    const priorCycle = {
      schema_version: 'codeinfo-active-review-cycle/v2',
      review_cycle_id: '0000027-rc-20260719T212516Z-7280f8e7',
      review_mode: 'final',
      story_id: '0000027',
      plan_path: 'planning/0000027-codex-review.md',
      status: 'incomplete',
      created_at: '2026-07-19T21:25:16.322Z',
      completed_at: '2026-07-19T21:26:16.322Z',
      incomplete_reason: 'Prior review was interrupted.',
    };
    await fs.writeFile(activePath, JSON.stringify(priorCycle), 'utf8');
    await writeFlowFile({
      tmpDir,
      flowName: 'two_phase_review_cycle',
      steps: [
        {
          type: 'initializeReviewCycle',
          outputKey: 'review-cycle',
          mode: 'final',
        },
        llmStep('reviewer must not run for incomplete story work'),
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'review-parent-skipped',
      steps: [
        { type: 'subflow', flowNames: ['two_phase_review_cycle'] },
        llmStep('parent continued after skipped review'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'review-parent-skipped',
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
      executions.includes('parent continued after skipped review'),
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
    assert.equal(
      executions.includes('reviewer must not run for incomplete story work'),
      false,
    );
    assert.equal(
      executions.includes('parent continued after skipped review'),
      true,
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(activePath, 'utf8')),
      priorCycle,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('a failed two-phase review marks its cycle incomplete while the parent continues', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-review-incomplete-cycle-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      `${REVIEW_PLAN_MARKDOWN}\n### Task 1. Complete\n\n- Task Status: \`__done__\`\n\n#### Subtasks\n\n1. [x] Implemented.\n\n#### Testing\n\n1. [x] Proven.\n`,
      'utf8',
    );
    await writeFlowFile({
      tmpDir,
      flowName: 'two_phase_review_cycle',
      steps: [
        {
          type: 'initializeReviewCycle',
          outputKey: 'review-cycle',
          mode: 'final',
        },
        llmStep('child fail'),
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'review-parent-incomplete',
      steps: [
        { type: 'subflow', flowNames: ['two_phase_review_cycle'] },
        llmStep('parent continued after failed review'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'review-parent-incomplete',
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
      executions.includes('parent continued after failed review'),
    );
    await waitForAssistantStatus(result.conversationId, 'ok');
    assert.equal(
      executions.includes('parent continued after failed review'),
      true,
    );
    const active = JSON.parse(
      await fs.readFile(
        path.join(
          repoDir,
          'codeInfoStatus',
          'flow-state',
          'active-review-cycle.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(active.status, 'incomplete');
    assert.match(String(active.incomplete_reason), /status failed/u);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('successful flow cleanup preserves the settlement auditor explicit incomplete decision', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-review-explicit-incomplete-cycle-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      `${REVIEW_PLAN_MARKDOWN}\n### Task 1. Complete\n\n- Task Status: \`__done__\`\n\n#### Subtasks\n\n1. [x] Implemented.\n\n#### Testing\n\n1. [x] Proven.\n`,
      'utf8',
    );
    await writeFlowFile({
      tmpDir,
      flowName: 'two_phase_review_cycle',
      steps: [
        {
          type: 'initializeReviewCycle',
          outputKey: 'review-cycle',
          mode: 'final',
        },
        llmStep('record explicit incomplete settlement'),
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'review-parent-explicit-incomplete',
      steps: [
        { type: 'subflow', flowNames: ['two_phase_review_cycle'] },
        llmStep('parent continued after explicit incomplete settlement'),
      ],
    });
    const activePath = path.join(
      repoDir,
      'codeInfoStatus',
      'flow-state',
      'active-review-cycle.json',
    );
    const result = await startFlowRun({
      flowName: 'review-parent-explicit-incomplete',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, async ({ message }) => {
          if (!message.includes('record explicit incomplete settlement')) return;
          const active = JSON.parse(await fs.readFile(activePath, 'utf8')) as Record<
            string,
            unknown
          >;
          await fs.writeFile(
            activePath,
            JSON.stringify({
              ...active,
              status: 'incomplete',
              completed_at: '2026-07-21T12:05:00.000Z',
              incomplete_reason: 'One flexible settlement artifact remained ambiguous.',
            }),
          );
        }),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });

    await waitForAssistantStatus(result.conversationId, 'ok');
    const active = JSON.parse(await fs.readFile(activePath, 'utf8')) as Record<
      string,
      unknown
    >;
    assert.equal(active.status, 'incomplete');
    assert.equal(
      active.incomplete_reason,
      'One flexible settlement artifact remained ambiguous.',
    );
    assert.equal(active.completed_at, '2026-07-21T12:05:00.000Z');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('an orphaned execution-owned review cycle cannot block a later best-effort review flow', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-review-orphaned-cycle-'),
  );
  const repoDir = path.join(tmpDir, 'repo');
  process.env.FLOWS_DIR = tmpDir;

  try {
    await initializeCodexReviewRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      `${REVIEW_PLAN_MARKDOWN}\n### Task 1. Complete\n\n- Task Status: \`__done__\`\n\n#### Subtasks\n\n1. [x] Implemented.\n\n#### Testing\n\n1. [x] Proven.\n`,
      'utf8',
    );
    const stateRoot = path.join(repoDir, 'codeInfoStatus', 'flow-state');
    await fs.writeFile(
      path.join(stateRoot, 'active-review-cycle.json'),
      JSON.stringify({
        schema_version: 'codeinfo-active-review-cycle/v1',
        review_cycle_id: '0000027-rc-20260719T212516Z-7280f8e7',
        review_mode: 'final',
        story_id: '0000027',
        plan_path: 'planning/0000027-codex-review.md',
        parent_execution_id: 'orphaned-run-g',
        created_at: '2026-07-19T21:25:16.322Z',
      }),
      'utf8',
    );
    await writeFlowFile({
      tmpDir,
      flowName: 'two_phase_review_cycle',
      steps: [
        {
          type: 'initializeReviewCycle',
          label: 'Initialize Final Review',
          outputKey: 'review-cycle',
          mode: 'final',
        },
        llmStep('reviewer launched after orphaned cycle'),
      ],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'review-parent',
      steps: [
        { type: 'subflow', flowNames: ['two_phase_review_cycle'] },
        llmStep('parent continued after review'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'review-parent',
      source: 'REST',
      working_folder: repoDir,
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => executions.push(message)),
      listIngestedRepositories: async () => ({
        repos: [buildRepoEntry(repoDir)],
        lockedModelId: null,
      }),
    });
    await waitFor(() => executions.includes('parent continued after review'));
    await waitForAssistantStatus(result.conversationId, 'ok');
    assert.equal(executions.includes('reviewer launched after orphaned cycle'), true);
    assert.equal(executions.includes('parent continued after review'), true);
    const active = JSON.parse(
      await fs.readFile(path.join(stateRoot, 'active-review-cycle.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(active.schema_version, 'codeinfo-active-review-cycle/v2');
    assert.equal(active.status, 'incomplete');
    assert.match(
      String(active.incomplete_reason),
      /without an explicit settlement outcome/u,
    );
    assert.equal('parent_execution_id' in active, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
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

    let releaseSlowChild!: () => void;
    const slowChildGate = new Promise<void>((resolve) => {
      releaseSlowChild = resolve;
    });
    const result = await startFlowRun({
      flowName: 'parent-parallel',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(140, undefined, slowChildGate),
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
    const parentTurnsBeforeSlowChildCompletes =
      memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsBeforeSlowChildCompletes.some(
        (turn) => turn.role === 'assistant',
      ),
      false,
    );
    releaseSlowChild();

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

test('subflow wave launches every matrix cell and singleton concurrently with immutable identities', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-parallel-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    for (const flowName of ['main-review', 'codex-review', 'cross-review']) {
      await writeFlowFile({
        tmpDir,
        flowName,
        steps: [llmStep(`slow child ${flowName}`)],
      });
    }
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave',
      steps: [
        {
          type: 'subflowWave',
          label: 'Run Review Wave',
          groups: [
            {
              kind: 'matrix',
              id: 'reviews',
              itemsFrom: 'targets',
              itemName: 'target',
              flowNames: ['main-review', 'codex-review'],
              bindings: { input: { review_target: 'target' } },
            },
            {
              kind: 'singleton',
              id: 'cross',
              flowName: 'cross-review',
              bindings: { input: { review_targets: 'targets' } },
            },
          ],
        },
      ],
    });

    const input = {
      targets: [
        { target_id: 'client', repo_root: '/repos/client' },
        { target_id: 'server', repo_root: '/repos/server' },
      ],
    };
    const result = await startFlowRun({
      flowName: 'parent-wave',
      customTitle: 'Story Review',
      source: 'REST',
      input,
      chatFactory: () => new SubflowChat(250),
    });
    input.targets[0]!.repo_root = '/mutated';

    const activeSubflows = await waitForActiveSubflowCount(
      result.conversationId,
      5,
    );
    assert.deepEqual(activeSubflows.map((entry) => entry.instanceId).sort(), [
      'cross:cross-review',
      'reviews:client:codex-review',
      'reviews:client:main-review',
      'reviews:server:codex-review',
      'reviews:server:main-review',
    ]);
    assert.equal(
      new Set(activeSubflows.map((entry) => entry.conversationId)).size,
      5,
    );
    assert.equal(
      activeSubflows.find(
        (entry) => entry.instanceId === 'reviews:client:main-review',
      )?.input,
      undefined,
    );
    assert.deepEqual(
      (
        memoryConversations.get(result.conversationId)?.flags as {
          flow?: { input?: unknown };
        }
      ).flow?.input,
      {
        targets: [
          { repo_root: '/repos/client', target_id: 'client' },
          { repo_root: '/repos/server', target_id: 'server' },
        ],
      },
    );
    const liveProgress = (
      memoryConversations.get(result.conversationId)?.flags as {
        flow?: {
          subflowWaveProgress?: {
            expected?: number;
            running?: number;
            completed?: number;
          };
        };
      }
    ).flow?.subflowWaveProgress;
    assert.equal(liveProgress?.expected, 5);
    assert.equal(
      (liveProgress?.running ?? 0) + (liveProgress?.completed ?? 0),
      5,
    );

    const clientChild = memoryConversations.get(
      String(
        activeSubflows.find(
          (entry) => entry.instanceId === 'reviews:client:main-review',
        )?.conversationId,
      ),
    );
    assert.match(clientChild?.title ?? '', /main-review \[client\]/u);
    assert.deepEqual(
      (
        clientChild?.flags as {
          flow?: { input?: unknown };
        }
      ).flow?.input,
      {
        review_target: {
          repo_root: '/repos/client',
          target_id: 'client',
        },
      },
    );
    const childWaveIdentity = (
      clientChild?.flags as { flowChild?: Record<string, unknown> }
    ).flowChild;
    assert.equal(
      childWaveIdentity?.executionId,
      (
        memoryConversations.get(result.conversationId)?.flags as {
          flow?: { executionId?: string };
        }
      ).flow?.executionId,
    );
    assert.equal(
      childWaveIdentity?.instanceId,
      'reviews:client:main-review',
    );
    assert.equal(childWaveIdentity?.targetId, 'client');
    assert.equal(childWaveIdentity?.displayName, 'main-review [client]');
    assert.equal(typeof childWaveIdentity?.waveInvocationId, 'string');

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'ok',
    );
    assert.match(
      finalAssistant?.content ?? '',
      /Completed subflow wave: expected 5, running 0, completed 5, failed 0, stopped 0, not applicable 0/u,
    );
    const finalProgress = (
      memoryConversations.get(result.conversationId)?.flags as {
        flow?: { subflowWaveProgress?: { completed?: number } };
      }
    ).flow?.subflowWaveProgress;
    assert.equal(finalProgress?.completed, 5);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('stopping a subflow wave stops every repeated matrix and singleton child', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-stop-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    for (const flowName of ['wave-local', 'wave-cross']) {
      await writeFlowFile({
        tmpDir,
        flowName,
        steps: [llmStep(`slow child ${flowName}`)],
      });
    }
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-stop',
      steps: [
        {
          type: 'subflowWave',
          groups: [
            {
              kind: 'matrix',
              id: 'locals',
              itemsFrom: 'targets',
              itemName: 'target',
              flowNames: ['wave-local'],
              bindings: { input: { target: 'target' } },
            },
            {
              kind: 'singleton',
              id: 'cross',
              flowName: 'wave-cross',
            },
          ],
        },
      ],
    });

    let parentRunToken: string | undefined;
    const result = await startFlowRun({
      flowName: 'parent-wave-stop',
      source: 'REST',
      input: { targets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      chatFactory: () => new SubflowChat(500),
      onOwnershipReady: ({ runToken }) => {
        parentRunToken = runToken;
      },
    });
    const activeSubflows = await waitForActiveSubflowCount(
      result.conversationId,
      4,
    );
    assert.ok(parentRunToken);

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken: parentRunToken as string,
    });

    const cancelled = abortInflight({
      conversationId: result.conversationId,
      inflightId: result.inflightId,
    });
    assert.equal(cancelled.ok, true);

    const parentAssistant = await waitForAssistantStatus(
      result.conversationId,
      'stopped',
    );
    assert.equal(parentAssistant?.status, 'stopped');
    assert.match(parentAssistant?.content ?? '', /^Stopped subflow wave:/u);
    const parentStoppedTurns = (
      memoryTurns.get(result.conversationId) ?? []
    ).filter((turn) => turn.role === 'assistant' && turn.status === 'stopped');
    assert.equal(parentStoppedTurns.length, 1);
    await Promise.all(
      activeSubflows.map((entry) =>
        waitForConversationAssistantStatus(String(entry.conversationId), 'stopped'),
      ),
    );
    const parentFlow = (
      memoryConversations.get(result.conversationId)?.flags as {
        flow?: {
          activeSubflows?: unknown[];
          subflowWaveProgress?: {
            running?: number;
            jobs?: Array<{ status?: string }>;
          };
        };
      }
    )?.flow;
    assert.equal(parentFlow?.activeSubflows?.length ?? 0, 0);
    assert.equal(parentFlow?.subflowWaveProgress?.running, 0);
    assert.ok(
      parentFlow?.subflowWaveProgress?.jobs?.every(
        (job) => job.status === 'stopped',
      ),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resuming a cancelled subflow wave restarts every stopped child in place', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-cancel-resume-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    for (const flowName of ['wave-resume-local', 'wave-resume-cross']) {
      await writeFlowFile({
        tmpDir,
        flowName,
        steps: [llmStep(`slow child ${flowName}`)],
      });
    }
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-cancel-resume',
      steps: [
        {
          type: 'subflowWave',
          groups: [
            {
              kind: 'matrix',
              id: 'locals',
              itemsFrom: 'targets',
              itemName: 'target',
              flowNames: ['wave-resume-local'],
              bindings: { input: { target: 'target' } },
            },
            {
              kind: 'singleton',
              id: 'cross',
              flowName: 'wave-resume-cross',
            },
          ],
        },
      ],
    });

    let parentRunToken: string | undefined;
    const input = { targets: [{ id: 'a' }, { id: 'b' }] };
    const result = await startFlowRun({
      flowName: 'parent-wave-cancel-resume',
      source: 'REST',
      input,
      chatFactory: () => new SubflowChat(500),
      onOwnershipReady: ({ runToken }) => {
        parentRunToken = runToken;
      },
    });
    const activeSubflows = await waitForActiveSubflowCount(
      result.conversationId,
      3,
    );
    assert.ok(parentRunToken);

    registerPendingConversationCancel({
      conversationId: result.conversationId,
      runToken: parentRunToken,
    });
    assert.equal(
      abortInflight({
        conversationId: result.conversationId,
        inflightId: result.inflightId,
      }).ok,
      true,
    );
    await waitForAssistantStatus(result.conversationId, 'stopped');
    await Promise.all(
      activeSubflows.map((entry) =>
        waitForConversationAssistantStatus(
          String(entry.conversationId),
          'stopped',
        ),
      ),
    );

    await startFlowRun({
      flowName: 'parent-wave-cancel-resume',
      conversationId: result.conversationId,
      resumeStepPath: [],
      source: 'REST',
      input,
      chatFactory: () => new SubflowChat(25),
    });
    await waitForAssistantStatus(result.conversationId, 'ok');
    await Promise.all(
      activeSubflows.map((entry) =>
        waitForConversationAssistantStatus(String(entry.conversationId), 'ok'),
      ),
    );

    const childConversations = Array.from(memoryConversations.values()).filter(
      (conversation) =>
        conversation.flowName === 'wave-resume-local' ||
        conversation.flowName === 'wave-resume-cross',
    );
    assert.equal(childConversations.length, 3);
    const parentFlow = (
      memoryConversations.get(result.conversationId)?.flags as {
        flow?: {
          subflowWaveProgress?: {
            completed?: number;
            stopped?: number;
          };
        };
      }
    )?.flow;
    assert.equal(parentFlow?.subflowWaveProgress?.completed, 3);
    assert.equal(parentFlow?.subflowWaveProgress?.stopped, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resuming a subflow wave reattaches by instance id without duplicate launches', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-resume-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    for (const flowName of ['wave-resume-local', 'wave-resume-cross']) {
      await writeFlowFile({
        tmpDir,
        flowName,
        steps: [llmStep(`slow child ${flowName}`)],
      });
    }
    const waveStep = {
      type: 'subflowWave' as const,
      groups: [
        {
          kind: 'matrix' as const,
          id: 'locals',
          itemsFrom: 'targets',
          itemName: 'target',
          flowNames: ['wave-resume-local'],
          bindings: { input: { target: 'target' } },
        },
        {
          kind: 'singleton' as const,
          id: 'cross',
          flowName: 'wave-resume-cross',
        },
      ],
    };
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-resume',
      steps: [waveStep],
    });
    const input = { targets: [{ id: 'a' }, { id: 'b' }] };
    const jobs = [
      {
        instanceId: 'locals:a:wave-resume-local',
        flowName: 'wave-resume-local',
      },
      {
        instanceId: 'locals:b:wave-resume-local',
        flowName: 'wave-resume-local',
      },
      { instanceId: 'cross:wave-resume-cross', flowName: 'wave-resume-cross' },
    ];
    const activeSubflows: Record<string, unknown>[] = [];
    for (const job of jobs) {
      let childRunToken: string | undefined;
      const child = await startFlowRun({
        flowName: job.flowName,
        source: 'REST',
        input: { target: job.instanceId },
        chatFactory: () => new SubflowChat(300),
        onOwnershipReady: ({ runToken }) => {
          childRunToken = runToken;
        },
      });
      assert.ok(childRunToken);
      activeSubflows.push({
        stepPath: [0],
        flowName: job.flowName,
        instanceId: job.instanceId,
        conversationId: child.conversationId,
        runToken: childRunToken,
      });
    }

    const parentConversationId = 'wave-resume-parent';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Wave Resume Parent',
      flowName: 'parent-wave-resume',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'wave-resume-execution',
          stepPath: [],
          loopStack: [],
          input,
          inputHash: hashFlowInput(input),
          activeSubflows,
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
      flowName: 'parent-wave-resume',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(300),
    });
    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');

    const childConversations = Array.from(memoryConversations.values()).filter(
      (conversation) =>
        conversation.flowName === 'wave-resume-local' ||
        conversation.flowName === 'wave-resume-cross',
    );
    assert.equal(childConversations.length, 3);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('rewinding before a completed subflow launches a fresh child without retaining terminal metadata', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-rewind-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'rewind-child',
      steps: [llmStep('rewind child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'rewind-parent',
      steps: [
        llmStep('rewind setup'),
        subflowStep('Run Rewind Child', 'rewind-child'),
      ],
    });

    let childRunToken: string | undefined;
    const completedChild = await startFlowRun({
      flowName: 'rewind-child',
      source: 'REST',
      chatFactory: () => new SubflowChat(0),
      onOwnershipReady: ({ runToken }) => {
        childRunToken = runToken;
      },
    });
    assert.ok(childRunToken);
    await waitForAssistantStatus(completedChild.conversationId, 'ok');

    const parentConversationId = 'rewind-parent-conversation';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Rewind Parent',
      flowName: 'rewind-parent',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'rewind-parent-execution',
          stepPath: [1],
          loopStack: [],
          activeSubflows: [
            activeSubflowState({
              stepPath: [1],
              flowName: 'rewind-child',
              conversationId: completedChild.conversationId,
              runToken: childRunToken,
              title: 'Rewind Parent-Run Rewind Child',
            }),
          ],
          terminalOutcome: 'not_applicable',
          restartReconciliation: {
            status: 'interrupted',
            reconciledAt: now.toISOString(),
            resumeStepPath: [0],
            interruptedSubflowCount: 1,
            interruptedWaveRunningCount: 0,
          },
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    await startFlowRun({
      flowName: 'rewind-parent',
      conversationId: parentConversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new SubflowChat(0),
    });
    await waitForAssistantStatus(parentConversationId, 'ok');

    const childConversations = Array.from(memoryConversations.values()).filter(
      (conversation) => conversation.flowName === 'rewind-child',
    );
    assert.equal(childConversations.length, 2);
    const resumedFlowState = memoryConversations.get(parentConversationId)
      ?.flags?.flow as
      | {
          terminalOutcome?: unknown;
          restartReconciliation?: unknown;
        }
      | undefined;
    assert.equal(resumedFlowState?.terminalOutcome, undefined);
    assert.equal(resumedFlowState?.restartReconciliation, undefined);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('rewinding before a completed subflow wave launches a fresh wave generation', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-rewind-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'wave-rewind-child',
      steps: [llmStep('wave rewind child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'wave-rewind-parent',
      steps: [
        llmStep('wave rewind setup'),
        {
          type: 'subflowWave',
          groups: [
            {
              kind: 'singleton',
              id: 'wave-rewind',
              flowName: 'wave-rewind-child',
            },
          ],
        },
      ],
    });

    const firstRun = await startFlowRun({
      flowName: 'wave-rewind-parent',
      source: 'REST',
      chatFactory: () => new SubflowChat(0),
    });
    await waitForAssistantStatus(firstRun.conversationId, 'ok');
    await waitFor(() => !getActiveRunOwnership(firstRun.conversationId));

    await startFlowRun({
      flowName: 'wave-rewind-parent',
      conversationId: firstRun.conversationId,
      resumeStepPath: [0],
      source: 'REST',
      chatFactory: () => new SubflowChat(0),
    });
    await waitFor(
      () =>
        Array.from(memoryConversations.values()).filter(
          (conversation) => conversation.flowName === 'wave-rewind-child',
        ).length === 2,
    );

    const childConversations = Array.from(memoryConversations.values()).filter(
      (conversation) => conversation.flowName === 'wave-rewind-child',
    );
    assert.equal(childConversations.length, 2);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('failed flow runs persist failed lifecycle state from the complete flags wrapper', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-failed-lifecycle-state-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'failed-lifecycle-state',
      steps: [llmStep('child fail')],
    });

    const result = await startFlowRun({
      flowName: 'failed-lifecycle-state',
      source: 'REST',
      chatFactory: () => new SubflowChat(0),
    });
    await waitForAssistantStatus(result.conversationId, 'failed');

    const flowState = memoryConversations.get(result.conversationId)?.flags
      ?.flow as { runLifecycle?: { status?: unknown } } | undefined;
    assert.equal(flowState?.runLifecycle?.status, 'failed');
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

test('subflow wave preserves a failed child launch reason in progress state', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-launch-failure-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-launch-failure',
      steps: [
        {
          type: 'subflowWave',
          label: 'Run missing review child',
          failureMode: 'best_effort',
          groups: [
            {
              kind: 'singleton',
              id: 'missing-review',
              flowName: 'missing-review-flow',
            },
          ],
        },
        llmStep('parent after missing wave child'),
      ],
    });

    const executions: string[] = [];
    const result = await startFlowRun({
      flowName: 'parent-wave-launch-failure',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(25, ({ message }) => executions.push(message)),
    });

    await waitFor(() => executions.includes('parent after missing wave child'));
    await waitForAssistantStatus(result.conversationId, 'ok');
    const progress = (
      memoryConversations.get(result.conversationId)?.flags as {
        flow?: {
          subflowWaveProgress?: {
            failed?: number;
            jobs?: Array<{
              status?: string;
              reason?: string;
              conversationId?: string;
            }>;
          };
        };
      }
    ).flow?.subflowWaveProgress;
    assert.equal(progress?.failed, 1);
    assert.equal(progress?.jobs?.[0]?.status, 'failed');
    assert.match(progress?.jobs?.[0]?.reason ?? '', /FLOW_NOT_FOUND/u);
    assert.equal(typeof progress?.jobs?.[0]?.conversationId, 'string');
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
    let releaseSlowChild!: () => void;
    const slowChildGate = new Promise<void>((resolve) => {
      releaseSlowChild = resolve;
    });
    const result = await startFlowRun({
      flowName: 'parent-fail-later',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () =>
        new SubflowChat(
          160,
          ({ message }) => {
            executions.push(message);
          },
          slowChildGate,
        ),
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
    const parentTurnsWhileChildContinues =
      memoryTurns.get(result.conversationId) ?? [];
    assert.equal(
      parentTurnsWhileChildContinues.some((turn) => turn.role === 'assistant'),
      false,
    );
    releaseSlowChild();

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

test('resume rejects malformed persisted wave progress instead of discarding its jobs', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-malformed-recovery-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-malformed-recovery',
      steps: [
        {
          type: 'subflowWave',
          groups: [
            {
              kind: 'singleton',
              id: 'malformed',
              flowName: 'child-wave-malformed-recovery',
            },
          ],
        },
      ],
    });

    const parentConversationId = 'wave-malformed-recovery-parent';
    const now = new Date();
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Malformed Wave Recovery Parent',
      flowName: 'parent-wave-malformed-recovery',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'wave-malformed-recovery-execution',
          stepPath: [],
          loopStack: [],
          subflowWaveProgress: {
            stepPath: [0],
            expected: 1,
            running: 1,
            completed: 0,
            failed: 0,
            stopped: 0,
            notApplicable: 0,
            jobs: [
              {
                instanceId: 'malformed:child-wave-malformed-recovery',
                flowName: 'child-wave-malformed-recovery',
                title: '',
                status: 'running',
              },
            ],
            updatedAt: now.toISOString(),
          },
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);

    await assert.rejects(
      startFlowRun({
        flowName: 'parent-wave-malformed-recovery',
        conversationId: parentConversationId,
        resumeStepPath: [],
        source: 'REST',
        chatFactory: () => new SubflowChat(25),
      }),
      (error: unknown) =>
        (error as { code?: unknown; reason?: unknown }).code ===
          'INVALID_REQUEST' &&
        (error as { reason?: unknown }).reason ===
          'resumeStepPath requires saved flow state',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume rejects malformed persisted child inputs and prior flow values', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-malformed-resume-inputs-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-malformed-resume-inputs',
      steps: [llmStep('should not run')],
    });

    for (const [suffix, malformedFlowState] of [
      [
        'child-input',
        {
          activeSubflows: [
            {
              stepPath: [0],
              flowName: 'child-malformed-input',
              conversationId: 'child-malformed-input-conversation',
              runToken: 'child-malformed-input-token',
              input: { unsupported: undefined },
            },
          ],
        },
      ],
      ['prior-values', { values: { unsupported: undefined } }],
    ] as const) {
      const conversationId = `parent-malformed-resume-${suffix}`;
      const now = new Date();
      memoryConversations.set(conversationId, {
        _id: conversationId,
        provider: 'codex',
        model: 'gpt-5.1-codex-max',
        title: `Malformed Resume ${suffix}`,
        flowName: 'parent-malformed-resume-inputs',
        source: 'REST',
        flags: {
          flow: {
            executionId: `malformed-resume-${suffix}-execution`,
            stepPath: [],
            loopStack: [],
            agentConversations: {},
            agentThreads: {},
            ...malformedFlowState,
          },
        },
        lastMessageAt: now,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      } as Conversation);

      await assert.rejects(
        startFlowRun({
          flowName: 'parent-malformed-resume-inputs',
          conversationId,
          resumeStepPath: [],
          source: 'REST',
          chatFactory: () => new SubflowChat(25),
        }),
        (error: unknown) =>
          (error as { code?: unknown; reason?: unknown }).code ===
            'INVALID_REQUEST' &&
          (error as { reason?: unknown }).reason ===
            'resumeStepPath requires saved flow state',
      );
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('restart recovery resumes an interrupted wave child in its existing conversation', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-restart-recovery-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-wave-restart',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-restart',
      steps: [
        {
          type: 'subflowWave',
          groups: [
            {
              kind: 'singleton',
              id: 'restart',
              flowName: 'child-wave-restart',
            },
          ],
        },
      ],
    });

    const childConversationId = 'wave-restart-child-conversation';
    const parentConversationId = 'wave-restart-parent-conversation';
    const now = new Date();
    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Restarted Wave Child',
      flowName: 'child-wave-restart',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'wave-restart-child-execution',
          stepPath: [],
          loopStack: [],
          runLifecycle: { status: 'running', updatedAt: now.toISOString() },
          agentConversations: {},
          agentThreads: {},
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);
    recordMemoryTurn({
      conversationId: childConversationId,
      role: 'assistant',
      content: 'stale terminal assistant result',
      model: 'gpt-5.1-codex-max',
      provider: 'codex',
      toolCalls: null,
      status: 'ok',
      source: 'REST',
      createdAt: now,
    });
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Restarted Wave Parent',
      flowName: 'parent-wave-restart',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'wave-restart-parent-execution',
          stepPath: [],
          loopStack: [],
          restartReconciliation: {
            status: 'interrupted',
            reconciledAt: now.toISOString(),
            resumeStepPath: [],
            interruptedSubflowCount: 1,
            interruptedWaveRunningCount: 1,
          },
          activeSubflows: [
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-wave-restart',
              conversationId: childConversationId,
              runToken: 'interrupted-wave-child-run-token',
              instanceId: 'restart:child-wave-restart',
              title: 'Restarted Wave Parent-child-wave-restart',
            }),
          ],
          subflowWaveProgress: {
            stepPath: [0],
            expected: 1,
            running: 1,
            completed: 0,
            failed: 0,
            stopped: 0,
            notApplicable: 0,
            jobs: [
              {
                instanceId: 'restart:child-wave-restart',
                flowName: 'child-wave-restart',
                title: 'Restarted Wave Parent-child-wave-restart',
                status: 'running',
              },
            ],
            updatedAt: now.toISOString(),
          },
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
      flowName: 'parent-wave-restart',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(25),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');
    await waitForAssistantStatus(childConversationId, 'ok');
    assert.equal(
      memoryConversations.get(childConversationId)?.flowName,
      'child-wave-restart',
    );
    assert.equal(
      Array.from(memoryConversations.values()).filter(
        (conversation) => conversation.flowName === 'child-wave-restart',
      ).length,
      1,
    );
    assert.equal(
      (memoryTurns.get(childConversationId) ?? []).filter(
        (turn) => turn.role === 'assistant' && turn.status === 'ok',
      ).length,
      2,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('restart recovery re-enters an interrupted later-loop wave with its existing child identity', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-later-loop-restart-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-wave-later-loop-restart',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-later-loop-restart',
      steps: [
        {
          type: 'startLoop',
          maxIterations: 2,
          steps: [
            llmStep('completed decision'),
            {
              type: 'subflowWave',
              groups: [
                {
                  kind: 'singleton',
                  id: 'later-loop-restart',
                  flowName: 'child-wave-later-loop-restart',
                },
              ],
            },
          ],
        },
      ],
    });

    const childConversationId = 'wave-later-loop-restart-child';
    const parentConversationId = 'wave-later-loop-restart-parent';
    const parentExecutionId = 'wave-later-loop-restart-execution';
    const waveInvocationId = JSON.stringify({
      stepPath: [0, 1],
      loopStack: [{ loopStepPath: [0], iteration: 2 }],
    });
    const now = new Date();
    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Later Loop Restarted Wave Child',
      flowName: 'child-wave-later-loop-restart',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'wave-later-loop-restart-child-execution',
          stepPath: [],
          loopStack: [],
          runLifecycle: { status: 'running', updatedAt: now.toISOString() },
          agentConversations: {},
          agentThreads: {},
        },
        flowChild: {
          executionId: parentExecutionId,
          instanceId: 'later-loop-restart:child-wave-later-loop-restart',
          waveInvocationId,
          displayName: 'Later Loop Restarted Wave Child',
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
      title: 'Later Loop Restarted Wave Parent',
      flowName: 'parent-wave-later-loop-restart',
      source: 'REST',
      flags: {
        flow: {
          executionId: parentExecutionId,
          stepPath: [0, 0],
          loopStack: [{ loopStepPath: [0], iteration: 2 }],
          restartReconciliation: {
            status: 'interrupted',
            reconciledAt: now.toISOString(),
            resumeStepPath: [0, 1],
            interruptedSubflowCount: 1,
            interruptedWaveRunningCount: 1,
          },
          activeSubflows: [
            activeSubflowState({
              stepPath: [0, 1],
              flowName: 'child-wave-later-loop-restart',
              conversationId: childConversationId,
              runToken: 'interrupted-later-loop-child-run-token',
              instanceId: 'later-loop-restart:child-wave-later-loop-restart',
              waveInvocationId,
              title: 'Later Loop Restarted Wave Child',
            }),
          ],
          subflowWaveProgress: {
            stepPath: [0, 1],
            expected: 1,
            running: 1,
            completed: 0,
            failed: 0,
            stopped: 0,
            notApplicable: 0,
            jobs: [
              {
                instanceId: 'later-loop-restart:child-wave-later-loop-restart',
                flowName: 'child-wave-later-loop-restart',
                title: 'Later Loop Restarted Wave Child',
                status: 'running',
              },
            ],
            updatedAt: now.toISOString(),
          },
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
      flowName: 'parent-wave-later-loop-restart',
      conversationId: parentConversationId,
      resumeStepPath: [0, 1],
      source: 'REST',
      chatFactory: () => new SubflowChat(25),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');
    await waitForAssistantStatus(childConversationId, 'ok');
    assert.equal(
      Array.from(memoryConversations.values()).filter(
        (conversation) =>
          conversation.flowName === 'child-wave-later-loop-restart',
      ).length,
      1,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('restart recovery reattaches only the matching wave invocation when the parent crashed before persisting it', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'flow-subflow-wave-crash-window-recovery-'),
  );
  process.env.FLOWS_DIR = tmpDir;

  try {
    await writeFlowFile({
      tmpDir,
      flowName: 'child-wave-crash-window',
      steps: [llmStep('slow child')],
    });
    await writeFlowFile({
      tmpDir,
      flowName: 'parent-wave-crash-window',
      steps: [
        {
          type: 'subflowWave',
          groups: [
            {
              kind: 'singleton',
              id: 'crash-window',
              flowName: 'child-wave-crash-window',
            },
          ],
        },
      ],
    });

    const childConversationId = 'wave-crash-window-child-conversation';
    const parentConversationId = 'wave-crash-window-parent-conversation';
    const parentExecutionId = 'wave-crash-window-parent-execution';
    const instanceId = 'crash-window:child-wave-crash-window';
    const waveInvocationId = JSON.stringify({ stepPath: [0], loopStack: [] });
    const now = new Date();
    memoryConversations.set(childConversationId, {
      _id: childConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Crash Window Wave Child',
      flowName: 'child-wave-crash-window',
      source: 'REST',
      flags: {
        flow: {
          executionId: 'wave-crash-window-child-execution',
          stepPath: [],
          loopStack: [],
          runLifecycle: { status: 'running', updatedAt: now.toISOString() },
          agentConversations: {},
          agentThreads: {},
        },
        flowChild: {
          executionId: parentExecutionId,
          instanceId,
          waveInvocationId,
          displayName: 'child-wave-crash-window',
        },
      },
      lastMessageAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Conversation);
    const earlierChildConversationId = 'wave-crash-window-earlier-child';
    const currentChild = memoryConversations.get(childConversationId)!;
    memoryConversations.set(earlierChildConversationId, {
      ...currentChild,
      _id: earlierChildConversationId,
      title: 'Earlier Wave Child',
      flags: {
        ...(currentChild.flags ?? {}),
        flowChild: {
          executionId: parentExecutionId,
          instanceId,
          waveInvocationId: 'earlier-wave-invocation',
          displayName: 'child-wave-crash-window',
        },
      },
    });
    memoryConversations.set(parentConversationId, {
      _id: parentConversationId,
      provider: 'codex',
      model: 'gpt-5.1-codex-max',
      title: 'Crash Window Wave Parent',
      flowName: 'parent-wave-crash-window',
      source: 'REST',
      flags: {
        flow: {
          executionId: parentExecutionId,
          stepPath: [],
          loopStack: [],
          restartReconciliation: {
            status: 'interrupted',
            reconciledAt: now.toISOString(),
            resumeStepPath: [],
            interruptedSubflowCount: 0,
            interruptedWaveRunningCount: 1,
          },
          subflowWaveProgress: {
            stepPath: [0],
            expected: 1,
            running: 1,
            completed: 0,
            failed: 0,
            stopped: 0,
            notApplicable: 0,
            jobs: [
              {
                instanceId,
                flowName: 'child-wave-crash-window',
                title: 'Crash Window Wave Child',
                status: 'running',
              },
            ],
            updatedAt: now.toISOString(),
          },
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
      flowName: 'parent-wave-crash-window',
      conversationId: parentConversationId,
      resumeStepPath: [],
      source: 'REST',
      chatFactory: () => new SubflowChat(25),
    });

    assert.equal(resumed.conversationId, parentConversationId);
    await waitForAssistantStatus(parentConversationId, 'ok');
    await waitForAssistantStatus(childConversationId, 'ok');
    assert.equal(
      Array.from(memoryConversations.values()).filter(
        (conversation) => conversation.flowName === 'child-wave-crash-window',
      ).length,
      2,
    );
    assert.equal(memoryTurns.get(earlierChildConversationId)?.length ?? 0, 0);
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
