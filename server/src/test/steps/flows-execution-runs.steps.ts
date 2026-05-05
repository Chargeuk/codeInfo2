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
import {
  memoryConversations,
  shouldUseMemoryPersistence,
} from '../../chat/memoryPersistence.js';
import { startFlowRun } from '../../flows/service.js';
import { ConversationModel } from '../../mongo/conversation.js';
import { TurnModel } from '../../mongo/turn.js';
import { createFlowsRunRouter } from '../../routes/flowsRun.js';
import {
  installDeterministicCodexAvailabilityBootstrap,
  resetDeterministicCodexAvailabilityBootstrap,
} from '../support/codexAvailabilityBootstrap.js';

class MinimalChat extends ChatInterface {
  async execute(
    _message: string,
    _flags: Record<string, unknown>,
    conversationId: string,
    _model: string,
  ) {
    void _message;
    void _flags;
    void _model;
    this.emit('thread', { type: 'thread', threadId: conversationId });
    this.emit('final', { type: 'final', content: 'ok' });
    this.emit('complete', { type: 'complete', threadId: conversationId });
  }
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

let server: Server | null = null;
let baseUrl = '';
let tempDir: string | null = null;
let lastResponse: { status: number; body: Record<string, unknown> } | null =
  null;
const rememberedConversationIds = new Map<string, string>();
const rememberedExecutionIds = new Map<string, string>();
let previousAgentsHome: string | undefined;
let previousFlowsDir: string | undefined;
let previousCodexHome: string | undefined;
let previousNodeEnv: string | undefined;

const waitForConversation = async (conversationId: string) => {
  if (shouldUseMemoryPersistence()) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const conversation = memoryConversations.get(conversationId);
      if (conversation) return conversation;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for memory conversation ${conversationId}`);
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const conversation = await ConversationModel.findById(conversationId)
      .lean()
      .exec();
    if (conversation) return conversation;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for conversation ${conversationId}`);
};

const getStoredExecutionId = async (conversationId: string) => {
  const conversation = await waitForConversation(conversationId);
  const flowFlags = (conversation.flags ?? {}) as {
    flow?: { executionId?: string };
  };
  assert.equal(typeof flowFlags.flow?.executionId, 'string');
  return flowFlags.flow?.executionId as string;
};

