import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { attachChatStreamBridge } from '../../chat/chatStreamBridge.js';
import {
  cleanupInflight,
  createInflight,
  getCompletedInflight,
  getInflight,
} from '../../chat/inflightRegistry.js';
import { ChatInterface } from '../../chat/interfaces/ChatInterface.js';
import { memoryTurns } from '../../chat/memoryPersistence.js';
import type { Conversation } from '../../mongo/conversation.js';
import {
  appendTurn,
  listAllTurns,
  listTurns,
  type AppendTurnInput,
} from '../../mongo/repo.js';
import { TurnModel, type TurnSource } from '../../mongo/turn.js';
import { createConversationsRouter } from '../../routes/conversations.js';
import { attachWs, publishInflightSnapshot } from '../../ws/server.js';
import type {
  WsInflightSnapshotEvent,
  WsServerEvent,
  WsTurnFinalEvent,
  WsTurnPersistedEvent,
} from '../../ws/types.js';
import { withMockedMongoConversationPersistence } from '../support/conversationMongoPersistenceStub.js';
import { runWithTestEnvOverrides } from '../support/testEnvOverrideScope.js';
import {
  closeWs,
  connectWs,
  peekBufferedEvents,
  subscribeConversationAndWaitReady,
  waitForEvent,
} from '../support/wsClient.js';

