import {
  Alert,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import type { IngestRoot } from '../../hooks/useIngestRoots';

export type RootsTableProps = {
  roots: IngestRoot[];
  lockedModelId?: string;
  isLoading: boolean;
  error?: string;
  disabled?: boolean;
  onRefresh: () => Promise<void> | void;
  onRunStarted?: (runId: string) => void;
  onShowDetails?: (root: IngestRoot) => void;
  onRefreshModels?: () => Promise<void> | void;
};

type ActionState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
};

const statusColor: Record<
  string,
  'default' | 'info' | 'success' | 'warning' | 'error'
> = {
  completed: 'success',
  scanning: 'info',
  embedding: 'info',
  queued: 'info',
  cancelled: 'warning',
  error: 'error',
};

export default function RootsTable({
  roots,
  lockedModelId,
  isLoading,
  error,
  disabled,
  onRefresh,
  onRunStarted,
  onShowDetails,
  onRefreshModels,
}: RootsTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionState, setActionState] = useState<Record<string, ActionState>>(
    {},
  );
  const [bulkMessage, setBulkMessage] = useState<ActionState | null>(null);

  const busy = disabled || isLoading;

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const setStatus = (path: string, status: ActionState) => {
    setActionState((prev) => ({ ...prev, [path]: status }));
  };

  const clearSelection = () => setSelected(new Set());

  const doReembed = async (path: string) => {
    setStatus(path, { status: 'loading', message: 'Starting re-embed…' });
    try {
      const res = await fetch(
        new URL(
          `/ingest/reembed/${encodeURIComponent(path)}`,
          serverBase,
        ).toString(),
        { method: 'POST', headers: { 'content-type': 'application/json' } },
      );
      if (!res.ok) throw new Error(`Re-embed failed (${res.status})`);
      const data = (await res.json()) as { runId?: string };
      if (data?.runId) {
        onRunStarted?.(data.runId);
      }
      setStatus(path, { status: 'success', message: 'Re-embed started' });
      await onRefresh();
      await onRefreshModels?.();
    } catch (err) {
      setStatus(path, { status: 'error', message: (err as Error).message });
    }
  };

  const doRemove = async (path: string) => {
    setStatus(path, { status: 'loading', message: 'Removing…' });
    try {
      const res = await fetch(
        new URL(
          `/ingest/remove/${encodeURIComponent(path)}`,
          serverBase,
        ).toString(),
        { method: 'POST', headers: { 'content-type': 'application/json' } },
      );
      if (!res.ok) throw new Error(`Remove failed (${res.status})`);
      setStatus(path, { status: 'success', message: 'Removed' });
      await onRefresh();
      await onRefreshModels?.();
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } catch (err) {
      setStatus(path, { status: 'error', message: (err as Error).message });
    }
  };

  const handleBulk = async (action: 'reembed' | 'remove') => {
    if (!selected.size) return;
    setBulkMessage({ status: 'loading', message: 'Working on selected…' });
    try {
      for (const path of selected) {
        if (action === 'reembed') await doReembed(path);
        if (action === 'remove') await doRemove(path);
      }
      setBulkMessage({
        status: 'success',
        message: 'Finished selected actions',
      });
      clearSelection();
    } catch (err) {
      setBulkMessage({ status: 'error', message: (err as Error).message });
    }
  };

  const headerActions = useMemo(
    () => (
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Embedded folders
        </Typography>
        {lockedModelId ? (
          <Chip
            label={`Model locked to ${lockedModelId}`}
            size="small"
            color="info"
            variant="outlined"
            data-testid="roots-lock-chip"
          />
        ) : null}
        <Button onClick={() => void onRefresh()} disabled={busy}>
          Refresh
        </Button>
      </Stack>
    ),
    [lockedModelId, onRefresh, busy],
  );

  if (isLoading && !roots.length) {
    return (
      <Stack spacing={2} data-testid="roots-loading">
        {headerActions}
        <CircularProgress size={24} />
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack spacing={2}>
        {headerActions}
        <Alert severity="error">{error}</Alert>
      </Stack>
    );
  }

  if (!roots.length) {
    return (
      <Stack spacing={2}>
        {headerActions}
        <Alert severity="info">
          No embedded folders yet. Start an ingest to see entries here. Once the
          first ingest completes, the embedding model will lock to that choice.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {headerActions}

      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          {selected.size} selected
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={() => void handleBulk('reembed')}
          disabled={busy || selected.size === 0}
        >
          Re-embed selected
        </Button>
        <Button
          variant="outlined"
          color="error"
          size="small"
          onClick={() => void handleBulk('remove')}
          disabled={busy || selected.size === 0}
        >
          Remove selected
        </Button>
        {bulkMessage ? (
          <Typography
            variant="body2"
            color={bulkMessage.status === 'error' ? 'error' : 'text.secondary'}
          >
            {bulkMessage.message}
          </Typography>
        ) : null}
      </Stack>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  inputProps={{ 'aria-label': 'Select all roots' }}
                  indeterminate={
                    selected.size > 0 && selected.size < roots.length
                  }
                  checked={roots.length > 0 && selected.size === roots.length}
                  disabled={busy}
                  onChange={() => {
                    if (busy) return;
                    const allSelected = selected.size === roots.length;
                    setSelected(
                      allSelected
                        ? new Set()
                        : new Set(roots.map((r) => r.path)),
                    );
                  }}
                />
              </TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Path</TableCell>
              <TableCell>Model</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last ingest</TableCell>
              <TableCell>Counts</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roots.map((root) => {
              const state = actionState[root.path]?.status;
              const message = actionState[root.path]?.message;
              const rowDisabled = busy || state === 'loading';
              const isSelected = selected.has(root.path);
              const chipColor = statusColor[root.status] ?? 'default';
              return (
                <TableRow key={root.path} hover selected={isSelected}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={isSelected}
                      disabled={busy}
                      onChange={() => toggle(root.path)}
                      inputProps={{ 'aria-label': `Select ${root.name}` }}
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip
                      title={root.description || 'No description provided'}
                      placement="top"
                    >
                      <Typography fontWeight={600}>
                        {root.name || 'Untitled'}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {root.path}
                    </Typography>
                  </TableCell>
                  <TableCell>{root.model}</TableCell>
                  <TableCell>
                    <Chip label={root.status} color={chipColor} size="small" />
                  </TableCell>
                  <TableCell>
                    {root.lastIngestAt
                      ? new Date(root.lastIngestAt).toLocaleString()
                      : '–'}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Counts label="Files" value={root.counts?.files} />
                      <Counts label="Chunks" value={root.counts?.chunks} />
                      <Counts label="Embedded" value={root.counts?.embedded} />
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={1}
                      justifyContent="flex-end"
                    >
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => void doReembed(root.path)}
                        disabled={rowDisabled}
                      >
                        Re-embed
                      </Button>
                      <Button
                        variant="text"
                        color="error"
                        size="small"
                        onClick={() => void doRemove(root.path)}
                        disabled={rowDisabled}
                      >
                        Remove
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => onShowDetails?.(root)}
                      >
                        Details
                      </Button>
                    </Stack>
                    {message ? (
                      <Typography
                        variant="body2"
                        color={state === 'error' ? 'error' : 'text.secondary'}
                      >
                        {message}
                      </Typography>
                    ) : null}
                    {root.lastError ? (
                      <Typography variant="body2" color="error">
                        Last error: {root.lastError}
                      </Typography>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

const serverBase =
  (typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta).env?.VITE_API_URL) ??
  'http://localhost:5010';

function Counts({ label, value }: { label: string; value?: number }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography variant="body2" color="text.secondary">
        {label}:
      </Typography>
      <Typography variant="body2">{value ?? '–'}</Typography>
    </Stack>
  );
}
