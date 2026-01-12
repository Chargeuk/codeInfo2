import { LogEntry } from '@codeinfo2/common';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';

type Filters = {
  level: string[];
  source: string[];
  text: string;
  since?: number;
  until?: number;
};

const API_BASE = getApiBaseUrl();

function buildUrl(path: string, queryString: string) {
  const base = API_BASE || window.location.origin;
  const url = new URL(path, base);
  if (queryString) {
    url.search = queryString;
  }
  return url.toString();
}

export function useLogs(filters: Filters, live = true) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSequence = useRef<number | undefined>(undefined);
  const [refreshToken, setRefreshToken] = useState(0);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.level.length) params.set('level', filters.level.join(','));
    if (filters.source.length) params.set('source', filters.source.join(','));
    if (filters.text) params.set('text', filters.text);
    if (filters.since) params.set('since', String(filters.since));
    if (filters.until) params.set('until', String(filters.until));
    if (refreshToken) params.set('_r', String(refreshToken));
    return params.toString();
  }, [
    filters.level,
    filters.source,
    filters.text,
    filters.since,
    filters.until,
    refreshToken,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(buildUrl('/logs', queryString));
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        setLogs(body.items);
        lastSequence.current = body.lastSequence;
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  useEffect(() => {
    if (!live || typeof EventSource === 'undefined') return undefined;
    const streamUrl = buildUrl('/logs/stream', queryString);
    const es = new EventSource(streamUrl);
    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as LogEntry;
        lastSequence.current = parsed.sequence ?? lastSequence.current;
        setLogs((prev) => [...prev.slice(-199), parsed]);
      } catch (err) {
        // ignore parse errors but surface in error state for visibility
        setError(String(err));
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [queryString, live]);

  const refreshQuery = () => {
    lastSequence.current = undefined;
    setRefreshToken((token) => token + 1);
    setLogs([]);
  };

  return { logs, loading, error, refreshQuery };
}

export default useLogs;