const conversation = (conversationId: string): Conversation => ({
  _id: conversationId,
  title: 'Receipt metadata',
  model: 'receipt-model',
  provider: 'codex',
  source: 'REST',
  flags: {},
  archivedAt: null,
  lastMessageAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

for (const failPersistence of [false, true]) {
  test(`receipt WS metadata preserves final status and ${failPersistence ? 'withholds failed persistence identity' : 'announces canonical identity after persistence'}`, async (t) => {
    const conversationId = `receipt-wire-${failPersistence ? 'failure' : 'success'}`;
    const identity = { conversationId, inflightId: `${conversationId}-run` };
    const startedAt = Date.parse('2026-01-01T00:00:00.000Z');
    t.mock.timers.enable({ apis: ['Date'], now: startedAt });
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    let persistenceEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      persistenceEntered = resolve;
    });
    let assistantInput: AppendTurnInput | undefined;

    class GatedChat extends ChatInterface {
      async execute(): Promise<void> {
        t.mock.timers.tick(100);
        this.emitEvent({ type: 'analysis', content: 'thinking' });
        t.mock.timers.tick(100);
        this.emitEvent({
          type: 'tool-request',
          callId: 'lookup-1',
          name: 'lookup',
          params: {},
        });
        t.mock.timers.tick(100);
        this.emitEvent({
          type: 'tool-result',
          callId: 'lookup-1',
          name: 'lookup',
          result: 'found',
        });
        t.mock.timers.tick(100);
        this.emitEvent({ type: 'error', message: 'Reconnecting... 1/5' });
        t.mock.timers.tick(100);
        this.emitEvent({ type: 'token', content: 'answer' });
        this.emitEvent({ type: 'final', content: 'answer' });
        t.mock.timers.tick(100);
        this.emitEvent({ type: 'complete', threadId: 'native-thread' });
        // The bridge's existing final guard rejects these late provider updates.
        t.mock.timers.tick(100);
        this.emitEvent({ type: 'token', content: 'late' });
        this.emitEvent({ type: 'error', message: 'Reconnecting... 2/5' });
      }

      protected override async persistTurn(
        input: AppendTurnInput & { source?: TurnSource },
      ) {
        if (input.role === 'assistant') {
          assistantInput = input;
          persistenceEntered();
          await persistenceGate;
          if (failPersistence) throw new Error('assistant write failed');
        }
        return super.persistTurn(input);
      }
    }

    await withMockedMongoConversationPersistence({
      seedConversations: [conversation(conversationId)],
      run: async ({ turns }) => {
        const httpServer = http.createServer(express());
        const wsHandle = attachWs({ httpServer });
        let ws: Awaited<ReturnType<typeof connectWs>> | undefined;
        const chat = new GatedChat();
        let bridge: ReturnType<typeof attachChatStreamBridge> | undefined;
        let run: Promise<void> | undefined;
        const pendingEvents: Promise<unknown>[] = [];
        try {
          await new Promise<void>((resolve) => httpServer.listen(0, resolve));
          const address = httpServer.address();
          assert(address && typeof address === 'object');
          ws = await connectWs({ baseUrl: `http://127.0.0.1:${address.port}` });
          createInflight({
            ...identity,
            provider: 'codex',
            model: 'receipt-model',
            userTurn: {
              content: 'question',
              createdAt: new Date(startedAt).toISOString(),
            },
          });
          await subscribeConversationAndWaitReady({ ws, conversationId });
          bridge = attachChatStreamBridge({
            ...identity,
            provider: 'codex',
            model: 'receipt-model',
            chat,
          });
          const finalPromise = waitForEvent({
            ws,
            predicate: (event): event is WsTurnFinalEvent =>
              (event as WsServerEvent).type === 'turn_final',
          });
          pendingEvents.push(finalPromise);
          void finalPromise.catch(() => {});
          run = chat.run(
            'question',
            { provider: 'codex', inflightId: identity.inflightId },
            conversationId,
            'receipt-model',
          );
          // Own a potential rejection immediately, including assertion-failure cleanup.
          void run.catch(() => {});
          await Promise.race([entered, run]);
          assert.ok(
            assistantInput,
            'expected to reach the assistant persistence gate',
          );
          const final = await finalPromise;
          const firstUpdateAt = new Date(startedAt + 100).toISOString();
          const lastUpdateAt = new Date(startedAt + 600).toISOString();
          assert.equal(final.status, 'ok');
          assert.equal(final.firstUpdateAt, firstUpdateAt);
          assert.equal(final.lastUpdateAt, lastUpdateAt);
          assert.equal(
            assistantInput?.firstUpdateAt?.toISOString(),
            firstUpdateAt,
          );
          assert.equal(
            assistantInput?.lastUpdateAt?.toISOString(),
            lastUpdateAt,
          );
          assert.equal(
            turns.filter((turn) => turn.role === 'assistant').length,
            0,
          );
          assert.equal(
            getInflight(conversationId)?.persisted?.assistant,
            false,
          );

          const updates = peekBufferedEvents(ws) as WsServerEvent[];
          const expectedOffsets = [
            ['analysis_delta', 100],
            ['tool_event', 200],
            ['tool_event', 300],
            ['stream_warning', 400],
            ['assistant_delta', 500],
          ] as const;
          const receiptEvents = updates.filter(
            (event) => 'firstUpdateAt' in event,
          );
          assert.equal(receiptEvents.length, expectedOffsets.length);
          receiptEvents.forEach((event, index) => {
            assert.equal(event.type, expectedOffsets[index][0]);
            assert.equal(
              'firstUpdateAt' in event && event.firstUpdateAt,
              firstUpdateAt,
            );
            assert.equal(
              'lastUpdateAt' in event && event.lastUpdateAt,
              new Date(startedAt + expectedOffsets[index][1]).toISOString(),
            );
          });

          // A snapshot is a deterministic WS fence while the assistant write is held.
          t.mock.timers.tick(5000);
          const fencePromise = waitForEvent({
            ws,
            predicate: (event): event is WsInflightSnapshotEvent => {
              const candidate = event as WsInflightSnapshotEvent;
              return (
                candidate.type === 'inflight_snapshot' &&
                candidate.seq > final.seq
              );
            },
          });
          pendingEvents.push(fencePromise);
          void fencePromise.catch(() => {});
          await subscribeConversationAndWaitReady({ ws, conversationId });
          const fence = await fencePromise;
          assert.equal(fence.inflight.firstUpdateAt, firstUpdateAt);
          assert.equal(fence.inflight.lastUpdateAt, lastUpdateAt);
          assert.equal(
            peekBufferedEvents(ws).some(
              (event) => (event as WsServerEvent).type === 'turn_persisted',
            ),
            false,
          );

          if (failPersistence) {
            const rejection = assert.rejects(run, /assistant write failed/);
            releasePersistence();
            await rejection;
            const failureFencePromise = waitForEvent({
              ws,
              predicate: (event): event is WsInflightSnapshotEvent => {
                const candidate = event as WsInflightSnapshotEvent;
                return (
                  candidate.type === 'inflight_snapshot' &&
                  candidate.seq > fence.seq
                );
              },
            });
            pendingEvents.push(failureFencePromise);
            void failureFencePromise.catch(() => {});
            publishInflightSnapshot(conversationId);
            await failureFencePromise;
            assert.equal(
              peekBufferedEvents(ws).some(
                (event) => (event as WsServerEvent).type === 'turn_persisted',
              ),
              false,
            );
            assert.equal(
              turns.filter((turn) => turn.role === 'assistant').length,
              0,
            );
          } else {
            const persistedPromise = waitForEvent({
              ws,
              predicate: (event): event is WsTurnPersistedEvent =>
                (event as WsServerEvent).type === 'turn_persisted',
            });
            pendingEvents.push(persistedPromise);
            void persistedPromise.catch(() => {});
            let inflightAtPersistence = false;
            chat.on('persisted', () => {
              inflightAtPersistence = Boolean(getInflight(conversationId));
            });
            releasePersistence();
            await run;
            bridge.finalize({ fallback: { status: 'failed' } });
            const persisted = await persistedPromise;
            const assistant = turns.find((turn) => turn.role === 'assistant');
            assert.ok(assistant);
            assert.deepEqual(persisted, {
              protocolVersion: 'v1',
              type: 'turn_persisted',
              ...identity,
              seq: fence.seq + 1,
              turnId: assistant._id,
              firstUpdateAt,
              lastUpdateAt,
            });
            assert.equal(inflightAtPersistence, true);
            assert.equal(assistant.status, 'ok');
            assert.equal(
              (assistant.firstUpdateAt as Date).toISOString(),
              firstUpdateAt,
            );
            assert.equal(
              (assistant.lastUpdateAt as Date).toISOString(),
              lastUpdateAt,
            );
            assert.equal(getInflight(conversationId), undefined);
            assert.equal(
              getCompletedInflight(identity)?.lastUpdateAt,
              lastUpdateAt,
            );
            assert.equal(getCompletedInflight(identity)?.finalStatus, 'ok');
            const newer = createInflight({
              conversationId,
              inflightId: 'newer-run',
            });
            chat.emit('persisted', {
              type: 'persisted',
              turnId: assistant._id,
            });
            assert.equal(newer.seq, 0);
            assert.equal(newer.firstUpdateAt, undefined);
          }
        } finally {
          releasePersistence();
          await run?.catch(() => {});
          await Promise.allSettled(pendingEvents);
          bridge?.cleanup();
          cleanupInflight({ conversationId });
          if (ws) await closeWs(ws);
          await wsHandle.close();
          if (httpServer.listening) {
            await new Promise<void>((resolve) =>
              httpServer.close(() => resolve()),
            );
          }
        }
      },
    });
  });
}

