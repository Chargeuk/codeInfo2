import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  CopilotSession,
  SessionEvent,
  SessionEventHandler,
} from '@github/copilot-sdk';
import mongoose from 'mongoose';
import { runAgentCommandRunner } from '../../agents/commandsRunner.js';
import {
  __resetAgentServiceDepsForTests,
  __setAgentServiceDepsForTests,
  runAgentInstructionUnlocked,
} from '../../agents/service.js';
import { CopilotLifecycle } from '../../chat/copilotLifecycle.js';
import {
  ForkInstructionOutcomeUnknownError,
  sendPendingForkHandover,
} from '../../chat/forkHandover.js';
import { getInflight } from '../../chat/inflightRegistry.js';
import { ChatInterfaceCopilot } from '../../chat/interfaces/ChatInterfaceCopilot.js';
import { resolveCodexCapabilities } from '../../codex/capabilityResolver.js';
import { query } from '../../logStore.js';
import {
  ConversationModel,
  type Conversation,
} from '../../mongo/conversation.js';
import type { AppendTurnInput } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';
import { withIsolatedProviderHomeTestEnv } from '../support/providerHomeHarness.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

async function withCommand(run: (agentHome: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fork-command-retry-'));
  try {
    await fs.mkdir(path.join(root, 'commands'));
    await fs.writeFile(
      path.join(root, 'commands', 'task.json'),
      JSON.stringify({
        Description: 'First instruction on a fork',
        items: [{ type: 'message', role: 'user', content: ['Do the task'] }],
      }),
    );
    await runWithTestEnvOverrides({ FLOW_AND_COMMAND_RETRIES: '3' }, () =>
      run(root),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const userEvent = (content: string) =>
  ({ type: 'user.message', data: { content } }) as SessionEvent;

for (const lost of ['acknowledgement', 'idle'] as const) {
  test(`accepted first fork batch with lost ${lost} is not automatically replayed, but a later intentional instruction is allowed`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await withCommand(async (agentHome) => {
      const timeoutMs = resolveConfiguredTestTimeoutMs(1000);
      const events: SessionEvent[] = [];
      let listener: SessionEventHandler | undefined;
      let batches = 0;
      let attempts = 0;
      let nextInstructions = 0;
      let acknowledged = 0;
      let backoffs = 0;
      let accepted!: () => void;
      const dispatched = new Promise<void>((resolve) => {
        accepted = resolve;
      });
      const session = {
        getEvents: async () => events,
        on: (handler: SessionEventHandler) => {
          listener = handler;
          return () => {
            listener = undefined;
          };
        },
        rpc: {
          sendMessages: async (request: {
            messages: Array<{ prompt: string }>;
          }) => {
            batches++;
            events.push(
              ...request.messages.map(({ prompt }) => userEvent(prompt)),
            );
            accepted();
            if (lost === 'acknowledgement')
              throw new Error('Lost native acknowledgement');
            // The batch was accepted, but this run never receives its terminal idle event.
          },
        },
        sendAndWait: async ({ prompt }: { prompt: string }) => {
          nextInstructions++;
          events.push(userEvent(prompt));
        },
      } as unknown as CopilotSession;
      const markDelivered = async () => {
        acknowledged++;
      };
      const run = runAgentCommandRunner({
        agentName: 'target',
        agentHome,
        commandName: 'task',
        conversationId: crypto.randomUUID(),
        source: 'REST',
        sleep: async () => {
          backoffs++;
        },
        runAgentInstructionUnlocked: async ({ instruction, signal }) => {
          attempts++;
          await sendPendingForkHandover({
            session,
            handovers: ['Target handover'],
            instruction,
            timeoutMs,
            signal,
            markDelivered,
          });
          return { modelId: 'copilot-gpt-5' };
        },
      });
      const rejected = assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof ForkInstructionOutcomeUnknownError);
        assert.equal(error.code, 'FORK_INSTRUCTION_OUTCOME_UNKNOWN');
        assert.match(
          error.message,
          lost === 'idle' ? /Timeout/ : /Lost native acknowledgement/,
        );
        return true;
      });
      await Promise.race([
        dispatched,
        rejected.then(() => {
          throw new Error('Command failed before the native acceptance gate');
        }),
      ]);
      if (lost === 'idle') t.mock.timers.tick(timeoutMs);
      await rejected;
      assert.equal(attempts, 1);
      assert.equal(backoffs, 0);
      assert.equal(batches, 1);
      assert.equal(nextInstructions, 0);
      assert.equal(acknowledged, 0);
      assert.equal(listener, undefined);
      assert.deepEqual(
        events.map((event) =>
          event.type === 'user.message' ? event.data.content : '',
        ),
        ['Target handover', 'Do the task'],
      );

      // Identical text on a later intentional request is permitted: this guard
      // suppresses automatic replay, not user messages or repeated task text.
      await sendPendingForkHandover({
        session,
        handovers: ['Target handover'],
        instruction: 'Do the task',
        timeoutMs,
        markDelivered,
      });
      assert.equal(batches, 1);
      assert.equal(nextInstructions, 1);
      assert.equal(acknowledged, 1);
      assert.deepEqual(
        events.map((event) =>
          event.type === 'user.message' ? event.data.content : '',
        ),
        ['Target handover', 'Do the task', 'Do the task'],
      );
    });
  });
}

