import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
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
    return Array.isArray(activeSubflows) && activeSubflows.length === expectedCount;
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

const writeExecutable = async (filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf8');
  await fs.chmod(filePath, 0o755);
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
      '# Story 27\n',
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
    const pointer = JSON.parse(
      await fs.readFile(pointerPath, 'utf8'),
    ) as {
      model?: string;
      reasoning_effort?: string | null;
      merged_into_canonical_findings?: boolean;
    };

    assert.equal(pointer.model, 'gpt-5.4');
    assert.equal(pointer.reasoning_effort, 'medium');
    assert.equal(pointer.merged_into_canonical_findings, false);
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
    await fs.writeFile(path.join(repoDir, '.gitignore'), 'codeInfoTmp/\n', 'utf8');
    await fs.writeFile(
      path.join(repoDir, 'planning', '0000027-codex-review.md'),
      '# Story 27\n',
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

test('parallel subflow waits for every child and fails when any child fails', async () => {
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
        subflowStep('Run Failure Batch', 'child-fast-fail', 'child-slow-success'),
      ],
    });

    const result = await startFlowRun({
      flowName: 'parent-parallel-fail',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(140),
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

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflows Parent Review-Run Failure Batch-child-fast-fail, Parent Review-Run Failure Batch-child-slow-success failed',
    );
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
      steps: [subflowStep('Run Child', 'child-ok'), llmStep('parent after subflow')],
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

test('subflow step mirrors child failure onto the parent flow', async () => {
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
      steps: [subflowStep('Run Broken Child', 'child-fail')],
    });

    const result = await startFlowRun({
      flowName: 'parent-fail',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(150),
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflow Parent Review-Run Broken Child failed',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow waits for the full child flow and can fail on a later child step', async () => {
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
      steps: [subflowStep('Run Later Failure', 'child-fail-later')],
    });

    const result = await startFlowRun({
      flowName: 'parent-fail-later',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(160),
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

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflow Parent Review-Run Later Failure failed',
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('subflow fails when the child crashes after a prior successful step', async () => {
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
      steps: [subflowStep('Run Crashing Child', 'child-crash-after-ok')],
    });

    const result = await startFlowRun({
      flowName: 'parent-crash-after-ok',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflow Parent Review-Run Crashing Child failed',
    );

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

test('subflow fails fast when flows reference each other recursively', async () => {
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
      steps: [subflowStep('Run Child', 'child-cycle-b')],
    });

    const result = await startFlowRun({
      flowName: 'parent-cycle-a',
      customTitle: 'Parent Review',
      source: 'REST',
      chatFactory: () => new SubflowChat(100),
    });

    const finalAssistant = await waitForAssistantStatus(
      result.conversationId,
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      'Subflow Parent Review-Run Child failed',
    );

    const childConversation = findChildFlowConversation({
      parentConversationId: result.conversationId,
      childFlowName: 'child-cycle-b',
    });
    assert.ok(childConversation?._id);

    const childTurns = memoryTurns.get(String(childConversation?._id)) ?? [];
    const latestChildAssistant = [...childTurns]
      .reverse()
      .find((turn) => turn.role === 'assistant');
    assert.equal(latestChildAssistant?.status, 'failed');
    assert.equal(
      latestChildAssistant?.content,
      'Subflow cycle detected: parent-cycle-a -> child-cycle-b -> parent-cycle-a.',
    );

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
      steps: [subflowStep('Run Fast Child', 'child-fast-ok'), llmStep('should not run')],
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
      steps: [subflowStep('Run Slow Batch', 'child-resume-a', 'child-resume-b')],
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
              title:
                'Resume Parent-Run Finished Batch-child-resume-terminal-a',
            }),
            activeSubflowState({
              stepPath: [0],
              flowName: 'child-resume-terminal-b',
              conversationId: childStartB.conversationId,
              runToken: childRunTokenB as string,
              title:
                'Resume Parent-Run Finished Batch-child-resume-terminal-b',
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

test('resume fails stale subflows that have no active child run or terminal result', async () => {
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
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      `Subflow child-stale could not be resumed because child conversation ${childConversationId} has no active run and no terminal result.`,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume fails stale legacy activeSubflow state that has no active child run or terminal result', async () => {
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
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      `Subflow child-stale-legacy could not be resumed because child conversation ${childConversationId} has no active run and no terminal result.`,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('resume fails stale remembered subflows before launching missing parallel children', async () => {
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
      'failed',
    );
    assert.equal(
      finalAssistant?.content,
      `Subflow child-stale could not be resumed because child conversation ${childConversationId} has no active run and no terminal result.`,
    );

    const missingChildConversations = Array.from(
      memoryConversations.values(),
    ).filter((conversation) => conversation.flowName === 'child-missing');
    assert.equal(missingChildConversations.length, 0);
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
