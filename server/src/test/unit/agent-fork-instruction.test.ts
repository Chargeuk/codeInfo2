import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  getActiveRunOwnership,
  releaseConversationLock,
} from '../../agents/runLock.js';
import {
  runAgentInstruction,
  startAgentInstruction,
} from '../../agents/service.js';
import { abortInflight, getInflight } from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import {
  memoryConversations,
  memoryTurns,
} from '../../chat/memoryPersistence.js';
import type { Conversation } from '../../mongo/conversation.js';
import { createIsolatedProviderHomeEnv } from '../support/providerHomeHarness.js';
import { runWithTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

for (const outcome of [
  'complete',
  'error',
  'cancel',
  'deleted-before-preflight',
  'deleted-after-preflight',
  'default-create',
] as const) {
  test(
    outcome === 'default-create'
      ? 'ordinary startup without mustExist still creates a new conversation'
      : outcome.startsWith('deleted-')
        ? `mustExist child ${outcome} is never recreated or sent to the provider`
        : `normal Codex child handover returns before reply, persists ${outcome}, and resumes the same native child`,
    {
      timeout: resolveConfiguredTestTimeoutMs(30_000),
    },
    async () => {
      const homes = await createIsolatedProviderHomeEnv('fork-instruction-');
      const agentsHome = path.join(homes.tempRoot, 'agents');
      const agentHome = path.join(agentsHome, 'target');
      const conversationId = crypto.randomUUID();
      const entered = deferred();
      const release = deferred();
      const finished = deferred();
      const preflightPrepared = deferred();
      const releasePreflight = deferred();
      let preflightGated = false;
      let startupSettled:
        | Promise<Awaited<ReturnType<typeof startAgentInstruction>> | undefined>
        | undefined;
      let executions = 0;
      const captured: Array<{
        message: string;
        model: string;
        flags: Record<string, unknown>;
      }> = [];
      const handover =
        'Target prompt and fork context. ACKNOWLEDGE ONLY and await the next user instruction. Do not call tools or perform work.';

      class GatedChat extends ChatInterface {
        async execute(
          message: string,
          flags: Record<string, unknown>,
          _id: string,
          model: string,
        ) {
          executions++;
          captured.push({ message, model, flags });
          const signal = flags.signal as AbortSignal;
          entered.resolve();
          let onAbort!: () => void;
          const cancelled = new Promise<void>((resolve) => {
            onAbort = resolve;
            if (signal.aborted) resolve();
            else {
              signal.addEventListener('abort', onAbort, { once: true });
              if (signal.aborted) resolve();
            }
          });
          try {
            await Promise.race([release.promise, cancelled]);
            signal.throwIfAborted();
            if (outcome === 'error')
              throw new Error('Handover provider failed');
            this.emit('final', {
              type: 'final',
              content: 'Acknowledged. Awaiting your next instruction.',
            });
            this.emit('complete', {
              type: 'complete',
              threadId: 'native-child',
              native: { sessionId: 'native-child', turnId: 'handover-turn' },
            });
          } finally {
            signal.removeEventListener('abort', onAbort);
          }
        }
      }

      class NextChat extends ChatInterface {
        async execute(
          message: string,
          flags: Record<string, unknown>,
          _id: string,
          model: string,
        ) {
          captured.push({ message, model, flags });
          this.emit('final', { type: 'final', content: 'Next response' });
          this.emit('complete', { type: 'complete', threadId: 'native-child' });
        }
      }

      try {
        await fs.mkdir(agentHome, { recursive: true });
        // The saved fork model must survive later catalog model changes.
        await fs.writeFile(
          path.join(agentHome, 'config.toml'),
          'codeinfo_provider = "codex"\nmodel = "gpt-6.1-sol"\napproval_policy = "never"\nmodel_reasoning_effort = "high"\n',
        );
        const now = new Date();
        const conversation: Conversation = {
          _id: conversationId,
          agentName: 'target',
          provider: 'codex',
          model: 'gpt-6.1-terra',
          title: 'Fork target',
          flags: { threadId: 'native-child' },
          source: 'REST',
          createdAt: now,
          updatedAt: now,
          lastMessageAt: now,
          archivedAt: null,
          fork: {
            requestId: crypto.randomUUID(),
            sourceConversationId: crypto.randomUUID(),
            sourceTurnId: 'source-turn',
            sourceAgentName: 'source',
            targetAgentName: 'target',
            nativeSessionId: 'native-child',
            estimated: false,
            handover,
            handoverDelivered: false,
          },
        };
        memoryConversations.set(conversationId, conversation);
        await runWithTestOverrides(
          {
            codexDetection: {
              available: true,
              authPresent: true,
              configPresent: true,
            },
            envOverrides: {
              ...homes.envOverrides,
              NODE_ENV: 'test',
              CODEINFO_AGENT_HOME: agentsHome,
              CODEINFO_CODEX_AGENT_HOME: agentsHome,
              CODEX_WORKDIR: homes.tempRoot,
            },
            agentServiceDeps: {
              listIngestedRepositories: async () => ({
                repos: [],
                lockedModelId: null,
              }),
              getCodexDetection: () => ({
                available: true,
                authPresent: true,
                configPresent: true,
              }),
              resolveCodexCapabilities: async () => {
                // Preparation happens after the first conversation lookup and
                // before the unlocked background lookup. Hold that boundary.
                if (outcome === 'deleted-after-preflight' && !preflightGated) {
                  preflightGated = true;
                  preflightPrepared.resolve();
                  await releasePreflight.promise;
                }
                return {
                  defaults: {
                    sandboxMode: 'danger-full-access',
                    approvalPolicy: 'never',
                    modelReasoningEffort: 'high',
                    networkAccessEnabled: true,
                    webSearchEnabled: false,
                    webSearchMode: 'disabled',
                  },
                  models: ['gpt-6.1-sol', 'gpt-6.1-terra'].map((model) => ({
                    model,
                    supportedReasoningEfforts: [
                      'low',
                      'medium',
                      'high',
                      'xhigh',
                    ],
                    defaultReasoningEffort: 'high',
                  })),
                  byModel: new Map(),
                  warnings: [],
                  fallbackUsed: false,
                };
              },
              getMcpStatus: async () => ({ available: true }),
              resolveCopilotReadiness: async () => ({
                available: false,
                toolsAvailable: false,
                models: [],
                modelsRaw: [],
                reason: 'Outside test scope',
              }),
              getLmStudioBaseUrl: () => undefined,
              createAgentAvailabilityContext: async () => ({
                providerStates: {
                  codex: { providerId: 'codex', available: true },
                  copilot: { providerId: 'copilot', available: false },
                  lmstudio: { providerId: 'lmstudio', available: false },
                },
                fallbackCandidates: [],
              }),
            },
          },
          async () => {
            const startParams: Parameters<typeof startAgentInstruction>[0] = {
              agentName: 'target',
              conversationId,
              inflightId: `fork-${conversationId}`,
              instruction: handover,
              source: 'REST',
              ...(outcome === 'default-create' ? {} : { mustExist: true }),
              chatFactory: () => new GatedChat(),
              releaseConversationLockFn: (...args) => {
                const result = releaseConversationLock(...args);
                finished.resolve();
                return result;
              },
            };
            if (outcome === 'deleted-before-preflight') {
              memoryConversations.delete(conversationId);
              const startup = startAgentInstruction(startParams);
              startupSettled = startup.catch(() => undefined);
              await assert.rejects(startup, {
                code: 'AGENT_NOT_FOUND',
              });
              assert.equal(executions, 0);
              assert.equal(memoryConversations.has(conversationId), false);
              assert.equal(memoryTurns.has(conversationId), false);
              assert.equal(getActiveRunOwnership(conversationId), null);
              assert.equal(getInflight(conversationId), undefined);
              return;
            }
            if (outcome === 'default-create')
              memoryConversations.delete(conversationId);
            const startup = startAgentInstruction(startParams);
            // Observe rejection before waiting at any gate; finally also owns
            // accepted startup/background cleanup if an assertion fails.
            startupSettled = startup.catch(() => undefined);
            if (outcome === 'deleted-after-preflight') {
              await Promise.race([
                preflightPrepared.promise,
                startupSettled.then(() => {
                  throw new Error('Startup finished before its preflight gate');
                }),
              ]);
              assert.equal(memoryConversations.has(conversationId), true);
              memoryConversations.delete(conversationId);
              releasePreflight.resolve();
              const accepted = await startup;
              assert.equal(accepted.conversationId, conversationId);
              await finished.promise;
              assert.equal(executions, 0);
              assert.equal(memoryConversations.has(conversationId), false);
              assert.equal(memoryTurns.has(conversationId), false);
              assert.equal(getActiveRunOwnership(conversationId), null);
              assert.equal(getInflight(conversationId), undefined);
              return;
            }
            const accepted = await startup;
            // The provider is still held at its gate after startup has returned.
            await Promise.race([
              entered.promise,
              finished.promise.then(() => {
                throw new Error('Run ended before provider entry');
              }),
            ]);
            if (outcome === 'default-create') {
              assert.equal(accepted.conversationId, conversationId);
              assert.equal(accepted.providerId, 'codex');
              assert.equal(accepted.modelId, 'gpt-6.1-sol');
              assert.equal(
                memoryConversations.get(conversationId)?.model,
                'gpt-6.1-sol',
              );
              release.resolve();
              await finished.promise;
              assert.equal(executions, 1);
              assert.deepEqual(
                memoryTurns.get(conversationId)?.map((turn) => turn.status),
                ['ok', 'ok'],
              );
              assert.equal(getActiveRunOwnership(conversationId), null);
              assert.equal(getInflight(conversationId), undefined);
              return;
            }
            assert.equal(accepted.providerId, 'codex');
            assert.equal(accepted.modelId, 'gpt-6.1-terra');
            assert.ok(getActiveRunOwnership(conversationId));
            assert.equal(
              getInflight(conversationId)?.abortController.signal.aborted,
              false,
            );
            assert.deepEqual(
              memoryTurns
                .get(conversationId)
                ?.map((turn) => [turn.role, turn.content]),
              [['user', handover]],
            );
            assert.equal(captured[0].flags.threadId, 'native-child');
            assert.equal(
              (captured[0].flags.runtimeConfig as Record<string, unknown>)
                .approval_policy,
              'never',
            );
            assert.equal(
              (captured[0].flags.runtimeConfig as Record<string, unknown>)
                .model,
              'gpt-6.1-terra',
            );
            await assert.rejects(
              startAgentInstruction({
                agentName: 'target',
                conversationId,
                instruction: 'Too early',
                source: 'REST',
              }),
              { code: 'RUN_IN_PROGRESS' },
            );
            if (outcome === 'cancel')
              assert.equal(
                abortInflight({
                  conversationId,
                  inflightId: accepted.inflightId,
                }).ok,
                true,
              );
            release.resolve();
            await finished.promise;
            assert.equal(executions, 1);
            assert.equal(getInflight(conversationId), undefined);
            assert.equal(getActiveRunOwnership(conversationId), null);
            assert.equal(
              memoryConversations.get(conversationId)?.flags.threadId,
              'native-child',
            );
            const turns = memoryTurns.get(conversationId)!;
            assert.equal(turns.length, 2);
            assert.equal(
              turns[1].status,
              outcome === 'complete'
                ? 'ok'
                : outcome === 'cancel'
                  ? 'stopped'
                  : 'failed',
            );
            if (outcome === 'complete')
              assert.deepEqual(turns[1].native, {
                sessionId: 'native-child',
                turnId: 'handover-turn',
              });
            await runAgentInstruction({
              agentName: 'target',
              conversationId,
              instruction: 'Next intentional instruction',
              source: 'REST',
              chatFactory: () => new NextChat(),
            });
            assert.equal(captured[1].model, 'gpt-6.1-terra');
            assert.equal(captured[1].flags.threadId, 'native-child');
            assert.equal(
              (captured[1].flags.runtimeConfig as Record<string, unknown>)
                .model,
              'gpt-6.1-terra',
            );
            assert.equal(
              memoryConversations.get(conversationId)?.provider,
              'codex',
            );
            assert.equal(
              memoryTurns
                .get(conversationId)
                ?.filter((turn) => turn.content === handover).length,
              1,
            );
          },
        );
      } finally {
        releasePreflight.resolve();
        release.resolve();
        if (startupSettled && (await startupSettled)) await finished.promise;
        memoryTurns.delete(conversationId);
        memoryConversations.delete(conversationId);
        await homes.cleanup();
      }
    },
  );
}