test('ordinary errors before first-batch dispatch retain command retries and deliver one handover', async () => {
  await withCommand(async (agentHome) => {
    let attempts = 0;
    let reads = 0;
    let batches = 0;
    let acknowledged = 0;
    let backoffs = 0;
    let listener: SessionEventHandler | undefined;
    const messages: string[] = [];
    const session = {
      getEvents: async () => {
        if (++reads === 1)
          throw new Error('Temporary provider preparation failure');
        return [];
      },
      on: (handler: SessionEventHandler) => {
        listener = handler;
        return () => {
          listener = undefined;
        };
      },
      rpc: {
        sendMessages: async (request: {
          messages: Array<{ prompt: string }>;
        }) => {
          batches++;
          messages.push(...request.messages.map(({ prompt }) => prompt));
          listener?.({ type: 'session.idle', data: {} } as SessionEvent);
        },
      },
    } as unknown as CopilotSession;
    await runAgentCommandRunner({
      agentName: 'target',
      agentHome,
      commandName: 'task',
      conversationId: crypto.randomUUID(),
      source: 'REST',
      sleep: async () => {
        backoffs++;
      },
      runAgentInstructionUnlocked: async ({ instruction, signal }) => {
        attempts++;
        await sendPendingForkHandover({
          session,
          handovers: ['Target handover'],
          instruction,
          timeoutMs: resolveConfiguredTestTimeoutMs(1000),
          signal,
          markDelivered: async () => {
            acknowledged++;
          },
        });
        return { modelId: 'copilot-gpt-5' };
      },
    });
    assert.equal(attempts, 2);
    assert.equal(backoffs, 1);
    assert.equal(batches, 1);
    assert.equal(acknowledged, 1);
    assert.equal(messages[0], 'Target handover');
    assert.match(messages[1], /Temporary provider preparation failure/);
    assert.ok(
      messages[1].endsWith('\n\nDo the task') ||
        messages[1].endsWith('\nDo the task'),
    );
    assert.equal(listener, undefined);
  });
});

test('an explicit provider run failure keeps ordinary retries without batching the delivered handover again', async () => {
  await withCommand(async (agentHome) => {
    const events: SessionEvent[] = [];
    let listener: SessionEventHandler | undefined;
    let attempts = 0;
    let batches = 0;
    let nextInstructions = 0;
    let backoffs = 0;
    const session = {
      getEvents: async () => events,
      on: (handler: SessionEventHandler) => {
        listener = handler;
        return () => {
          listener = undefined;
        };
      },
      rpc: {
        sendMessages: async (request: {
          messages: Array<{ prompt: string }>;
        }) => {
          batches++;
          events.push(
            ...request.messages.map(({ prompt }) => userEvent(prompt)),
          );
          listener?.({
            type: 'session.error',
            data: { message: 'Provider run failed' },
          } as SessionEvent);
        },
      },
      sendAndWait: async ({ prompt }: { prompt: string }) => {
        nextInstructions++;
        assert.match(prompt, /Provider run failed/);
        events.push(userEvent(prompt));
      },
    } as unknown as CopilotSession;
    await runAgentCommandRunner({
      agentName: 'target',
      agentHome,
      commandName: 'task',
      conversationId: crypto.randomUUID(),
      source: 'REST',
      sleep: async () => {
        backoffs++;
      },
      runAgentInstructionUnlocked: async ({ instruction, signal }) => {
        attempts++;
        await sendPendingForkHandover({
          session,
          handovers: ['Target handover'],
          instruction,
          timeoutMs: resolveConfiguredTestTimeoutMs(1000),
          signal,
          markDelivered: async () => {},
        });
        return { modelId: 'copilot-gpt-5' };
      },
    });
    assert.equal(attempts, 2);
    assert.equal(backoffs, 1);
    assert.equal(batches, 1);
    assert.equal(nextInstructions, 1);
    assert.equal(
      events.filter(
        (event) =>
          event.type === 'user.message' &&
          event.data.content === 'Target handover',
      ).length,
      1,
    );
    assert.equal(listener, undefined);
  });
});

