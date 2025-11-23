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
import { useState } from 'react';
import IngestForm from '../components/ingest/IngestForm';
import useIngestModels from '../hooks/useIngestModels';

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
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Active ingest
          </Typography>
          {activeRunId ? (
            <Typography color="text.secondary">
              Run ID: {activeRunId}
            </Typography>
          ) : (
            <Typography color="text.secondary">
              Active run card placeholder.
            </Typography>
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