test('terminal-only updates establish receipt clocks and duplicate finals do not restamp', (t) => {
  const startedAt = Date.parse('2026-01-01T00:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: startedAt });
  class EmptyChat extends ChatInterface {
    async execute(): Promise<void> {
      return;
    }
  }
  for (const outcome of ['ok', 'failed'] as const) {
    const identity = {
      conversationId: `receipt-terminal-${outcome}`,
      inflightId: 'terminal-run',
    };
    createInflight(identity);
    const chat = new EmptyChat();
    const bridge = attachChatStreamBridge({
      ...identity,
      provider: 'codex',
      model: 'model',
      chat,
    });
    try {
      t.mock.timers.tick(100);
      if (outcome === 'ok') chat.emit('complete', { type: 'complete' });
      else chat.emit('error', { type: 'error', message: 'provider failed' });
      const receiptAt = new Date().toISOString();
      assert.equal(
        getInflight(identity.conversationId)?.firstUpdateAt,
        receiptAt,
      );
      assert.equal(
        getInflight(identity.conversationId)?.lastUpdateAt,
        receiptAt,
      );
      t.mock.timers.tick(1000);
      chat.emit('complete', { type: 'complete' });
      bridge.finalize({ fallback: { status: 'failed' } });
      assert.equal(
        getInflight(identity.conversationId)?.lastUpdateAt,
        receiptAt,
      );
      assert.equal(getInflight(identity.conversationId)?.finalStatus, outcome);
    } finally {
      bridge.cleanup();
      cleanupInflight(identity);
    }
  }
});

test('turn schema/repository/history preserve optional receipt dates and createdAt ordering', async () => {
  const conversationId = 'receipt-history';
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const firstUpdateAt = new Date('2026-02-01T00:00:00.000Z');
  const lastUpdateAt = new Date('2026-02-01T00:01:00.000Z');
  const base = {
    conversationId,
    role: 'assistant' as const,
    content: 'answer',
    provider: 'codex',
    model: 'receipt-model',
    status: 'ok' as const,
  };
  const oldDocument = new TurnModel({ ...base, createdAt });
  assert.equal(oldDocument.firstUpdateAt, undefined);
  assert.equal(oldDocument.lastUpdateAt, undefined);
  const newDocument = new TurnModel({
    ...base,
    createdAt,
    firstUpdateAt: firstUpdateAt.toISOString(),
    lastUpdateAt: lastUpdateAt.toISOString(),
  });
  assert.deepEqual(newDocument.firstUpdateAt, firstUpdateAt);
  assert.deepEqual(newDocument.lastUpdateAt, lastUpdateAt);

  await withMockedMongoConversationPersistence({
    seedConversations: [conversation(conversationId)],
    run: async () => {
      await appendTurn({ ...base, createdAt, firstUpdateAt, lastUpdateAt });
      await appendTurn({
        ...base,
        content: 'legacy',
        createdAt: new Date(createdAt.getTime() + 1),
      });
      for (const result of [
        await listTurns({ conversationId, limit: 10 }),
        await listAllTurns(conversationId),
      ]) {
        assert.deepEqual(
          result.items.map((turn) => turn.content),
          ['legacy', 'answer'],
        );
        assert.equal(result.items[0].firstUpdateAt, undefined);
        assert.equal(result.items[0].lastUpdateAt, undefined);
        assert.deepEqual(result.items[1].firstUpdateAt, firstUpdateAt);
        assert.deepEqual(result.items[1].lastUpdateAt, lastUpdateAt);
      }
      const app = express();
      app.use(createConversationsRouter());
      const response = await request(app)
        .get(`/conversations/${conversationId}/turns`)
        .expect(200);
      assert.equal(response.body.items[0].firstUpdateAt, undefined);
      assert.equal(response.body.items[0].lastUpdateAt, undefined);
      assert.equal(
        response.body.items[1].firstUpdateAt,
        firstUpdateAt.toISOString(),
      );
      assert.equal(
        response.body.items[1].lastUpdateAt,
        lastUpdateAt.toISOString(),
      );
    },
  });
});

test('ChatInterface without a WS bridge stamps synthetic failure receipts in memory', async (t) => {
  const conversationId = 'receipt-synthetic-error';
  const startedAt = Date.parse('2026-01-01T00:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: startedAt });
  class FailedChat extends ChatInterface {
    async execute(): Promise<void> {
      t.mock.timers.tick(100);
      this.emitEvent({ type: 'analysis', content: 'thinking' });
      t.mock.timers.tick(100);
      throw new Error('provider failed before terminal event');
    }
  }
  try {
    await runWithTestEnvOverrides({ NODE_ENV: 'test' }, async () => {
      await assert.rejects(
        new FailedChat().run('question', {}, conversationId, 'model'),
        /provider failed/,
      );
    });
    const [user, assistant] = memoryTurns.get(conversationId) ?? [];
    assert.equal(user.firstUpdateAt, undefined);
    assert.equal(assistant.status, 'failed');
    assert.equal(
      assistant.firstUpdateAt?.toISOString(),
      new Date(startedAt + 100).toISOString(),
    );
    assert.equal(
      assistant.lastUpdateAt?.toISOString(),
      new Date(startedAt + 200).toISOString(),
    );
  } finally {
    memoryTurns.delete(conversationId);
  }
});