for (const outcome of ['uncertain', 'ordinary'] as const) {
  test(`real Copilot chat/service persistence preserves ${outcome} command retry behavior after an assistant write failure`, async (t) => {
    await withCommand(async (agentHome) => {
      const agentsHome = path.join(agentHome, 'catalog');
      const targetHome = path.join(agentsHome, 'target');
      await fs.mkdir(targetHome, { recursive: true });
      await fs.writeFile(
        path.join(targetHome, 'config.toml'),
        'codeinfo_provider = "copilot"\nmodel = "copilot-gpt-5"\n',
      );
      await withIsolatedProviderHomeTestEnv(
        {
          prefix: 'fork-persistence-retry-',
          overrides: {
            NODE_ENV: 'development',
            CODEINFO_AGENT_HOME: agentsHome,
            CODEINFO_CODEX_AGENT_HOME: agentsHome,
            CODEX_WORKDIR: agentHome,
          },
        },
        async (homes) => {
          const readyStateDescriptor = Object.getOwnPropertyDescriptor(
            mongoose.connection,
            'readyState',
          );
          Object.defineProperty(mongoose.connection, 'readyState', {
            value: 1,
            configurable: true,
          });
          try {
            const conversationId = crypto.randomUUID();
            const now = new Date();
            const conversation: Conversation = {
              _id: conversationId,
              provider: 'copilot',
              model: 'copilot-gpt-5',
              agentName: 'target',
              title: 'Fork target',
              flags: {},
              source: 'REST',
              archivedAt: null,
              createdAt: now,
              updatedAt: now,
              lastMessageAt: now,
              fork: {
                requestId: crypto.randomUUID(),
                sourceConversationId: crypto.randomUUID(),
                sourceTurnId: 'source-response',
                sourceAgentName: 'source',
                targetAgentName: 'target',
                nativeSessionId: crypto.randomUUID(),
                estimated: false,
                handover: 'Target handover',
                handoverDelivered: false,
              },
            };
            const acknowledgementError = new Error(
              'Handover Mongo acknowledgement failed',
            );
            const assistantWriteError = new Error(
              'Assistant Mongo write failed',
            );
            const events: SessionEvent[] = [];
            const writeRoles: string[] = [];
            let listener: SessionEventHandler | undefined;
            let onEvent: SessionEventHandler | undefined;
            let attempts = 0;
            let batches = 0;
            let acknowledgements = 0;
            let assistantWrites = 0;
            let backoffs = 0;
            let nextInstructions = 0;
            let disconnects = 0;
            let stops = 0;
            const session = {
              getEvents: async () => events,
              on: (handler: SessionEventHandler) => {
                listener = handler;
                return () => {
                  listener = undefined;
                };
              },
              rpc: {
                mcp: { list: async () => ({ servers: [] }) },
                sendMessages: async (request: {
                  messages: Array<{ prompt: string }>;
                }) => {
                  batches++;
                  events.push(
                    ...request.messages.map(({ prompt }) => userEvent(prompt)),
                  );
                  const event =
                    outcome === 'uncertain'
                      ? { type: 'session.idle', data: {} }
                      : {
                          type: 'session.error',
                          data: { message: 'Known provider run failure' },
                        };
                  onEvent?.(event as SessionEvent);
                  listener?.(event as SessionEvent);
                },
              },
              sendAndWait: async ({ prompt }: { prompt: string }) => {
                nextInstructions++;
                // Ordinary error precedence remains the persistence failure, so
                // the existing retry instruction still explains that failure.
                assert.match(prompt, /Assistant Mongo write failed/);
                events.push(userEvent(prompt));
                onEvent?.({ type: 'session.idle', data: {} } as SessionEvent);
              },
              disconnect: async () => {
                disconnects++;
              },
            } as unknown as CopilotSession;
            const lifecycle = new CopilotLifecycle({
              copilotHome: homes.copilotHome,
              clientFactory: () => ({
                start: async () => {},
                stop: async () => {
                  stops++;
                  return [];
                },
                ping: async () => {
                  throw new Error('Unexpected ping');
                },
                getAuthStatus: async () => {
                  throw new Error('Unexpected auth');
                },
                listModels: async () => {
                  throw new Error('Unexpected models');
                },
                createSession: async () => {
                  throw new Error('Fork must resume');
                },
                resumeSession: async (sessionId, config) => {
                  assert.equal(sessionId, conversation.fork!.nativeSessionId);
                  onEvent = config.onEvent;
                  return session;
                },
              }),
            });
            __setAgentServiceDepsForTests({
              getCodexDetection: () => ({
                available: false,
                authPresent: false,
                configPresent: true,
              }),
              resolveCodexCapabilities: (options) =>
                resolveCodexCapabilities({
                  ...options,
                  codexHome: homes.codexHome,
                }),
              getMcpStatus: async () => ({ available: true }),
              resolveCopilotReadiness: async () => ({
                available: true,
                toolsAvailable: true,
                blockingStage: 'ready',
                models: ['copilot-gpt-5'],
                modelsRaw: [],
                authSource: 'sdk-status',
              }),
              getLmStudioBaseUrl: () => undefined,
              createAgentAvailabilityContext: async () => ({
                providerStates: {
                  codex: { providerId: 'codex', available: false },
                  copilot: { providerId: 'copilot', available: true },
                  lmstudio: { providerId: 'lmstudio', available: false },
                },
                fallbackCandidates: [],
              }),
            });
            // Mock Mongo I/O only: retain real appendTurn, metadata updates,
            // assistant persistence, Copilot chat execution and service rethrows.
            t.mock.method(ConversationModel, 'findById', () => ({
              lean: () => ({ exec: async () => structuredClone(conversation) }),
            }));
            t.mock.method(ConversationModel, 'findByIdAndUpdate', () => ({
              exec: async () => structuredClone(conversation),
            }));
            t.mock.method(ConversationModel, 'findOneAndUpdate', () => ({
              exec: async () => structuredClone(conversation),
            }));
            t.mock.method(ConversationModel, 'updateOne', async () => {
              acknowledgements++;
              if (outcome === 'uncertain') throw acknowledgementError;
              conversation.fork!.handoverDelivered = true;
              return { matchedCount: 1, modifiedCount: 1 };
            });
            t.mock.method(TurnModel, 'find', () => ({
              sort: () => ({ lean: () => ({ exec: async () => [] }) }),
            }));
            t.mock.method(
              TurnModel,
              'create',
              async (input: AppendTurnInput) => {
                writeRoles.push(input.role);
                if (input.role === 'assistant' && ++assistantWrites === 1)
                  throw assistantWriteError;
                return { _id: crypto.randomUUID(), ...structuredClone(input) };
              },
            );
            const run = runAgentCommandRunner({
              agentName: 'target',
              agentHome,
              commandName: 'task',
              conversationId,
              source: 'REST',
              sleep: async () => {
                backoffs++;
              },
              runAgentInstructionUnlocked: (params) => {
                attempts++;
                return runAgentInstructionUnlocked({
                  ...params,
                  chatFactory: () => new ChatInterfaceCopilot(lifecycle),
                });
              },
            });
            if (outcome === 'uncertain') {
              await assert.rejects(run, (error: unknown) => {
                assert.ok(error instanceof ForkInstructionOutcomeUnknownError);
                assert.equal(error.cause, acknowledgementError);
                return true;
              });
              assert.equal(attempts, 1);
              assert.equal(backoffs, 0);
              assert.equal(nextInstructions, 0);
              assert.equal(conversation.fork!.handoverDelivered, false);
              assert.deepEqual(writeRoles, ['user', 'assistant']);
              const logs = query({
                text: 'fork_instruction_uncertain_assistant_persistence_failed',
              }).filter(
                (entry) => entry.context?.conversationId === conversationId,
              );
              assert.equal(logs.length, 1);
              assert.equal(
                logs[0].context?.persistenceError,
                assistantWriteError.message,
              );
              assert.equal(
                logs[0].context?.code,
                'FORK_INSTRUCTION_OUTCOME_UNKNOWN',
              );
            } else {
              await run;
              assert.equal(attempts, 2);
              assert.equal(backoffs, 1);
              assert.equal(nextInstructions, 1);
              assert.equal(conversation.fork!.handoverDelivered, true);
              assert.deepEqual(writeRoles, [
                'user',
                'assistant',
                'user',
                'assistant',
              ]);
              assert.equal(
                query({
                  text: 'fork_instruction_uncertain_assistant_persistence_failed',
                }).filter(
                  (entry) => entry.context?.conversationId === conversationId,
                ).length,
                0,
              );
            }
            assert.equal(batches, 1);
            assert.equal(acknowledgements, 1);
            assert.equal(
              events.filter(
                (event) =>
                  event.type === 'user.message' &&
                  event.data.content === 'Target handover',
              ).length,
              1,
            );
            assert.equal(listener, undefined);
            assert.equal(disconnects, attempts);
            assert.equal(stops, attempts);
            assert.equal(getInflight(conversationId), undefined);
          } finally {
            __resetAgentServiceDepsForTests();
            t.mock.restoreAll();
            if (readyStateDescriptor)
              Object.defineProperty(
                mongoose.connection,
                'readyState',
                readyStateDescriptor,
              );
            else Reflect.deleteProperty(mongoose.connection, 'readyState');
          }
        },
      );
    });
  });
}
