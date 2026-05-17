import type { LogEntry } from '@codeinfo2/common';

import type { RepoEmbeddingIdentity } from '../lmstudio/toolService.js';
import { append } from '../logStore.js';

export const TRANSITIVE_CONSUMER_CONTRACT_READ_MARKER =
  'DEV-0000036:T11:transitive_consumer_contract_read';
export const TRANSITIVE_CONSUMER_ALIAS_FALLBACK_MARKER =
  'DEV-0000036:T11:transitive_consumer_alias_fallback';

type TransitiveConsumerBaseContext = {
  consumer: string;
  subjectKind: string;
  subjectId: string;
  sourceId?: string;
  repository?: string;
  containerPath?: string;
  conversationId?: string;
  summaryFileCount?: number;
  fileCount?: number;
  canonicalFieldsConsumed?: boolean;
  aliasFallbackUsed?: boolean;
  embeddingProvider?: RepoEmbeddingIdentity['embeddingProvider'];
  embeddingModel?: string;
  embeddingDimensions?: number;
  modelId?: string;
};

type ContractReadContext = TransitiveConsumerBaseContext & {
  canonicalFieldsConsumed?: boolean;
};

type AliasFallbackContext = TransitiveConsumerBaseContext & {
  aliasFallbackUsed: boolean;
};

type RepoBackedParams = {
  consumer: string;
  subjectKind: string;
  subjectId: string;
  sourceId?: string;
  repository?: string;
  containerPath?: string;
  repoIdentity: RepoEmbeddingIdentity;
};

type SummaryBackedParams = {
  consumer: string;
  subjectKind: string;
  subjectId: string;
  conversationId?: string;
  summaryFileCount?: number;
  fileCount?: number;
  canonicalFieldsConsumed: boolean;
  aliasFallbackUsed: boolean;
};

function appendTransitiveConsumerMarker(
  message:
    | typeof TRANSITIVE_CONSUMER_CONTRACT_READ_MARKER
    | typeof TRANSITIVE_CONSUMER_ALIAS_FALLBACK_MARKER,
  context: ContractReadContext | AliasFallbackContext,
) {
  const filteredContext = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  );
  const entry: LogEntry = {
    level: 'info',
    message,
    timestamp: new Date().toISOString(),
    source: 'server',
    context: filteredContext,
  };
  append(entry);
}

export function appendRepoBackedTransitiveConsumerLogs(
  params: RepoBackedParams,
) {
  const sharedContext = {
    consumer: params.consumer,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
    sourceId: params.sourceId,
    repository: params.repository,
    containerPath: params.containerPath,
  };

  appendTransitiveConsumerMarker(TRANSITIVE_CONSUMER_CONTRACT_READ_MARKER, {
    ...sharedContext,
    canonicalFieldsConsumed: true,
    embeddingProvider: params.repoIdentity.embeddingProvider,
    embeddingModel: params.repoIdentity.embeddingModel,
    embeddingDimensions: params.repoIdentity.embeddingDimensions,
    modelId: params.repoIdentity.modelId,
  });
  appendTransitiveConsumerMarker(TRANSITIVE_CONSUMER_ALIAS_FALLBACK_MARKER, {
    ...sharedContext,
    aliasFallbackUsed: params.repoIdentity.aliasFallbackUsed,
  });
}

export function appendSummaryBackedTransitiveConsumerLogs(
  params: SummaryBackedParams,
) {
  const sharedContext = {
    consumer: params.consumer,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
    conversationId: params.conversationId,
    summaryFileCount: params.summaryFileCount,
    fileCount: params.fileCount,
  };

  appendTransitiveConsumerMarker(TRANSITIVE_CONSUMER_CONTRACT_READ_MARKER, {
    ...sharedContext,
    canonicalFieldsConsumed: params.canonicalFieldsConsumed,
  });
  appendTransitiveConsumerMarker(TRANSITIVE_CONSUMER_ALIAS_FALLBACK_MARKER, {
    ...sharedContext,
    aliasFallbackUsed: params.aliasFallbackUsed,
  });
}
