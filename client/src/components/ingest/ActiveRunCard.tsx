import {
  Alert,
  Button,
  Chip,
  Divider,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export type ActiveRunCardProps = {
  runId: string;
  status?:
    | 'queued'
    | 'scanning'
    | 'embedding'
    | 'completed'
    | 'cancelled'
    | 'error';
  counts?: {
    files?: number;
    chunks?: number;
    embedded?: number;
    skipped?: number;
  };
  currentFile?: string | null;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
  lastError?: string | null;
  message?: string | null;
  isLoading: boolean;
  isCancelling: boolean;
  onCancel: () => Promise<void>;
  error?: string;
};

const statusColor: Record<
  NonNullable<ActiveRunCardProps['status']>,
  'default' | 'info' | 'success' | 'warning' | 'error'
> = {
  queued: 'info',
  scanning: 'info',
  embedding: 'info',
  completed: 'success',
  cancelled: 'warning',
  error: 'error',
};

export default function ActiveRunCard({
  runId,
  status,
  counts,
  currentFile,
  fileIndex,
  fileTotal,
  percent,
  etaMs,
  lastError,
  message,
  isLoading,
  isCancelling,
  onCancel,
  error,
}: ActiveRunCardProps) {
  const isTerminal =
    status === 'completed' || status === 'cancelled' || status === 'error';
  const showCancel = !isTerminal;
  const logsHref = `/logs?text=${encodeURIComponent(runId)}`;

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h6" sx={{ flex: 1 }}>
          Active ingest
        </Typography>
        <Chip
          label={status ?? 'Loading…'}
          color={status ? statusColor[status] : 'default'}
          size="small"
        />
      </Stack>

      <ProgressRow
        currentFile={currentFile}
        fileIndex={fileIndex}
        fileTotal={fileTotal}
        percent={percent}
        etaMs={etaMs}
      />

      <Stack direction="row" spacing={3} flexWrap="wrap">
        <Metric label="Files" value={counts?.files} />
        <Metric label="Chunks" value={counts?.chunks} />
        <Metric label="Embedded" value={counts?.embedded} />
        <Metric label="Skipped" value={counts?.skipped} />
      </Stack>

      {message ? (
        <Typography color="text.secondary" variant="body2">
          {message}
        </Typography>
      ) : null}

      {lastError ? (
        <Alert severity="error" data-testid="ingest-last-error">
          {lastError}
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" data-testid="ingest-status-error">
          {error}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={2} alignItems="center">
        <Button
          variant="outlined"
          color="secondary"
          onClick={() => void onCancel()}
          disabled={!showCancel || isCancelling || isLoading}
        >
          {isCancelling ? 'Cancelling…' : 'Cancel ingest'}
        </Button>
        <MuiLink component={RouterLink} to={logsHref} underline="hover">
          View logs for this run
        </MuiLink>
      </Stack>

      <Divider />

      <Typography variant="body2" color="text.secondary">
        Run ID: {runId}
      </Typography>
    </Stack>
  );
}

type MetricProps = { label: string; value?: number };
function Metric({ label, value }: MetricProps) {
  return (
    <Stack spacing={0.25} minWidth={110}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="subtitle1">{value ?? '–'}</Typography>
    </Stack>
  );
}

type ProgressRowProps = {
  currentFile?: string | null;
  fileIndex?: number;
  fileTotal?: number;
  percent?: number;
  etaMs?: number;
};

function formatEta(etaMs?: number) {
  if (etaMs === undefined || etaMs === null || Number.isNaN(etaMs)) return '–';
  const totalSeconds = Math.max(0, Math.round(etaMs / 1000));
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function ProgressRow({
  currentFile,
  fileIndex,
  fileTotal,
  percent,
  etaMs,
}: ProgressRowProps) {
  const hasFileInfo = fileIndex !== undefined && fileTotal !== undefined;
  const percentText = percent !== undefined ? `${percent.toFixed(1)}%` : '–';
  const etaText = formatEta(etaMs);

  if (
    !hasFileInfo &&
    !currentFile &&
    percent === undefined &&
    etaMs === undefined
  ) {
    return (
      <Typography variant="body2" color="text.secondary">
        Pending file info
      </Typography>
    );
  }

  return (
    <Stack spacing={0.25}>
      <Typography variant="body2" color="text.secondary">
        Current file
      </Typography>
      <Typography
        variant="body1"
        sx={{ wordBreak: 'break-all' }}
        data-testid="ingest-current-file"
      >
        {currentFile ?? 'Unknown path'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {hasFileInfo ? `${fileIndex} / ${fileTotal}` : '– / –'} · {percentText}{' '}
        · ETA {etaText}
      </Typography>
    </Stack>
  );
}
