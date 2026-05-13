import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { query, resetStore } from '../../logStore.js';
import {
  appendRepoBackedTransitiveConsumerLogs,
  appendSummaryBackedTransitiveConsumerLogs,
  TRANSITIVE_CONSUMER_ALIAS_FALLBACK_MARKER,
  TRANSITIVE_CONSUMER_CONTRACT_READ_MARKER,
} from '../../logging/transitiveConsumerMarkers.js';

describe('transitive consumer marker logging', () => {
  afterEach(() => {
    resetStore();
  });

  test('mixed repo-backed and summary-backed emitters share one queryable schema', () => {
    appendRepoBackedTransitiveConsumerLogs({
      consumer: 'flows.service.startFlowRun',
      subjectKind: 'repository',
      subjectId: '/workspace/repo-a',
      sourceId: '/workspace/repo-a',
      containerPath: '/workspace/repo-a',
      repoIdentity: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-large',
        embeddingDimensions: 3072,
        modelId: 'text-embedding-3-large',
        aliasFallbackUsed: false,
      },
    });
    appendSummaryBackedTransitiveConsumerLogs({
      consumer: 'mcp2.codebase_question.summary',
      subjectKind: 'conversation',
      subjectId: 'conversation-123',
      conversationId: 'conversation-123',
      summaryFileCount: 4,
      canonicalFieldsConsumed: true,
      aliasFallbackUsed: true,
    });

    const contractReads = query(
      { text: TRANSITIVE_CONSUMER_CONTRACT_READ_MARKER },
      20,
    );
    const aliasFallbacks = query(
      { text: TRANSITIVE_CONSUMER_ALIAS_FALLBACK_MARKER },
      20,
    );

    assert.equal(contractReads.length, 2);
    assert.equal(aliasFallbacks.length, 2);

    for (const entry of [...contractReads, ...aliasFallbacks]) {
      assert.equal(entry.message.startsWith('DEV-0000036:T11:'), true);
      assert.equal(typeof entry.context?.consumer, 'string');
      assert.equal(typeof entry.context?.subjectKind, 'string');
      assert.equal(typeof entry.context?.subjectId, 'string');
    }

    assert.deepEqual(
      contractReads.map((entry) => entry.context),
      [
        {
          consumer: 'flows.service.startFlowRun',
          subjectKind: 'repository',
          subjectId: '/workspace/repo-a',
          sourceId: '/workspace/repo-a',
          containerPath: '/workspace/repo-a',
          canonicalFieldsConsumed: true,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-large',
          embeddingDimensions: 3072,
          modelId: 'text-embedding-3-large',
        },
        {
          consumer: 'mcp2.codebase_question.summary',
          subjectKind: 'conversation',
          subjectId: 'conversation-123',
          conversationId: 'conversation-123',
          summaryFileCount: 4,
          canonicalFieldsConsumed: true,
        },
      ],
    );

    assert.deepEqual(
      aliasFallbacks.map((entry) => entry.context),
      [
        {
          consumer: 'flows.service.startFlowRun',
          subjectKind: 'repository',
          subjectId: '/workspace/repo-a',
          sourceId: '/workspace/repo-a',
          containerPath: '/workspace/repo-a',
          aliasFallbackUsed: false,
        },
        {
          consumer: 'mcp2.codebase_question.summary',
          subjectKind: 'conversation',
          subjectId: 'conversation-123',
          conversationId: 'conversation-123',
          summaryFileCount: 4,
          aliasFallbackUsed: true,
        },
      ],
    );
  });
});
