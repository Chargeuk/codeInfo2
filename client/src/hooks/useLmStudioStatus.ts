import {
  fetchLmStudioStatus,
  type LmStudioStatusOk,
  type LmStudioStatusResponse,
} from '@codeinfo2/common';
import { useCallback, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/baseUrl';
import { getLmStudioBaseUrl } from '../config/runtimeConfig';

const LS_KEY = 'lmstudio.baseUrl';
const serverBase = getApiBaseUrl();

type HookState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: LmStudioStatusOk }
  | { status: 'error'; error: string };

export function useLmStudioStatus() {
  const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  const initialBaseUrl = stored ?? getLmStudioBaseUrl();
  const [baseUrl, setBaseUrlState] = useState(initialBaseUrl);
  const [state, setState] = useState<HookState>({ status: 'idle' });
  const committedBaseUrlRef = useRef(initialBaseUrl);
  const latestRefreshIdRef = useRef(0);

  const setBaseUrl = useCallback((nextBaseUrl: string) => {
    committedBaseUrlRef.current = nextBaseUrl;
    setBaseUrlState(nextBaseUrl);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEY, nextBaseUrl);
    }
  }, []);

  const refresh = useCallback(
    async (nextBaseUrl?: string) => {
      const targetBase = nextBaseUrl ?? committedBaseUrlRef.current;
      const refreshId = latestRefreshIdRef.current + 1;
      latestRefreshIdRef.current = refreshId;
      setState({ status: 'loading' });
      try {
        const res: LmStudioStatusResponse = await fetchLmStudioStatus({
          serverBaseUrl: serverBase,
          lmBaseUrl: targetBase,
        });
        if (refreshId !== latestRefreshIdRef.current) {
          return;
        }
        if (res.status === 'ok') {
          setBaseUrl(targetBase);
          setState({ status: 'success', data: res });
        } else {
          setState({ status: 'error', error: res.error });
        }
      } catch (err) {
        if (refreshId !== latestRefreshIdRef.current) {
          return;
        }
        setState({ status: 'error', error: (err as Error).message });
      }
    },
    [setBaseUrl],
  );

  const flags = useMemo(
    () => ({
      isLoading: state.status === 'loading',
      isError: state.status === 'error',
      isEmpty: state.status === 'success' && state.data.models.length === 0,
    }),
    [state],
  );

  return {
    baseUrl,
    committedBaseUrl: baseUrl,
    setBaseUrl,
    state,
    ...flags,
    refresh,
  };
}

export default useLmStudioStatus;
