import crypto from 'node:crypto';

import type { ToolState } from './types.js';

const MAX_ASSISTANT_CHARS = 200_000;
const MAX_ANALYSIS_CHARS = 200_000;
const MAX_TOOLS = 200;
const TTL_MS = 60 * 60 * 1000; // 60 minutes
const TOMBSTONE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TOMBSTONES = 5000;

type InflightKey = string;
type InflightStatus = 'running' | 'final';
type FinalStatus = 'ok' | 'stopped' | 'failed';

type InflightEntry = {
  key: InflightKey;
  conversationId: string;
  inflightId: string;
  startedAt: Date;
  updatedAt: number;
  status: InflightStatus;
  finalStatus?: FinalStatus;
  assistantText: string;
  analysisText: string;
  cancelRequested: boolean;
  cancelFn?: () => void;
  toolsById: Map<string, ToolState>;
};

type Tombstone = {
  conversationId: string;
  inflightId: string;
  finalStatus: FinalStatus;
  expiresAt: number;
};

const toKey = (conversationId: string, inflightId: string): InflightKey =>
  `${conversationId}::${inflightId}`;

const appendBounded = (text: string, delta: string, maxChars: number) => {
  const next = text + delta;
  if (next.length <= maxChars) return next;
  return next.slice(next.length - maxChars);
};

export class InflightRegistry {
  private byKey = new Map<InflightKey, InflightEntry>();
  private activeByConversation = new Map<string, InflightKey>();
  private tombstones = new Map<InflightKey, Tombstone>();

