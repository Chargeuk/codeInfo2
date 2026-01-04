import { isTransientReconnect } from '../../agents/transientReconnect.js';

import type {
  ChatAnalysisEvent,
  ChatCompleteEvent,
  ChatEvent,
  ChatFinalEvent,
  ChatErrorEvent,
  ChatToolResultEvent,
} from '../interfaces/ChatInterface.js';

export type Segment =
  | { type: 'thinking'; text: string }
  | {
      type: 'vector_summary';
      files: VectorSummaryFile[];
    }
  | { type: 'answer'; text: string };

export type VectorSummaryFile = {
  path: string;
  relPath?: string;
  match: number | null;
  chunks: number;
  lines: number | null;
  repo?: string;
  modelId?: string;
  hostPathWarning?: string;
};

export class McpResponder {
  private segments: Segment[] = [];
  private vectorSummaries: Extract<Segment, { type: 'vector_summary' }>[] = [];
  private toolResults: ChatToolResultEvent[] = [];
  private thinkingText = '';
  private answerText = '';
  private conversationId: string | null = null;
  private errorMessage: string | null = null;
  private transientReconnectCount = 0;
  private transientReconnectLastMessage: string | null = null;

  handle(event: ChatEvent) {
    switch (event.type) {
      case 'analysis':
        this.handleAnalysis(event);
        break;
      case 'tool-result':
        this.handleToolResult(event);
        break;
      case 'final':
        this.handleFinal(event);
        break;
      case 'complete':
        this.handleComplete(event);
        break;
      case 'thread':
        this.conversationId = event.threadId;
        break;
      case 'error':
        this.handleError(event as ChatErrorEvent);
        break;
      default:
        break;
    }
  }

  toResult(modelId: string, fallbackConversationId: string | null) {
    const answerSegmentPresent = this.segments.some((s) => s.type === 'answer');
    if (!answerSegmentPresent) {
      this.segments.push({ type: 'answer', text: this.answerText });
    }

    const conversationId = this.conversationId ?? fallbackConversationId;

    if (this.errorMessage) {
      throw new Error(this.errorMessage);
    }

    return {
      conversationId,
      modelId,
      segments: this.segments,
    };
  }

  getVectorSummaries() {
    return this.vectorSummaries;
  }

  getToolResults() {
    return this.toolResults;
  }

  getTransientReconnectCount() {
    return this.transientReconnectCount;
  }

  getTransientReconnectLastMessage() {
    return this.transientReconnectLastMessage;
  }

  private handleAnalysis(event: ChatAnalysisEvent) {
    const delta = event.content;
    if (!delta) return;
    this.thinkingText += delta;
    this.segments.push({ type: 'thinking', text: delta });
  }

  private handleToolResult(event: ChatToolResultEvent) {
    this.toolResults.push(event);
    const summary = buildVectorSummary(event.result);
    if (summary) {
      this.segments.push(summary);
      this.vectorSummaries.push(summary);
    }
  }

  private handleFinal(event: ChatFinalEvent) {
    this.answerText = event.content;
    this.segments.push({ type: 'answer', text: event.content });
  }

  private handleComplete(event: ChatCompleteEvent) {
    if (event.threadId) {
      this.conversationId = event.threadId;
    }
  }

  private handleError(event: ChatErrorEvent) {
    const message = event.message;
    if (isTransientReconnect(message)) {
      this.transientReconnectCount += 1;
      this.transientReconnectLastMessage = message;
      return;
    }

    const lower = message.toLowerCase();
    if (lower.includes('abort') || lower.includes('stop')) {
      if (!this.answerText.trim().length) {
        this.answerText = 'Stopped';
      }
      return;
    }

    this.errorMessage = message;
  }
}

function buildVectorSummary(
  payload: unknown,
): Extract<Segment, { type: 'vector_summary' }> | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results : [];
  const files = Array.isArray(obj.files) ? obj.files : [];
  if (!results.length && !files.length) return null;

  const relByHost = new Map<string, string>();
  const summaries = new Map<string, VectorSummaryFile>();

  const countLines = (text: unknown): number | null => {
    if (typeof text !== 'string') return null;
    if (!text.length) return 0;
    return text.split(/\r?\n/).length;
  };

  results.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const relPath = typeof item.relPath === 'string' ? item.relPath : undefined;
    const hostPath =
      typeof item.hostPath === 'string' ? item.hostPath : undefined;
    if (hostPath && relPath) relByHost.set(hostPath, relPath);
    const key = relPath ?? hostPath ?? `result-${index}`;
    const base: VectorSummaryFile = summaries.get(key) ?? {
      path: relPath ?? hostPath ?? key,
      relPath,
      match: null,
      chunks: 0,
      lines: null,
      repo: typeof item.repo === 'string' ? item.repo : undefined,
      modelId: typeof item.modelId === 'string' ? item.modelId : undefined,
      hostPathWarning:
        typeof item.hostPathWarning === 'string'
          ? item.hostPathWarning
          : undefined,
    };

    base.chunks += 1;
    if (typeof item.score === 'number') {
      base.match =
        base.match === null ? item.score : Math.max(base.match, item.score);
    }
    const lineCount =
      typeof item.lineCount === 'number'
        ? item.lineCount
        : countLines(item.chunk);
    if (typeof lineCount === 'number') {
      base.lines = (base.lines ?? 0) + lineCount;
    }

    summaries.set(key, base);
  });

  files.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const hostPath =
      typeof item.hostPath === 'string' ? item.hostPath : undefined;
    const relPath = hostPath ? relByHost.get(hostPath) : undefined;
    const key = hostPath ?? `file-${index}`;
    const base: VectorSummaryFile = summaries.get(key) ?? {
      path: relPath ?? hostPath ?? key,
      relPath,
      match: null,
      chunks: 0,
      lines: null,
      repo: typeof item.repo === 'string' ? item.repo : undefined,
      modelId: typeof item.modelId === 'string' ? item.modelId : undefined,
      hostPathWarning:
        typeof item.hostPathWarning === 'string'
          ? item.hostPathWarning
          : undefined,
    };

    const highest =
      typeof item.highestMatch === 'number' ? item.highestMatch : base.match;
    base.match = highest ?? base.match;
    const chunkCount =
      typeof item.chunkCount === 'number' ? item.chunkCount : undefined;
    base.chunks += chunkCount ?? 0;
    const lineCount =
      typeof item.lineCount === 'number' ? item.lineCount : null;
    if (lineCount !== null) {
      base.lines = (base.lines ?? 0) + lineCount;
    }

    summaries.set(key, base);
  });

  if (!summaries.size) return null;

  return {
    type: 'vector_summary',
    files: Array.from(summaries.values()),
  };
}
