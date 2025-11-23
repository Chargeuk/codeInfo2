import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import ActiveRunCard from '../components/ingest/ActiveRunCard';
import IngestForm from '../components/ingest/IngestForm';
import useIngestModels from '../hooks/useIngestModels';
import useIngestStatus from '../hooks/useIngestStatus';

export default function IngestPage() {
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
  const status = useIngestStatus(activeRunId);

  const isRunActive = useMemo(
    () =>
      Boolean(
        activeRunId &&
          status.status &&
          !['completed', 'cancelled', 'error'].includes(status.status),
      ),
    [activeRunId, status.status],
  );

  useEffect(() => {
    if (!activeRunId) return;
    if (
      status.status &&
      ['completed', 'cancelled', 'error'].includes(status.status)
    ) {
      // run finished; no extra action needed yet
    }
  }, [activeRunId, status.status]);

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

        <Paper variant="outlined" sx={{ p: 3 }}>
          {lockedModelId ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Embedding model locked to {lockedModelId}
            </Alert>
          ) : null}

          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              Start a new ingest
            </Typography>
            {isLoading ? <CircularProgress size={20} /> : null}
          </Stack>

          <IngestForm
            models={models}
            lockedModelId={lockedModelId}
            defaultModelId={defaultModelId}
            onStarted={(runId) => setActiveRunId(runId)}
            disabled={isRunActive}
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          {activeRunId ? (
            <ActiveRunCard
              runId={activeRunId}
              status={status.status}
              counts={status.counts}
              lastError={status.lastError ?? undefined}
              message={status.message ?? undefined}
              isLoading={status.isLoading}
              isCancelling={status.isCancelling}
              error={status.error}
              onCancel={status.cancel}
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
          <Typography variant="h6" gutterBottom>
            Embedded folders
          </Typography>
          <Box>
            <Typography color="text.secondary">
              Roots table placeholder.
            </Typography>
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
}