  private pruneExpired() {
    const now = Date.now();

    for (const [key, entry] of this.byKey.entries()) {
      if (entry.status !== 'running') continue;
      if (entry.updatedAt + TTL_MS > now) continue;
      this.byKey.delete(key);
      if (this.activeByConversation.get(entry.conversationId) === key) {
        this.activeByConversation.delete(entry.conversationId);
      }
    }

    for (const [key, t] of this.tombstones.entries()) {
      if (t.expiresAt <= now) this.tombstones.delete(key);
    }

    if (this.tombstones.size > MAX_TOMBSTONES) {
      const entries = Array.from(this.tombstones.entries()).sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      );
      const toRemove = entries.slice(0, this.tombstones.size - MAX_TOMBSTONES);
      toRemove.forEach(([key]) => this.tombstones.delete(key));
    }
  }

  createOrGetActive(params: {
    conversationId: string;
    inflightId?: string;
    cancelFn?: () => void;
  }): { inflightId: string; created: boolean; conflict: boolean } {
    this.pruneExpired();

    const inflightId = params.inflightId ?? crypto.randomUUID();
    const key = toKey(params.conversationId, inflightId);

    const existingKey = this.activeByConversation.get(params.conversationId);
    if (existingKey) {
      const existing = this.byKey.get(existingKey);
      if (existing && existing.status === 'running') {
        return {
          inflightId: existing.inflightId,
          created: false,
          conflict: true,
        };
      }
      this.activeByConversation.delete(params.conversationId);
    }

    const now = Date.now();
    const entry: InflightEntry = {
      key,
      conversationId: params.conversationId,
      inflightId,
      startedAt: new Date(now),
      updatedAt: now,
      status: 'running',
      assistantText: '',
      analysisText: '',
      cancelRequested: false,
      cancelFn: params.cancelFn,
      toolsById: new Map(),
    };
    this.byKey.set(key, entry);
    this.activeByConversation.set(params.conversationId, key);
    return { inflightId, created: true, conflict: false };
  }

  getActive(conversationId: string): {
    conversationId: string;
    inflightId: string;
    assistantText: string;
    analysisText: string;
    tools: ToolState[];
    startedAt: Date;
  } | null {
    this.pruneExpired();
    const key = this.activeByConversation.get(conversationId);
    if (!key) return null;
    const entry = this.byKey.get(key);
    if (!entry || entry.status !== 'running') return null;

    return {
      conversationId: entry.conversationId,
      inflightId: entry.inflightId,
      assistantText: entry.assistantText,
      analysisText: entry.analysisText,
      tools: Array.from(entry.toolsById.values()),
      startedAt: entry.startedAt,
    };
  }

  appendAssistantDelta(
    conversationId: string,
    inflightId: string,
    delta: string,
  ) {
    const entry = this.getEntry(conversationId, inflightId);
    if (!entry) return;
    entry.assistantText = appendBounded(
      entry.assistantText,
      delta,
      MAX_ASSISTANT_CHARS,
    );
    entry.updatedAt = Date.now();
  }

  appendAnalysisDelta(
    conversationId: string,
    inflightId: string,
    delta: string,
  ) {
    const entry = this.getEntry(conversationId, inflightId);
    if (!entry) return;
    entry.analysisText = appendBounded(
      entry.analysisText,
      delta,
      MAX_ANALYSIS_CHARS,
    );
    entry.updatedAt = Date.now();
  }

  updateToolState(conversationId: string, inflightId: string, tool: ToolState) {
    const entry = this.getEntry(conversationId, inflightId);
    if (!entry) return;

    if (!entry.toolsById.has(tool.id) && entry.toolsById.size >= MAX_TOOLS) {
      // Bound memory growth: ignore new tool ids once the cap is reached.
      return;
    }

    const existing = entry.toolsById.get(tool.id);
    entry.toolsById.set(tool.id, { ...(existing ?? {}), ...tool });
    entry.updatedAt = Date.now();
  }

  cancel(
    conversationId: string,
    inflightId: string,
  ): {
    ok: boolean;
    alreadyFinal: boolean;
    finalizedNow: boolean;
  } {
    this.pruneExpired();
    const key = toKey(conversationId, inflightId);
    const entry = this.byKey.get(key);
    if (entry && entry.status === 'running') {
      if (entry.cancelRequested) {
        return { ok: true, alreadyFinal: false, finalizedNow: false };
      }
      entry.cancelRequested = true;
      try {
        entry.cancelFn?.();
      } catch {
        // best-effort: cancellation should never crash the server
      }
      entry.updatedAt = Date.now();

      const finalizedNow = this.finalize({
        conversationId,
        inflightId,
        status: 'stopped',
      });

      return { ok: true, alreadyFinal: false, finalizedNow };
    }

    const tomb = this.tombstones.get(key);
    if (tomb) {
      return { ok: true, alreadyFinal: true, finalizedNow: false };
    }

    return { ok: false, alreadyFinal: false, finalizedNow: false };
  }

  finalize(params: {
    conversationId: string;
    inflightId: string;
    status: FinalStatus;
  }): boolean {
    this.pruneExpired();
    const key = toKey(params.conversationId, params.inflightId);
    const entry = this.byKey.get(key);
    if (!entry) {
      this.addTombstone({
        conversationId: params.conversationId,
        inflightId: params.inflightId,
        finalStatus: params.status,
      });
      return false;
    }

    if (entry.status === 'final') return false;
    entry.status = 'final';
    entry.finalStatus = params.status;

    this.byKey.delete(key);
    if (this.activeByConversation.get(params.conversationId) === key) {
      this.activeByConversation.delete(params.conversationId);
    }
    this.addTombstone({
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      finalStatus: params.status,
    });
    return true;
  }

  private addTombstone(params: {
    conversationId: string;
    inflightId: string;
    finalStatus: FinalStatus;
  }) {
    const key = toKey(params.conversationId, params.inflightId);
    this.tombstones.set(key, {
      conversationId: params.conversationId,
      inflightId: params.inflightId,
      finalStatus: params.finalStatus,
      expiresAt: Date.now() + TOMBSTONE_TTL_MS,
    });
  }

  private getEntry(
    conversationId: string,
    inflightId: string,
  ): InflightEntry | undefined {
    this.pruneExpired();
    const key = toKey(conversationId, inflightId);
    const entry = this.byKey.get(key);
    if (!entry || entry.status !== 'running') return undefined;
    return entry;
  }

  // Tests
  __debugCounts() {
    return { active: this.byKey.size, tombstones: this.tombstones.size };
  }

  __debugMaxTools() {
    return MAX_TOOLS;
  }
}

let singleton: InflightRegistry | null = null;
export function getInflightRegistry(): InflightRegistry {
  if (!singleton) singleton = new InflightRegistry();
  return singleton;
}

export function resetInflightRegistryForTest() {
  singleton = new InflightRegistry();
}
