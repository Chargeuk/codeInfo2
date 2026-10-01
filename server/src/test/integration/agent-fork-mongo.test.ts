import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import mongoose from 'mongoose';
import { executeFork, type ForkServiceDeps } from '../../agents/forkService.js';
import { disconnectMongo } from '../../mongo/connection.js';
import {
  ConversationModel,
  type Conversation,
} from '../../mongo/conversation.js';
import {
  ForkOperationModel,
  ForkSnapshotModel,
} from '../../mongo/forkOperation.js';
import { listAllTurns } from '../../mongo/repo.js';
import { TurnModel } from '../../mongo/turn.js';
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
      const deps: ForkServiceDeps = {
        loadSource: async () => source,
        prepareTarget: async () => target,
        listTurns: listAllTurns,
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
      assert.equal(child?.updatedAt.getTime(), ready!.handoverAt.getTime());
      assert.equal(child?.lastMessageAt.getTime(), ready!.handoverAt.getTime());
      assert.equal(
        await TurnModel.countDocuments({
          conversationId: result.conversationId,
        }),
        3,
      );
      assert.equal(nativeForks, 1);
      assert.equal(injected.size, 1);
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
