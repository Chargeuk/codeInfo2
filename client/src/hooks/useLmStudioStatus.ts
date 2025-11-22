import {
  fetchLmStudioStatus,
  type LmStudioStatusOk,
  type LmStudioStatusResponse,
} from '@codeinfo2/common';
import { useCallback, useMemo, useState } from 'react';

const LS_KEY = 'lmstudio.baseUrl';
const DEFAULT_LM_URL = 'http://host.docker.internal:1234';

const envLmUrl =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta)?.env?.VITE_LMSTUDIO_URL) ??
  undefined;
const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta)?.env?.VITE_API_URL) ??
  'http://localhost:5010';

type HookState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: LmStudioStatusOk }
  | { status: 'error'; error: string };

export function useLmStudioStatus() {
  const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  const initialBaseUrl = stored ?? envLmUrl ?? DEFAULT_LM_URL;
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [state, setState] = useState<HookState>({ status: 'idle' });

  const refresh = useCallback(
    async (nextBaseUrl?: string) => {
      const targetBase = nextBaseUrl ?? baseUrl;
      setBaseUrl(targetBase);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LS_KEY, targetBase);
      }
      setState({ status: 'loading' });
      try {
        const res: LmStudioStatusResponse = await fetchLmStudioStatus({
          serverBaseUrl: serverBase,
          lmBaseUrl: targetBase,
        });
        if (res.status === 'ok') {
          setState({ status: 'success', data: res });
        } else {
          setState({ status: 'error', error: res.error });
        }
      } catch (err) {
        setState({ status: 'error', error: (err as Error).message });
      }
    },
    [baseUrl],
  );

  const flags = useMemo(
    () => ({
      isLoading: state.status === 'loading',
      isError: state.status === 'error',
      isEmpty: state.status === 'success' && state.data.models.length === 0,
    }),
    [state],
  );

  return { baseUrl, setBaseUrl, state, ...flags, refresh };
}

export default useLmStudioStatus;
