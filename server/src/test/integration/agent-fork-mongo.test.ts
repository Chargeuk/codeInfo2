import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import { executeFork, type ForkServiceDeps } from '../../agents/forkService.js';
import { ChatInterfaceCodex } from '../../chat/interfaces/ChatInterfaceCodex.js';
import { disconnectMongo } from '../../mongo/connection.js';
import {
  ConversationModel,
  type Conversation,
} from '../../mongo/conversation.js';
import {
  ForkOperationModel,
  ForkSnapshotModel,
} from '../../mongo/forkOperation.js';
import { listForkTurns } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';
import { runWithTestOverrides } from '../support/testOverrideScope.js';
import { resolveConfiguredTestTimeoutMs } from '../support/testTimeouts.js';

// Reuse a supplied replica set and the app's actual models/connection. Every
// run owns a new database; this proof needs no provider auth or container setup.
const proofUri = process.env.CODEINFO_FORK_MONGO_PROOF_URI?.trim();
test(
  'real Mongo fork publication preserves timestamps, rolls back atomically, and cannot resurrect a deleted child',
  {
    skip: !proofUri,
    timeout: resolveConfiguredTestTimeoutMs(120_000),
  },
  async (t) => {
    const database = `agent_fork_proof_${crypto.randomUUID().replaceAll('-', '')}`;
    try {
      await mongoose.connect(proofUri!, {
        dbName: database,
        serverSelectionTimeoutMS: resolveConfiguredTestTimeoutMs(30_000),
      });
      const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
      assert.ok(
        hello.setName,
        'Fork publication proof requires a Mongo replica set',
      );
      await Promise.all([
        ConversationModel.init(),
        TurnModel.init(),
        ForkOperationModel.init(),
        ForkSnapshotModel.init(),
      ]);
      // Verify the existing completion/native pipeline survives a real Mongo
      // reload for both callers. Provider transport and canonical verification
      // are deterministic doubles; this gated test makes no provider calls.
      for (const agent of [false, true]) {
        const conversationId = crypto.randomUUID();
        const sessionId = crypto.randomUUID();
        await ConversationModel.create({
          _id: conversationId,
          provider: 'codex',
          model: 'gpt-6.1-terra',
          title: 'Native metadata reload',
          source: 'REST',
          flags: {},
        });
        const events = async function* () {
          yield { type: 'thread.started', thread_id: sessionId };
          yield {
            type: 'item.completed',
            item: { type: 'agent_message', id: 'reply', text: 'Acknowledged.' },
          };
          yield { type: 'turn.completed' };
        };
        const thread = {
          id: sessionId,
          runStreamed: async () => ({ events: events() }),
        };
        const chat = new ChatInterfaceCodex(
          () => ({ startThread: () => thread, resumeThread: () => thread }),
          {
            checkpoint: async () => {
              throw new Error('Fresh fixture');
            },
            complete: async () => ({
              sessionId,
              turnId: 'verified-native-turn',
            }),
          },
        );
        await runWithTestOverrides(
          {
            codexDetection: {
              available: true,
              authPresent: true,
              configPresent: true,
            },
            envOverrides: { NODE_ENV: 'development' },
          },
          async () => {
            await chat.run(
              'Acknowledge only',
              {
                provider: 'codex',
                source: 'REST',
                disableSystemContext: agent,
              },
              conversationId,
              'gpt-6.1-terra',
            );
          },
        );
        const reloaded = await TurnModel.findOne({
          conversationId,
          role: 'assistant',
        })
          .lean()
          .exec();
        assert.equal(reloaded?.content, 'Acknowledged.');
        assert.deepEqual(reloaded?.native, {
          sessionId,
          turnId: 'verified-native-turn',
        });
        assert.equal(
          (await ConversationModel.findById(conversationId).lean().exec())
            ?.flags.threadId,
          sessionId,
        );
      }
      // Exercise the actual Mongo comparison/sort semantics, including missing
      // legacy tie breakers, before running the durable publication proof.
      for (const chronology of ['source', 'copy', 'legacy-copy'] as const) {
        const conversationId = crypto.randomUUID();
        const ids = Array.from(
          { length: 3 },
          () => new mongoose.Types.ObjectId(),
        ).sort((a, b) => String(a).localeCompare(String(b)));
        const documents = await TurnModel.create(
          ids.map((originalId, index) => ({
            _id: chronology === 'source' ? originalId : ids[2 - index],
            conversationId,
            role: index === 1 ? 'assistant' : 'user',
            content: `prefix-${index}`,
            model: 'model',
            provider: 'codex',
            source: 'REST',
            toolCalls: null,
            status: 'ok',
            createdAt: new Date(10),
            ...(chronology === 'copy' ? { chronologicalOrder: index } : {}),
            ...(chronology === 'legacy-copy'
              ? { fork: { sourceTurnId: String(originalId) } }
              : {}),
          })),
        );
        const selectedId = String(documents[1]._id);
        const prefix = await listForkTurns(conversationId, selectedId);
        assert.deepEqual(
          prefix.items.map((turn) => turn.content),
          ['prefix-1', 'prefix-0'],
        );
        const metadata = await listForkTurns(conversationId, selectedId, true);
        assert.equal(metadata.items.length, 1);
        assert.equal(metadata.items[0].turnId, selectedId);
        assert.equal(metadata.items[0].content, undefined);
        assert.equal(metadata.items[0].toolCalls, null);
      }
      const source: Conversation = {
        _id: crypto.randomUUID(),
        agentName: 'source_agent',
        provider: 'codex',
        model: 'historic-model',
        title: 'Source',
        source: 'REST',
        flags: { threadId: 'native-source', workingFolder: '/proof/shared' },
        createdAt: new Date(1),
        updatedAt: new Date(2),
        lastMessageAt: new Date(2),
        archivedAt: null,
      };
      await ConversationModel.create(source);
      const turns = await TurnModel.create([
        {
          conversationId: source._id,
          role: 'user',
          content: 'Prompt',
          provider: 'codex',
          model: source.model,
          source: 'REST',
          status: 'ok',
          toolCalls: null,
          createdAt: new Date(1),
        },
        {
          conversationId: source._id,
          role: 'assistant',
          content: 'Answer',
          provider: 'codex',
          model: source.model,
          source: 'REST',
          status: 'ok',
          toolCalls: null,
          createdAt: new Date(2),
          native: { sessionId: 'native-source', turnId: 'native-turn' },
        },
      ]);
      const repositoryContext = {
        selectedRepositoryPath: '/proof/shared',
        defaultExecutionRoot: '/proof/shared',
        workingDirectoryOverride: '/proof/shared',
        fallbackUsed: false,
        workingRepositoryAvailable: true,
      };
      const target: Awaited<ReturnType<ForkServiceDeps['prepareTarget']>> = {
        executionProviderId: 'codex',
        requestedProviderId: 'codex',
        modelId: 'target-model',
        prompt: 'Complete target prompt',
        runtimeConfig: { model: 'target-model', mcp_servers: {} },
        workingDirectoryOverride: '/proof/shared',
        warnings: [],
        copilotModels: [],
        availability: {
          requestedProviderId: 'codex',
          executionProviderId: 'codex',
          disabled: false,
          warnings: [],
          fallbackCandidates: [],
        },
        repositoryContext,
        executionContext: {
          selectedRepositoryPath: '/proof/shared',
          defaultExecutionRoot: '/proof/shared',
          repositoryMetadata: repositoryContext,
          runtime: { workingFolder: '/proof/shared' },
          workingDirectoryOverride: '/proof/shared',
        },
      };
      let nativeForks = 0;
      const injected = new Set<string>();
      let handovers = 0;
      const deps: ForkServiceDeps = {
        startInstruction: async (params) => {
          handovers++;
          assert.ok(await ConversationModel.findById(params.conversationId));
          await TurnModel.create({
            conversationId: params.conversationId,
            role: 'user',
            content: params.instruction,
            provider: 'codex',
            model: target.modelId,
            source: 'REST',
            status: 'ok',
            toolCalls: null,
          });
          return {
            conversationId: params.conversationId!,
            inflightId: params.inflightId!,
            providerId: 'codex',
            modelId: target.modelId,
          };
        },
        loadSource: async () => source,
        prepareTarget: async () => target,
        listTurns: listForkTurns,
        openNative: async () => ({
          turns: [
            {
              id: 'native-turn',
              completed: true,
              user: 'Prompt',
              assistant: 'Answer',
            },
          ],
          fork: async () => {
            nativeForks++;
            return 'native-child';
          },
          inject: async (_id, text) => {
            injected.add(text);
          },
          hasInjected: async (_id, text) => injected.has(text),
          close: async () => {},
          remove: async () => {
            assert.fail('Publication retry must not remove the child');
          },
        }),
      };
      const input = {
        sourceConversationId: source._id,
        sourceTurnId: String(turns[1]._id),
        targetAgentName: 'target_agent',
        requestId: crypto.randomUUID(),
      };
      const operationId = crypto
        .createHash('sha256')
        .update(input.requestId)
        .digest('hex');
      const publish = ConversationModel.collection.findOneAndUpdate.bind(
        ConversationModel.collection,
      );
      let abortPublication = true;
      t.mock.method(
        ConversationModel.collection,
        'findOneAndUpdate',
        async (
          ...args: Parameters<
            typeof ConversationModel.collection.findOneAndUpdate
          >
        ) => {
          // Execute the real Mongoose-generated update first. Mongo must catch
          // timestamp path conflicts before our deliberate transaction abort.
          const result = await publish(...args);
          if (abortPublication) {
            abortPublication = false;
            throw new Error('Publication aborted after Mongo upsert');
          }
          return result;
        },
      );
      await assert.rejects(
        executeFork(input, operationId, deps),
        /Publication aborted after Mongo upsert/,
      );
      const pending = await ForkOperationModel.findById(operationId)
        .lean()
        .exec();
      assert.equal(pending?.phase, 'copied');
      assert.equal(
        await ConversationModel.findById(pending!.conversationId),
        null,
      );
      const result = await executeFork(input, operationId, deps);
      const ready = await ForkOperationModel.findById(operationId)
        .lean()
        .exec();
      const child = await ConversationModel.findById(result.conversationId)
        .lean()
        .exec();
      assert.equal(ready?.phase, 'ready');
      assert.equal(child?.createdAt.getTime(), ready!.handoverAt.getTime());
      assert.ok(child!.updatedAt.getTime() >= ready!.handoverAt.getTime());
      assert.equal(child?.lastMessageAt.getTime(), ready!.handoverAt.getTime());
      assert.equal(
        await TurnModel.countDocuments({
          conversationId: result.conversationId,
        }),
        3,
      );
      assert.equal(nativeForks, 1);
      assert.equal(injected.size, 0);
      assert.equal(handovers, 1);
      await ConversationModel.deleteOne({ _id: result.conversationId });
      await TurnModel.deleteMany({ conversationId: result.conversationId });
      await assert.rejects(executeFork(input, operationId, deps), {
        code: 'FORK_DELETED',
      });
      assert.equal(
        await ConversationModel.findById(result.conversationId),
        null,
      );
      assert.equal(nativeForks, 1);
      assert.equal(
        await TurnModel.countDocuments({ conversationId: source._id }),
        2,
      );
    } finally {
      try {
        if (mongoose.connection.db?.databaseName === database)
          await mongoose.connection.dropDatabase();
      } finally {
        await disconnectMongo();
      }
    }
  },
);
