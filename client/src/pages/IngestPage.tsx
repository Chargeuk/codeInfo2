import {
  Alert,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import ActiveRunCard from '../components/ingest/ActiveRunCard';
import IngestForm from '../components/ingest/IngestForm';
import RootDetailsDrawer from '../components/ingest/RootDetailsDrawer';
import RootsTable from '../components/ingest/RootsTable';
import useIngestModels from '../hooks/useIngestModels';
import useIngestRoots, { type IngestRoot } from '../hooks/useIngestRoots';
import useIngestStatus from '../hooks/useIngestStatus';
import { createLogger } from '../logging/logger';

export default function IngestPage() {
  const log = useMemo(() => createLogger('client'), []);
  const {
    models,
    lockedModelId,
    defaultModelId,
    isLoading,
    isError,
    error,
    refresh,
  } = useIngestModels();
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const {
    roots,
    lockedModelId: rootsLockedModelId,
    isLoading: rootsLoading,
    isError: rootsIsError,
    error: rootsError,
    refetch: refetchRoots,
  } = useIngestRoots();
  const [detailRoot, setDetailRoot] = useState<IngestRoot | undefined>();
  const ingest = useIngestStatus();

  const terminalStates = useMemo(
    () => new Set(['completed', 'cancelled', 'error', 'skipped']),
    [],
  );
  const lastFinishedRef = useRef<string | null>(null);

  const locked = lockedModelId ?? rootsLockedModelId;

  const isRunActive = useMemo(
    () =>
      Boolean(
        activeRunId &&
          ingest.status &&
          !terminalStates.has(ingest.status.state),
      ),
    [activeRunId, ingest.status, terminalStates],
  );

  useEffect(() => {
    lastFinishedRef.current = null;
  }, [activeRunId]);

  useEffect(() => {
    if (!locked) return;
    log('info', '0000020 ingest lock notice displayed', {
      lockedModelId: locked,
    });
  }, [locked, log]);

  useEffect(() => {
    if (!activeRunId) return;
    if (!ingest.status) return;
    if (terminalStates.has(ingest.status.state)) {
      const key = `${activeRunId}:${ingest.status.state}`;
      if (lastFinishedRef.current === key) return;
      lastFinishedRef.current = key;

      log('info', '0000020 ingest run finished', {
        runId: activeRunId,
        state: ingest.status.state,
      });

      log('info', '0000020 ingest run refresh triggered', {
        runId: activeRunId,
      });
      void refetchRoots();
      void refresh();
    }
  }, [activeRunId, ingest.status, refetchRoots, refresh, terminalStates, log]);

  return (
    <Container sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Typography variant="h4">Ingest</Typography>

        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h6" sx={{ flex: 1 }}>
            Model lock
          </Typography>
          <Button onClick={() => refresh()} disabled={isLoading}>
            Refresh models
          </Button>
        </Stack>

        {isError && error ? <Alert severity="error">{error}</Alert> : null}
        {rootsIsError && rootsError ? (
          <Alert severity="error">{rootsError}</Alert>
        ) : null}

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              Start a new ingest
            </Typography>
            {isLoading ? <CircularProgress size={20} /> : null}
          </Stack>

          {locked ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Embedding model locked to {locked}
            </Alert>
          ) : null}

          <IngestForm
            models={models}
            lockedModelId={locked}
            defaultModelId={defaultModelId}
            onStarted={(runId) => setActiveRunId(runId)}
            disabled={isRunActive}
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          {activeRunId ? (
            <ActiveRunCard
              runId={activeRunId}
              status={ingest.status?.state}
              counts={ingest.status?.counts}
              currentFile={ingest.status?.currentFile}
              fileIndex={ingest.status?.fileIndex}
              fileTotal={ingest.status?.fileTotal}
              percent={ingest.status?.percent}
              etaMs={ingest.status?.etaMs}
              lastError={ingest.status?.lastError ?? undefined}
              message={ingest.status?.message ?? undefined}
              isLoading={ingest.isLoading}
              isCancelling={ingest.isCancelling}
              error={ingest.error}
              onCancel={ingest.cancel}
            />
          ) : (
            <Stack spacing={1}>
              <Typography variant="h6" gutterBottom>
                Active ingest
              </Typography>
              <Typography color="text.secondary">
                No active ingest. Start a run to see status here.
              </Typography>
            </Stack>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <RootsTable
            roots={roots}
            lockedModelId={locked}
            isLoading={rootsLoading}
            error={rootsError}
            disabled={isRunActive}
            onRefresh={refetchRoots}
            onRunStarted={(runId) => setActiveRunId(runId)}
            onShowDetails={(root) => setDetailRoot(root)}
            onRefreshModels={refresh}
          />
        </Paper>

        <RootDetailsDrawer
          root={detailRoot}
          lockedModelId={locked}
          open={Boolean(detailRoot)}
          onClose={() => setDetailRoot(undefined)}
        />
      </Stack>
    </Container>
  );
}
