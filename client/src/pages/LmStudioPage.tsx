import { Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { HomeLmStudioSection } from '../components/home/HomePageSections';
import UtilityPageShell from '../components/utility/UtilityPageShell';
import { getLmStudioBaseUrl } from '../config/runtimeConfig';
import useLmStudioStatus from '../hooks/useLmStudioStatus';

export default function LmStudioPage() {
  const defaultLmUrl = getLmStudioBaseUrl();
  const {
    baseUrl: committedBaseUrl,
    state,
    isLoading,
    isEmpty,
    refresh,
  } = useLmStudioStatus();
  const [draftBaseUrl, setDraftBaseUrl] = useState(committedBaseUrl);
  const [showAllModels, setShowAllModels] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    setDraftBaseUrl(committedBaseUrl);
  }, [committedBaseUrl]);

  const stampCheckedAt = useCallback(() => {
    setLastCheckedAt(
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()),
    );
  }, []);

  const handleCheckStatus = useCallback(async () => {
    await refresh(draftBaseUrl);
    stampCheckedAt();
  }, [draftBaseUrl, refresh, stampCheckedAt]);

  const handleReset = useCallback(async () => {
    setDraftBaseUrl(defaultLmUrl);
    await refresh(defaultLmUrl);
    stampCheckedAt();
  }, [defaultLmUrl, refresh, stampCheckedAt]);

  const handleRefreshModels = useCallback(async () => {
    await refresh();
    stampCheckedAt();
  }, [refresh, stampCheckedAt]);

  useEffect(() => {
    void handleCheckStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <UtilityPageShell
      title="LM Studio"
      subtitle="Local runtime status and model list."
    >
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{ display: { xs: 'block', md: 'none' } }}
      >
        Local runtime status and model list.
      </Typography>

      <HomeLmStudioSection
        status={state.status}
        draftBaseUrl={draftBaseUrl}
        onDraftBaseUrlChange={setDraftBaseUrl}
        onCheckStatus={() => {
          void handleCheckStatus();
        }}
        onResetToDefault={() => {
          void handleReset();
        }}
        onRefreshModels={() => {
          void handleRefreshModels();
        }}
        models={state.status === 'success' ? state.data.models : []}
        isLoading={isLoading}
        isEmpty={isEmpty}
        error={state.status === 'error' ? state.error : null}
        lastConnectedLabel={lastCheckedAt}
        committedBaseUrl={committedBaseUrl}
        showAllModels={showAllModels}
        onToggleShowAllModels={() => setShowAllModels((value) => !value)}
      />
    </UtilityPageShell>
  );
}
