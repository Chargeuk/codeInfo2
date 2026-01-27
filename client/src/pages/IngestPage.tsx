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
  const containerMaxWidth = false;
  const {
    models,
    lockedModelId,
    defaultModelId,
    isLoading,
    isError,
    error,
    refresh,
  } = useIngestModels();
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

  const active = useMemo(() => {
    if (!ingest.status) return null;
    if (terminalStates.has(ingest.status.state)) return null;
    return ingest.status;
  }, [ingest.status, terminalStates]);

  const isRunActive = Boolean(active);

  useEffect(() => {
    if (!locked) return;
    log('info', '0000020 ingest lock notice displayed', {
      lockedModelId: locked,
    });
  }, [locked, log]);

  useEffect(() => {
    log('info', '0000022 ingest layout full-width', {
      maxWidth: containerMaxWidth,
    });
  }, [containerMaxWidth, log]);

  useEffect(() => {
    if (!ingest.status) return;
    if (terminalStates.has(ingest.status.state)) {
      const key = `${ingest.status.runId}:${ingest.status.state}`;
      if (lastFinishedRef.current === key) return;
      lastFinishedRef.current = key;

      log('info', '0000022 ingest ui terminal refresh', {
        runId: ingest.status.runId,
        state: ingest.status.state,
      });

      void refetchRoots();
      void refresh();
    }
  }, [ingest.status, refetchRoots, refresh, terminalStates, log]);

  return (
    <Container maxWidth={containerMaxWidth} sx={{ py: 3 }}>
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
        {ingest.connectionState === 'connecting' ? (
          <Alert severity="info" data-testid="ingest-ws-connecting">
            Connecting to realtime updates…
          </Alert>
        ) : null}
        {ingest.connectionState === 'closed' ? (
          <Alert severity="error" data-testid="ingest-ws-unavailable">
            Realtime updates unavailable. Refresh once the server is reachable.
          </Alert>
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
            disabled={isRunActive}
          />
        </Paper>

        {active ? (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <ActiveRunCard
              runId={active.runId}
              status={active.state}
              counts={active.counts}
              ast={active.ast}
              currentFile={active.currentFile}
              fileIndex={active.fileIndex}
              fileTotal={active.fileTotal}
              percent={active.percent}
              etaMs={active.etaMs}
              lastError={active.lastError ?? undefined}
              message={active.message ?? undefined}
              isLoading={ingest.isLoading}
              isCancelling={ingest.isCancelling}
              error={ingest.error}
              onCancel={ingest.cancel}
            />
          </Paper>
        ) : null}

        <Paper variant="outlined" sx={{ p: 3 }}>
          <RootsTable
            roots={roots}
            lockedModelId={locked}
            isLoading={rootsLoading}
            error={rootsError}
            disabled={isRunActive}
            onRefresh={refetchRoots}
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
