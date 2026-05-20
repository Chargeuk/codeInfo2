import { fetchServerVersion, type VersionInfo } from '@codeinfo2/common';
import { Alert, Box, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import pkg from '../../package.json';
import { getApiBaseUrl } from '../api/baseUrl';
import CodexDeviceAuthDialog from '../components/codex/CodexDeviceAuthDialog';
import {
  HomeLmStudioSection,
  HomeProviderStatusSection,
  HomeSummaryCards,
} from '../components/home/HomePageSections';
import { createHomeProviderSummaries } from '../components/home/homePageData';
import UtilityPageShell from '../components/utility/UtilityPageShell';
import { getApiBaseUrlBlockingIssueMessage } from '../config/runtimeConfig';
import { getLmStudioBaseUrl } from '../config/runtimeConfig';
import { useHomeProviders } from '../hooks/useHomeProviders';
import useLmStudioStatus from '../hooks/useLmStudioStatus';
import { createLogger } from '../logging';

const homeSubtitle =
  'System status overview, provider logon state, and LM Studio runtime details.';

function formatCheckedAt(value: string | null) {
  return value ?? 'Unknown';
}

export default function HomePage() {
  const logger = useMemo(() => createLogger('client-home'), []);
  const apiUrl = getApiBaseUrl();
  const apiBaseUrlBlockingIssueMessage = getApiBaseUrlBlockingIssueMessage();
  const clientVersion = pkg.version;
  const { providers, refreshProviders } = useHomeProviders();
  const providerSummaries = useMemo(
    () => createHomeProviderSummaries(providers),
    [providers],
  );
  const {
    baseUrl: committedBaseUrl,
    state: lmStudioState,
    isLoading: lmStudioLoading,
    isEmpty: lmStudioEmpty,
    refresh: refreshLmStudio,
  } = useLmStudioStatus();
  const [draftBaseUrl, setDraftBaseUrl] = useState(committedBaseUrl);
  const [showAllModels, setShowAllModels] = useState(false);
  const [deviceAuthOpen, setDeviceAuthOpen] = useState(false);
  const [serverVersion, setServerVersion] = useState<VersionInfo | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(true);
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

  const refreshVersion = useCallback(async () => {
    if (apiBaseUrlBlockingIssueMessage) {
      setServerVersion(null);
      setVersionError(null);
      setVersionLoading(false);
      return;
    }

    setVersionLoading(true);
    setVersionError(null);
    try {
      const data = await fetchServerVersion(apiUrl);
      setServerVersion(data);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      setVersionError(message);
      logger('error', 'version fetch failed', { error: message });
    } finally {
      setVersionLoading(false);
      stampCheckedAt();
    }
  }, [apiBaseUrlBlockingIssueMessage, apiUrl, logger, stampCheckedAt]);

  const refreshHomeStatus = useCallback(async () => {
    await Promise.all([
      refreshVersion(),
      refreshProviders(),
      refreshLmStudio(),
    ]);
    stampCheckedAt();
  }, [refreshLmStudio, refreshProviders, refreshVersion, stampCheckedAt]);

  const handleProviderAuthOpen = useCallback(() => {
    setDeviceAuthOpen(true);
  }, []);

  const handleProviderAuthClose = useCallback(() => {
    setDeviceAuthOpen(false);
  }, []);

  const handleProviderAuthSuccess = useCallback(() => {
    setDeviceAuthOpen(false);
    void refreshProviders();
    stampCheckedAt();
  }, [refreshProviders, stampCheckedAt]);

  const handleCheckLmStudio = useCallback(async () => {
    await refreshLmStudio(draftBaseUrl);
    stampCheckedAt();
  }, [draftBaseUrl, refreshLmStudio, stampCheckedAt]);

  const handleResetLmStudio = useCallback(async () => {
    const defaultLmUrl = getLmStudioBaseUrl();
    setDraftBaseUrl(defaultLmUrl);
    await refreshLmStudio(defaultLmUrl);
    stampCheckedAt();
  }, [refreshLmStudio, stampCheckedAt]);

  const handleRefreshModels = useCallback(async () => {
    await refreshLmStudio();
    stampCheckedAt();
  }, [refreshLmStudio, stampCheckedAt]);

  useEffect(() => {
    void refreshVersion();
  }, [refreshVersion]);

  useEffect(() => {
    void refreshLmStudio();
  }, [refreshLmStudio]);

  useEffect(() => {
    document.title = 'Home · CodeInfo2';
  }, []);

  const subtitle = (
    <Typography variant="body1" color="text.secondary">
      {homeSubtitle}
    </Typography>
  );

  return (
    <UtilityPageShell title="Home" subtitle={homeSubtitle}>
      <Stack spacing={2.5}>
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>{subtitle}</Box>

        {apiBaseUrlBlockingIssueMessage ? (
          <Alert
            severity="error"
            data-testid="runtime-config-api-base-url-home-banner"
          >
            {apiBaseUrlBlockingIssueMessage}
          </Alert>
        ) : null}

        <HomeSummaryCards
          clientVersion={clientVersion}
          serverVersion={serverVersion}
          versionError={versionError}
          versionLoading={versionLoading}
          lastCheckedLabel={formatCheckedAt(lastCheckedAt)}
          providerSummaries={providerSummaries}
          onRefreshAll={() => {
            void refreshHomeStatus();
          }}
          onCheckLmStudio={() => {
            void handleCheckLmStudio();
          }}
          onProviderAuth={handleProviderAuthOpen}
        />

        <HomeProviderStatusSection
          providerSummaries={providerSummaries}
          onProviderAuth={handleProviderAuthOpen}
          onCheckLmStudio={() => {
            void handleCheckLmStudio();
          }}
          onRefresh={() => {
            void refreshHomeStatus();
          }}
          lastCheckedLabel={formatCheckedAt(lastCheckedAt)}
        />

        <HomeLmStudioSection
          status={lmStudioState.status}
          draftBaseUrl={draftBaseUrl}
          onDraftBaseUrlChange={setDraftBaseUrl}
          onCheckStatus={() => {
            void handleCheckLmStudio();
          }}
          onResetToDefault={() => {
            void handleResetLmStudio();
          }}
          onRefreshModels={() => {
            void handleRefreshModels();
          }}
          models={
            lmStudioState.status === 'success' ? lmStudioState.data.models : []
          }
          isLoading={lmStudioLoading}
          isEmpty={lmStudioEmpty}
          error={lmStudioState.status === 'error' ? lmStudioState.error : null}
          lastConnectedLabel={lastCheckedAt}
          committedBaseUrl={committedBaseUrl}
          showAllModels={showAllModels}
          onToggleShowAllModels={() => setShowAllModels((value) => !value)}
        />
      </Stack>

      <CodexDeviceAuthDialog
        open={deviceAuthOpen}
        onClose={handleProviderAuthClose}
        source="home"
        onSuccess={handleProviderAuthSuccess}
      />
    </UtilityPageShell>
  );
}
