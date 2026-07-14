import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import type { DataTable } from '@cucumber/cucumber';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { memoryConversations, memoryTurns, shouldUseMemoryPersistence, } from '../../chat/memoryPersistence.js';
import { __resetFlowWaitResumeDepsForTests, __setFlowWaitResumeDepsForTests, startFlowRun, } from '../../flows/service.js';
import type { ListReposResult, RepoEntry } from '../../lmstudio/toolService.js';
import type { Conversation } from '../../mongo/conversation.js';
import { ConversationModel } from '../../mongo/conversation.js';
import { TurnModel } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import { installDeterministicCodexAvailabilityBootstrap, resetDeterministicCodexAvailabilityBootstrap, } from '../support/codexAvailabilityBootstrap.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';
class MinimalChat extends ChatInterface {
    async execute(_message: string, _flags: Record<string, unknown>, conversationId: string, _model: string) {
        void _message;
        void _flags;
        void _model;
        this.emit('thread', { type: 'thread', threadId: conversationId });
        this.emit('final', { type: 'final', content: 'ok' });
        this.emit('complete', { type: 'complete', threadId: conversationId });
    }
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
let server: Server | null = null;
let baseUrl = '';
let tempDir: string | null = null;
let lastResponse: {
    status: number;
    body: Record<string, unknown>;
} | null = null;
const rememberedConversationIds = new Map<string, string>();
const rememberedExecutionIds = new Map<string, string>();
let previousAgentsHome: string | undefined;
let previousFlowsDir: string | undefined;
let previousCodexHome: string | undefined;
let previousNodeEnv: string | undefined;
let originalConversationFindByIdAndUpdate: typeof ConversationModel.findByIdAndUpdate | null = null;
let originalMemoryConversationsSet: typeof memoryConversations.set | null = null;
let capturedWaitWake: (() => void) | null = null;
let checkedInGitHubReviewFlow: {
    steps?: Array<Record<string, unknown>>;
} | null = null;
let activeFlowWorkingFolder: string | null = null;
let activeListIngestedRepositories: (() => Promise<ListReposResult>) | undefined;
const flattenFlowSteps = (steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
    const flattened: Array<Record<string, unknown>> = [];
    for (const step of steps) {
        flattened.push(step);
        const nested = step.steps;
        if (Array.isArray(nested)) {
            flattened.push(...flattenFlowSteps(nested.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object')));
        }
        const thenBranch = step.then;
        if (Array.isArray(thenBranch)) {
            flattened.push(...flattenFlowSteps(thenBranch.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object')));
        }
        const elseBranch = step.else;
        if (Array.isArray(elseBranch)) {
            flattened.push(...flattenFlowSteps(elseBranch.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object')));
        }
    }
    return flattened;
};
const waitForConversation = async (conversationId: string) => {
    if (shouldUseMemoryPersistence()) {
        for (let attempt = 0; attempt < 80; attempt += 1) {
            const conversation = memoryConversations.get(conversationId);
            if (conversation)
                return conversation;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.fail(`Timed out waiting for memory conversation ${conversationId}`);
    }
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const conversation = await ConversationModel.findById(conversationId)
            .lean()
            .exec();
        if (conversation)
            return conversation;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for conversation ${conversationId}`);
};
const getStoredExecutionId = async (conversationId: string) => {
    const conversation = await waitForConversation(conversationId);
    const flowFlags = (conversation.flags ?? {}) as {
        flow?: {
            executionId?: string;
        };
    };
    assert.equal(typeof flowFlags.flow?.executionId, 'string');
    return flowFlags.flow?.executionId as string;
};
const getStoredChildConversationId = async (conversationId: string) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const conversation = await waitForConversation(conversationId);
        const flowFlags = (conversation.flags ?? {}) as {
            flow?: {
                agentConversations?: Record<string, string>;
            };
        };
        const childConversationId = flowFlags.flow?.agentConversations?.['coding_agent:resume-test'];
        if (typeof childConversationId === 'string') {
            return childConversationId;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for child conversation mapping ${conversationId}`);
};
const getStoredChildExecutionId = async (conversationId: string) => {
    const conversation = await waitForConversation(conversationId);
    const flags = (conversation.flags ?? {}) as {
        flowChild?: {
            executionId?: string;
        };
    };
    assert.equal(typeof flags.flowChild?.executionId, 'string');
    return flags.flowChild?.executionId as string;
};
const getStoredTurns = async (conversationId: string) => shouldUseMemoryPersistence()
    ? (memoryTurns.get(conversationId) ?? []).map((turn) => ({
        role: turn.role,
        content: turn.content,
    }))
    : (await TurnModel.find({ conversationId })
        .sort({ createdAt: 1 })
        .lean()
        .exec()).map((turn) => ({
        role: turn.role,
        content: turn.content,
    }));
const waitForTurns = async (conversationId: string, predicate: (turns: Array<{
    role?: string;
    content?: string;
}>) => boolean, timeoutMs = 4000) => {
    const resolvedTimeoutMs = resolveConfiguredTestTimeoutMs(timeoutMs);
    const startedAt = Date.now();
    while (Date.now() - startedAt < resolvedTimeoutMs) {
        const turns = await getStoredTurns(conversationId);
        if (predicate(turns)) {
            return turns;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for turns on conversation ${conversationId} after ${resolvedTimeoutMs}ms`);
};
const createGitHubReviewRuntimeRepoFixture = async (params: {
    root: string;
    reviewCount: number;
    commentCount?: number;
    legacyReviewCount?: number;
    legacyCommentCount?: number;
}) => {
    const planPath = 'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md';
    await fs.mkdir(path.join(params.root, 'codeInfoStatus/flow-state'), {
        recursive: true,
    });
    await fs.mkdir(path.join(params.root, 'planning'), { recursive: true });
    await fs.mkdir(path.join(params.root, 'scripts/flow_control'), {
        recursive: true,
    });
    await fs.mkdir(path.join(params.root, 'codeInfoTmp/reviews'), {
        recursive: true,
    });
    await fs.writeFile(path.join(params.root, 'codeInfoStatus/flow-state/current-plan.json'), JSON.stringify({
        plan_path: planPath,
        branched_from: 'main',
        additional_repositories: [],
    }, null, 2), 'utf8');
    await fs.writeFile(path.join(params.root, 'codeInfoStatus/flow-state/current-task.json'), JSON.stringify({
        plan_path: planPath,
        selected_task: {
            number: 8,
            title: 'Task 8',
            status: '__in_progress__',
        },
    }, null, 2), 'utf8');
    await fs.writeFile(path.join(params.root, 'planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md'), [
        '# Story 0000060 - Users can automate GitHub PR review cycles with conditional, script, and wait steps',
        '',
        '### Task 8. Restore Runtime Branch Authority And Direct GitHub Review Proof',
        '',
        '- Task Status: `__in_progress__`',
        '',
        '#### Implementation notes',
        '',
        '- Starts empty.',
        '',
    ].join('\n'), 'utf8');
    await fs.copyFile(path.join(repoRoot, 'scripts/flow_control/check_github_review_has_reviewer_feedback.py'), path.join(params.root, 'scripts/flow_control/check_github_review_has_reviewer_feedback.py'));
    const writeExecutionScopedHandoff = async (executionId: string, reviewCount: number, commentCount: number) => {
        const handoffPath = path.join(params.root, 'codeInfoTmp/reviews', `0000060-github-review-${executionId}-current.json`);
        await fs.writeFile(handoffPath, JSON.stringify({
            handoff_kind: 'github-review-handoff-v1',
            execution_id: executionId,
            plan_path: planPath,
            story_number: '0000060',
            repository_root: params.root,
            branch_name: 'feature/0000060-demo',
            head_sha: 'deadbeef',
            raw_review_artifact_path: path.join(params.root, 'codeInfoTmp/reviews', `0000060-github-review-${executionId}-pr-45.json`),
            filtered_review_count: reviewCount,
            filtered_review_comment_count: commentCount,
            pull_request: {
                number: 45,
                url: 'https://github.com/example/repo/pull/45',
                headRefName: 'feature/0000060-demo',
                baseRefName: 'main',
            },
        }, null, 2), 'utf8');
        await fs.writeFile(path.join(params.root, 'codeInfoTmp/reviews/0000060-github-review-current.json'), JSON.stringify({
            selector_kind: 'github-review-selector-v1',
            execution_id: executionId,
            plan_path: planPath,
            story_number: '0000060',
            repository_root: params.root,
            branch_name: 'feature/0000060-demo',
            handoff_path: handoffPath,
        }, null, 2), 'utf8');
    };
    await writeExecutionScopedHandoff('exec-1', params.reviewCount, params.commentCount ?? 0);
    if (params.legacyReviewCount !== undefined ||
        params.legacyCommentCount !== undefined) {
        await fs.writeFile(path.join(params.root, 'codeInfoTmp/reviews/0000060-current-review.json'), JSON.stringify({
            handoff_kind: 'github-review-handoff-v1',
            execution_id: 'legacy',
            plan_path: planPath,
            story_number: '0000060',
            repository_root: params.root,
            filtered_review_count: params.legacyReviewCount ?? 0,
            filtered_review_comment_count: params.legacyCommentCount ?? 0,
        }, null, 2), 'utf8');
    }
};
const writeGitHubReviewRuntimeFlow = async (params: {
    flowName: string;
    includeWait?: boolean;
    thenSteps: Array<Record<string, unknown>>;
    elseSteps: Array<Record<string, unknown>>;
}) => {
    assert(tempDir, 'expected temporary flows directory');
    const steps: Array<Record<string, unknown>> = [];
    if (params.includeWait) {
        steps.push({
            type: 'wait',
            label: 'Wait for review feedback',
            seconds: 60,
        });
    }
    steps.push({
        type: 'if',
        condition: 'scripts/flow_control/check_github_review_has_reviewer_feedback.py',
        then: params.thenSteps,
        else: params.elseSteps,
    });
    await fs.writeFile(path.join(tempDir, `${params.flowName}.json`), JSON.stringify({
        description: 'GitHub review runtime branch-authority fixture',
        steps,
    }, null, 2), 'utf8');
};
const buildHarnessRepoEntry = (containerPath: string): RepoEntry => ({
    id: path.basename(containerPath) || 'flow-test-repo',
    description: null,
    containerPath,
    hostPath: `/host${containerPath}`,
    lastIngestAt: null,
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
    counts: { files: 1, chunks: 1, embedded: 1 },
    lastError: null,
});
const listHarnessRepo = async (containerPath: string): Promise<ListReposResult> => ({
    repos: [buildHarnessRepoEntry(containerPath)],
    lockedModelId: null,
});
Before({ tags: '@mongo' }, async () => {
    rememberedConversationIds.clear();
    rememberedExecutionIds.clear();
    lastResponse = null;
    memoryConversations.clear();
    activeFlowWorkingFolder = null;
    activeListIngestedRepositories = undefined;
    previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
    previousFlowsDir = process.env.FLOWS_DIR;
    previousCodexHome = process.env.CODEINFO_CODEX_HOME;
    previousNodeEnv = process.env.NODE_ENV;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story53-cucumber-'));
    setScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME", path.join(repoRoot, 'codex_agents'));
    setScopedTestEnvValue("CODEINFO_CODEX_HOME", '/app/codex');
    setScopedTestEnvValue("FLOWS_DIR", tempDir);
    clearScopedTestEnvValue("NODE_ENV");
    installDeterministicCodexAvailabilityBootstrap();
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(createFlowsRunRouter({
        startFlowRun: (params) => startFlowRun({
            ...params,
            chatFactory: () => new MinimalChat(),
            listIngestedRepositories: activeListIngestedRepositories,
        }),
    }));
    await new Promise<void>((resolve) => {
        const listener = app.listen(0, () => {
            server = listener;
            const address = listener.address();
            if (!address || typeof address === 'string') {
                throw new Error('Unable to start flow execution test server');
            }
            baseUrl = `http://127.0.0.1:${address.port}`;
            resolve();
        });
    });
});
After({ tags: '@mongo' }, async () => {
    resetDeterministicCodexAvailabilityBootstrap();
    memoryConversations.clear();
    if (mongoose.connection.readyState === 1) {
        await ConversationModel.deleteMany({}).exec();
        await TurnModel.deleteMany({}).exec();
    }
    if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
    }
    if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
    if (previousAgentsHome === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_AGENT_HOME", previousAgentsHome);
    }
    if (previousFlowsDir === undefined) {
        clearScopedTestEnvValue("FLOWS_DIR");
    }
    else {
        setScopedTestEnvValue("FLOWS_DIR", previousFlowsDir);
    }
    if (previousCodexHome === undefined) {
        clearScopedTestEnvValue("CODEINFO_CODEX_HOME");
    }
    else {
        setScopedTestEnvValue("CODEINFO_CODEX_HOME", previousCodexHome);
    }
    if (previousNodeEnv === undefined) {
        clearScopedTestEnvValue("NODE_ENV");
    }
    else {
        setScopedTestEnvValue("NODE_ENV", previousNodeEnv);
    }
    if (originalConversationFindByIdAndUpdate) {
        ConversationModel.findByIdAndUpdate = originalConversationFindByIdAndUpdate;
        originalConversationFindByIdAndUpdate = null;
    }
    if (originalMemoryConversationsSet) {
        memoryConversations.set = originalMemoryConversationsSet;
        originalMemoryConversationsSet = null;
    }
    capturedWaitWake = null;
    checkedInGitHubReviewFlow = null;
    activeFlowWorkingFolder = null;
    activeListIngestedRepositories = undefined;
    __resetFlowWaitResumeDepsForTests();
});
Given('the checked-in GitHub review flow variant exists', async () => {
    const raw = await fs.readFile(path.join(repoRoot, 'flows/implement_next_plan_github_review.json'), 'utf8');
    checkedInGitHubReviewFlow = JSON.parse(raw) as {
        steps?: Array<Record<string, unknown>>;
    };
    assert.ok(Array.isArray(checkedInGitHubReviewFlow.steps));
});
Then('the GitHub review flow variant waits before fetching reviews', () => {
    assert.ok(checkedInGitHubReviewFlow?.steps);
    const flattened = flattenFlowSteps(checkedInGitHubReviewFlow.steps ?? []);
    const openIndex = flattened.findIndex((step) => step.type === 'github_open_pr');
    const waitIndex = flattened.findIndex((step) => step.type === 'wait');
    const fetchIndex = flattened.findIndex((step) => step.type === 'github_fetch_reviews');
    assert.ok(openIndex > -1);
    assert.ok(waitIndex > openIndex);
    assert.ok(fetchIndex > waitIndex);
});
Then('the GitHub review flow variant checks for reviewer feedback before the external review loop', () => {
    assert.ok(checkedInGitHubReviewFlow?.steps);
    const flattened = flattenFlowSteps(checkedInGitHubReviewFlow.steps ?? []);
    const ifStep = flattened.find((step) => step.type === 'if' &&
        step.condition ===
            'scripts/flow_control/check_github_review_has_reviewer_feedback.py');
    assert.ok(ifStep);
    const thenBranch = Array.isArray(ifStep.then)
        ? (ifStep.then as Array<Record<string, unknown>>)
        : [];
    assert.ok(flattenFlowSteps(thenBranch).some((step) => step.commandName === 'external_review_findings'));
});
Then('the GitHub review flow variant closes the PR only when review work restarts the internal flow', () => {
    assert.ok(checkedInGitHubReviewFlow?.steps);
    const flattened = flattenFlowSteps(checkedInGitHubReviewFlow.steps ?? []);
    const closeSteps = flattened.filter((step) => step.type === 'github_close_pr');
    assert.equal(closeSteps.length, 1);
    assert.equal(closeSteps[0]?.label, 'Close GitHub Review Pull Request Before Internal Review Restart');
});
Given('the GitHub review clean-cycle runtime fixture is available', async () => {
    assert(tempDir, 'expected temporary flows directory');
    const workingRoot = path.join(tempDir, 'github-review-clean-repo');
    await createGitHubReviewRuntimeRepoFixture({
        root: workingRoot,
        reviewCount: 0,
    });
    await writeGitHubReviewRuntimeFlow({
        flowName: 'github-review-runtime-clean',
        thenSteps: [
            {
                type: 'llm',
                agentType: 'missing_agent',
                identifier: 'untaken-findings',
                messages: [
                    {
                        role: 'user',
                        content: ['Untaken findings branch should stay excluded.'],
                    },
                ],
            },
        ],
        elseSteps: [
            {
                type: 'llm',
                agentType: 'planning_agent',
                identifier: 'main',
                messages: [
                    {
                        role: 'user',
                        content: ['Clean-cycle branch stayed reachable.'],
                    },
                ],
            },
        ],
    });
    activeFlowWorkingFolder = workingRoot;
    activeListIngestedRepositories = () => listHarnessRepo(workingRoot);
});
Given('the GitHub review findings-present runtime fixture is available', async () => {
    assert(tempDir, 'expected temporary flows directory');
    const workingRoot = path.join(tempDir, 'github-review-findings-repo');
    await createGitHubReviewRuntimeRepoFixture({
        root: workingRoot,
        reviewCount: 2,
        commentCount: 1,
    });
    await writeGitHubReviewRuntimeFlow({
        flowName: 'github-review-runtime-findings',
        thenSteps: [
            {
                type: 'llm',
                agentType: 'planning_agent',
                identifier: 'main',
                messages: [
                    {
                        role: 'user',
                        content: ['Findings branch stayed reachable.'],
                    },
                ],
            },
        ],
        elseSteps: [
            {
                type: 'command',
                agentType: 'planning_agent',
                identifier: 'untaken-clean',
                commandName: 'missing_command',
            },
            {
                type: 'llm',
                agentType: 'planning_agent',
                identifier: 'main',
                messages: [
                    {
                        role: 'user',
                        content: ['Untaken clean branch should stay excluded.'],
                    },
                ],
            },
        ],
    });
    activeFlowWorkingFolder = workingRoot;
    activeListIngestedRepositories = () => listHarnessRepo(workingRoot);
});
Given('the GitHub review resumed runtime fixture is available', async () => {
    assert(tempDir, 'expected temporary flows directory');
    const workingRoot = path.join(tempDir, 'github-review-resume-repo');
    await createGitHubReviewRuntimeRepoFixture({
        root: workingRoot,
        reviewCount: 1,
        commentCount: 1,
        legacyReviewCount: 0,
        legacyCommentCount: 0,
    });
    __setFlowWaitResumeDepsForTests({
        scheduleWake: ({ onWake }) => {
            capturedWaitWake = onWake;
            return { cancel: () => { } };
        },
    });
    await writeGitHubReviewRuntimeFlow({
        flowName: 'github-review-runtime-resume',
        includeWait: true,
        thenSteps: [
            {
                type: 'llm',
                agentType: 'planning_agent',
                identifier: 'main',
                messages: [
                    {
                        role: 'user',
                        content: ['Resumed review context stayed on findings branch.'],
                    },
                ],
            },
        ],
        elseSteps: [
            {
                type: 'command',
                agentType: 'planning_agent',
                identifier: 'untaken-clean',
                commandName: 'missing_command',
            },
            {
                type: 'llm',
                agentType: 'planning_agent',
                identifier: 'main',
                messages: [
                    {
                        role: 'user',
                        content: ['Stale clean-cycle scratch should stay excluded.'],
                    },
                ],
            },
        ],
    });
    activeFlowWorkingFolder = workingRoot;
    activeListIngestedRepositories = () => listHarnessRepo(workingRoot);
});
Given('a flow execution test server', () => {
    assert.ok(server, 'expected test server to be running');
});
Given('the flow execution fixture {string} is available', async (flowName: string) => {
    assert(tempDir, 'expected temporary flows directory');
    await fs.writeFile(path.join(tempDir, `${flowName}.json`), JSON.stringify({
        description: 'Story 53 flow execution fixture',
        steps: [
            {
                type: 'llm',
                label: 'Step 1',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [{ role: 'user', content: ['Step 1'] }],
            },
            {
                type: 'llm',
                label: 'Step 2',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [{ role: 'user', content: ['Step 2'] }],
            },
        ],
    }, null, 2), 'utf8');
});
Given('the wait resume flow execution fixture is available', async () => {
    assert(tempDir, 'expected temporary flows directory');
    __setFlowWaitResumeDepsForTests({
        scheduleWake: ({ onWake }) => {
            capturedWaitWake = onWake;
            return { cancel: () => { } };
        },
    });
    await fs.writeFile(path.join(tempDir, 'wait-resume.json'), JSON.stringify({
        description: 'Story 60 wait resume fixture',
        steps: [
            {
                type: 'llm',
                label: 'Before wait',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [{ role: 'user', content: ['Step 1'] }],
            },
            {
                type: 'wait',
                label: 'Pause here',
                seconds: 60,
            },
            {
                type: 'llm',
                label: 'After wait',
                agentType: 'coding_agent',
                identifier: 'resume-test',
                messages: [{ role: 'user', content: ['Step 2'] }],
            },
        ],
    }, null, 2), 'utf8');
});
Given('the flow state write fails once', () => {
    // Keep a DB-level override when running against Mongo, but fall back to
    // memory-persistence overrides when the tests are running in memory mode.
    if (!originalConversationFindByIdAndUpdate) {
        originalConversationFindByIdAndUpdate = ConversationModel.findByIdAndUpdate;
    }
    if (shouldUseMemoryPersistence()) {
        // Memory-mode: override Map.set so that an attempt to set flags.flow fails once.
        if (!originalMemoryConversationsSet) {
            originalMemoryConversationsSet = memoryConversations.set;
        }
        let shouldFail = true;
        memoryConversations.set = ((key: string, value: Conversation) => {
            if (shouldFail &&
                value?.flags &&
                Object.prototype.hasOwnProperty.call(value.flags, 'flow')) {
                shouldFail = false;
                throw new Error('boom');
            }
            return originalMemoryConversationsSet!.call(memoryConversations, key, value);
        }) as typeof memoryConversations.set;
        return;
    }
    let shouldFail = true;
    ConversationModel.findByIdAndUpdate = ((id: unknown, update: unknown, options: unknown) => {
        const candidate = update as {
            $set?: Record<string, unknown>;
        } | null;
        if (shouldFail &&
            candidate?.$set &&
            Object.prototype.hasOwnProperty.call(candidate.$set, 'flags.flow')) {
            shouldFail = false;
            throw new Error('boom');
        }
        const updateQuery = update as Parameters<typeof ConversationModel.findByIdAndUpdate>[1];
        const updateOptions = options as Parameters<typeof ConversationModel.findByIdAndUpdate>[2];
        return originalConversationFindByIdAndUpdate!.call(ConversationModel, id, updateQuery, updateOptions);
    }) as typeof ConversationModel.findByIdAndUpdate;
});
When('I start flow {string} with conversation id {string}', async (flowName: string, conversationId: string) => {
    const res = await fetch(`${baseUrl}/flows/${flowName}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId }),
    });
    lastResponse = {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
    };
});
When('I start flow {string} using the active flow working folder with conversation id {string}', async (flowName: string, conversationId: string) => {
    assert(activeFlowWorkingFolder, 'expected active flow working folder');
    const res = await fetch(`${baseUrl}/flows/${flowName}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            conversationId,
            working_folder: activeFlowWorkingFolder,
            retryOwnershipId: `${flowName}:${conversationId}`,
        }),
    });
    lastResponse = {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
    };
});
When('I start flow {string} with remembered conversation {string}', async (flowName: string, key: string) => {
    const conversationId = rememberedConversationIds.get(key);
    assert(conversationId, `Missing remembered conversation ${key}`);
    const res = await fetch(`${baseUrl}/flows/${flowName}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId }),
    });
    lastResponse = {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
    };
});
When('I start flow {string} with conversation id {string} and retry ownership {string}', async (flowName: string, conversationId: string, retryOwnershipId: string) => {
    const res = await fetch(`${baseUrl}/flows/${flowName}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, retryOwnershipId }),
    });
    lastResponse = {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
    };
});
When('I resume flow {string} for remembered conversation {string} from step path:', async (flowName: string, key: string, table: DataTable) => {
    const conversationId = rememberedConversationIds.get(key);
    assert(conversationId, `Missing remembered conversation ${key}`);
    const resumeStepPath = table
        .raw()
        .flat()
        .map((value) => Number(value));
    const res = await fetch(`${baseUrl}/flows/${flowName}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, resumeStepPath }),
    });
    lastResponse = {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
    };
});
When('I resume flow {string} using the active flow working folder for remembered conversation {string} from step path:', async (flowName: string, key: string, table: DataTable) => {
    const conversationId = rememberedConversationIds.get(key);
    assert(conversationId, `Missing remembered conversation ${key}`);
    assert(activeFlowWorkingFolder, 'expected active flow working folder');
    const resumeStepPath = table
        .raw()
        .flat()
        .map((value) => Number(value));
    const res = await fetch(`${baseUrl}/flows/${flowName}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            conversationId,
            working_folder: activeFlowWorkingFolder,
            resumeStepPath,
        }),
    });
    lastResponse = {
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
    };
});
Then('the flow execution response status code is {int}', (status: number) => {
    assert(lastResponse, 'expected flow execution response');
    assert.equal(lastResponse.status, status);
});
When('I remember the started conversation as {string}', (key: string) => {
    assert(lastResponse, 'expected flow execution response');
    const conversationId = lastResponse.body.conversationId;
    assert.equal(typeof conversationId, 'string');
    rememberedConversationIds.set(key, conversationId as string);
});
When('I record the stored flow execution id for {string} as {string}', async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    assert(conversationId, `Missing remembered conversation ${conversationKey}`);
    rememberedExecutionIds.set(executionKey, await getStoredExecutionId(conversationId));
});
Then('remembered conversations {string} and {string} are different', (left: string, right: string) => {
    assert.notEqual(rememberedConversationIds.get(left), rememberedConversationIds.get(right));
});
Then('the stored flow execution id for {string} differs from {string}', async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    const rememberedExecutionId = rememberedExecutionIds.get(executionKey);
    assert(conversationId, `Missing remembered conversation ${conversationKey}`);
    assert(rememberedExecutionId, `Missing remembered execution ${executionKey}`);
    assert.notEqual(await getStoredExecutionId(conversationId), rememberedExecutionId);
});
Then('the latest started conversation matches {string}', (conversationKey: string) => {
    assert(lastResponse, 'expected flow execution response');
    assert.equal(lastResponse.body.conversationId, rememberedConversationIds.get(conversationKey));
});
Then('the stored flow execution id for {string} still matches {string}', async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    const rememberedExecutionId = rememberedExecutionIds.get(executionKey);
    assert(conversationId, `Missing remembered conversation ${conversationKey}`);
    assert(rememberedExecutionId, `Missing remembered execution ${executionKey}`);
    assert.equal(await getStoredExecutionId(conversationId), rememberedExecutionId);
});
Then('the child conversation execution id for {string} matches {string}', async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    const rememberedExecutionId = rememberedExecutionIds.get(executionKey);
    assert(conversationId, `Missing remembered conversation ${conversationKey}`);
    assert(rememberedExecutionId, `Missing remembered execution ${executionKey}`);
    const childConversationId = await getStoredChildConversationId(conversationId);
    assert.equal(await getStoredChildExecutionId(childConversationId), rememberedExecutionId);
});
Then('the active flow conversation stores a persisted wait at step path {string}', async (expectedPath: string) => {
    assert(lastResponse, 'expected flow execution response');
    const conversationId = String(lastResponse.body.conversationId ?? '');
    assert(conversationId, 'expected started conversation id');
    const expectedStepPath = expectedPath.split('.').map(Number);
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const conversation = await waitForConversation(conversationId);
        const waitState = ((conversation.flags ?? {}) as {
            flow?: {
                wait?: {
                    stepPath?: number[];
                };
            };
        }).flow?.wait;
        if (Array.isArray(waitState?.stepPath) &&
            waitState.stepPath.length === expectedStepPath.length &&
            waitState.stepPath.every((value, index) => value === expectedStepPath[index])) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for persisted wait step path ${expectedPath} on conversation ${conversationId}`);
});
When('I trigger the captured wait wake', async () => {
    assert(capturedWaitWake, 'expected a captured wait wake callback');
    capturedWaitWake();
});
Then('the active flow conversation clears its persisted wait', async () => {
    assert(lastResponse, 'expected flow execution response');
    const conversationId = String(lastResponse.body.conversationId ?? '');
    assert(conversationId, 'expected started conversation id');
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const conversation = await waitForConversation(conversationId);
        const waitState = ((conversation.flags ?? {}) as {
            flow?: {
                wait?: unknown;
            };
        }).flow?.wait;
        if (waitState === undefined) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail('Timed out waiting for persisted wait state to clear');
});
Then('the active flow conversation eventually contains user text {string}', async (text: string) => {
    assert(lastResponse, 'expected flow execution response');
    const conversationId = String(lastResponse.body.conversationId ?? '');
    assert(conversationId, 'expected started conversation id');
    const turns = await waitForTurns(conversationId, (items) => items.some((turn) => turn.role === 'user' && turn.content?.includes(text)), 4000);
    assert.ok(turns.some((turn) => turn.role === 'user' && turn.content?.includes(text)));
});
Then('the active flow conversation user texts exclude {string}', async (text: string) => {
    assert(lastResponse, 'expected flow execution response');
    const conversationId = String(lastResponse.body.conversationId ?? '');
    assert(conversationId, 'expected started conversation id');
    const turns = await getStoredTurns(conversationId);
    assert.equal(turns.filter((turn) => turn.role === 'user' && turn.content?.includes(text)).length, 0);
});