const getStoredChildConversationId = async (conversationId: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const conversation = await waitForConversation(conversationId);
    const flowFlags = (conversation.flags ?? {}) as {
      flow?: { agentConversations?: Record<string, string> };
    };
    const childConversationId =
      flowFlags.flow?.agentConversations?.['coding_agent:resume-test'];
    if (typeof childConversationId === 'string') {
      return childConversationId;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(
    `Timed out waiting for child conversation mapping ${conversationId}`,
  );
};

const getStoredChildExecutionId = async (conversationId: string) => {
  const conversation = await waitForConversation(conversationId);
  const flags = (conversation.flags ?? {}) as {
    flowChild?: { executionId?: string };
  };
  assert.equal(typeof flags.flowChild?.executionId, 'string');
  return flags.flowChild?.executionId as string;
};

Before({ tags: '@mongo' }, async () => {
  rememberedConversationIds.clear();
  rememberedExecutionIds.clear();
  lastResponse = null;
  memoryConversations.clear();
  previousAgentsHome = process.env.CODEINFO_CODEX_AGENT_HOME;
  previousFlowsDir = process.env.FLOWS_DIR;
  previousCodexHome = process.env.CODEINFO_CODEX_HOME;
  previousNodeEnv = process.env.NODE_ENV;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story53-cucumber-'));

  process.env.CODEINFO_CODEX_AGENT_HOME = path.join(repoRoot, 'codex_agents');
  process.env.CODEINFO_CODEX_HOME = '/app/codex';
  process.env.FLOWS_DIR = tempDir;
  delete process.env.NODE_ENV;
  installDeterministicCodexAvailabilityBootstrap();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(
    createFlowsRunRouter({
      startFlowRun: (params) =>
        startFlowRun({
          ...params,
          chatFactory: () => new MinimalChat(),
        }),
    }),
  );

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
    delete process.env.CODEINFO_CODEX_AGENT_HOME;
  } else {
    process.env.CODEINFO_CODEX_AGENT_HOME = previousAgentsHome;
  }
  if (previousFlowsDir === undefined) {
    delete process.env.FLOWS_DIR;
  } else {
    process.env.FLOWS_DIR = previousFlowsDir;
  }
  if (previousCodexHome === undefined) {
    delete process.env.CODEINFO_CODEX_HOME;
  } else {
    process.env.CODEINFO_CODEX_HOME = previousCodexHome;
  }
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

Given('a flow execution test server', () => {
  assert.ok(server, 'expected test server to be running');
});

Given(
  'the flow execution fixture {string} is available',
  async (flowName: string) => {
    assert(tempDir, 'expected temporary flows directory');
    await fs.writeFile(
      path.join(tempDir, `${flowName}.json`),
      JSON.stringify(
        {
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
        },
        null,
        2,
      ),
      'utf8',
    );
  },
);

When(
  'I start flow {string} with conversation id {string}',
  async (flowName: string, conversationId: string) => {
    const res = await fetch(`${baseUrl}/flows/${flowName}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    });
    lastResponse = {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  },
);

When(
  'I start flow {string} with remembered conversation {string}',
  async (flowName: string, key: string) => {
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
  },
);

When(
  'I resume flow {string} for remembered conversation {string} from step path:',
  async (flowName: string, key: string, table: DataTable) => {
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
  },
);

Then('the flow execution response status code is {int}', (status: number) => {
  assert(lastResponse, 'expected flow execution response');
  assert.equal(lastResponse.status, status);
});

Then('I remember the started conversation as {string}', (key: string) => {
  assert(lastResponse, 'expected flow execution response');
  const conversationId = lastResponse.body.conversationId;
  assert.equal(typeof conversationId, 'string');
  rememberedConversationIds.set(key, conversationId as string);
});

Then(
  'the stored flow execution id for {string} is recorded as {string}',
  async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    assert(
      conversationId,
      `Missing remembered conversation ${conversationKey}`,
    );
    rememberedExecutionIds.set(
      executionKey,
      await getStoredExecutionId(conversationId),
    );
  },
);

Then(
  'remembered conversations {string} and {string} are different',
  (left: string, right: string) => {
    assert.notEqual(
      rememberedConversationIds.get(left),
      rememberedConversationIds.get(right),
    );
  },
);

Then(
  'the stored flow execution id for {string} differs from {string}',
  async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    const rememberedExecutionId = rememberedExecutionIds.get(executionKey);
    assert(
      conversationId,
      `Missing remembered conversation ${conversationKey}`,
    );
    assert(
      rememberedExecutionId,
      `Missing remembered execution ${executionKey}`,
    );
    assert.notEqual(
      await getStoredExecutionId(conversationId),
      rememberedExecutionId,
    );
  },
);

Then(
  'the latest started conversation matches {string}',
  (conversationKey: string) => {
    assert(lastResponse, 'expected flow execution response');
    assert.equal(
      lastResponse.body.conversationId,
      rememberedConversationIds.get(conversationKey),
    );
  },
);

Then(
  'the stored flow execution id for {string} still matches {string}',
  async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    const rememberedExecutionId = rememberedExecutionIds.get(executionKey);
    assert(
      conversationId,
      `Missing remembered conversation ${conversationKey}`,
    );
    assert(
      rememberedExecutionId,
      `Missing remembered execution ${executionKey}`,
    );
    assert.equal(
      await getStoredExecutionId(conversationId),
      rememberedExecutionId,
    );
  },
);

Then(
  'the child conversation execution id for {string} matches {string}',
  async (conversationKey: string, executionKey: string) => {
    const conversationId = rememberedConversationIds.get(conversationKey);
    const rememberedExecutionId = rememberedExecutionIds.get(executionKey);
    assert(
      conversationId,
      `Missing remembered conversation ${conversationKey}`,
    );
    assert(
      rememberedExecutionId,
      `Missing remembered execution ${executionKey}`,
    );
    const childConversationId =
      await getStoredChildConversationId(conversationId);
    assert.equal(
      await getStoredChildExecutionId(childConversationId),
      rememberedExecutionId,
    );
  },
);
