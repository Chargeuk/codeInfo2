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

for (const outcome of ['complete', 'error', 'cancel'] as const) {
  test(
    `normal Codex child handover returns before reply, persists ${outcome}, and resumes the same native child`,
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
      let started = false;
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
              resolveCodexCapabilities: async () => ({
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
                  supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
                  defaultReasoningEffort: 'high',
                })),
                byModel: new Map(),
                warnings: [],
                fallbackUsed: false,
              }),
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
            const accepted = await startAgentInstruction({
              agentName: 'target',
              conversationId,
              inflightId: `fork-${conversationId}`,
              instruction: handover,
              source: 'REST',
              chatFactory: () => new GatedChat(),
              releaseConversationLockFn: (...args) => {
                const result = releaseConversationLock(...args);
                finished.resolve();
                return result;
              },
            });
            started = true;
            // The provider is still held at its gate after startup has returned.
            await Promise.race([
              entered.promise,
              finished.promise.then(() => {
                throw new Error('Run ended before provider entry');
              }),
            ]);
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
        release.resolve();
        if (started) await finished.promise;
        memoryTurns.delete(conversationId);
        memoryConversations.delete(conversationId);
        await homes.cleanup();
      }
    },
  );
}
