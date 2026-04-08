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
import { useEffect, useMemo, useState } from 'react';
import { getApiBaseUrl } from '../../api/baseUrl';
import { isDev0000038MarkerGateEnabled } from '../../hooks/useChatWs';
import type { IngestRoot } from '../../hooks/useIngestRoots';
import { createLogger } from '../../logging';

export type RootsTableProps = {
  roots: IngestRoot[];
  activeRunId?: string;
  lockedModelId?: string;
  lockedModel?: {
    embeddingProvider?: 'lmstudio' | 'openai';
    embeddingModel?: string;
    embeddingDimensions?: number;
  };
  isLoading: boolean;
  error?: string;
  disabled?: boolean;
  hasActiveRun?: boolean;
  onRefresh: () => Promise<void> | void;
  onRunStarted?: (runId: string) => void;
  onShowDetails?: (root: IngestRoot) => void;
  onRefreshModels?: () => Promise<void> | void;
};

type ActionState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
};

type ActionResult = {
  ok: boolean;
  path: string;
};

const statusColor: Record<
  string,
  'default' | 'info' | 'success' | 'warning' | 'error'
> = {
  ingesting: 'info',
  completed: 'success',
  scanning: 'info',
  embedding: 'info',
  queued: 'info',
  cancelled: 'warning',
  error: 'error',
};

function blocksDestructiveAction(root: IngestRoot) {
  return (
    root.status === 'ingesting' ||
    root.queueState === 'waiting' ||
    root.queueState === 'running' ||
    root.queueState === 'cleanup-blocked'
  );
}

function blocksUserRemove(root: IngestRoot) {
  return blocksDestructiveAction(root);
}

function blocksSharedSelection(root: IngestRoot, activeRunId?: string) {
  return (
    blocksDestructiveAction(root) ||
    (typeof activeRunId === 'string' &&
      activeRunId.length > 0 &&
      root.runId === activeRunId)
  );
}

export default function RootsTable({
  roots,
  activeRunId,
  lockedModelId,
  lockedModel,
  isLoading,
  error,
  disabled,
  hasActiveRun = false,
  onRefresh,
  onRunStarted,
  onShowDetails,
  onRefreshModels,
}: RootsTableProps) {
  const log = useMemo(() => createLogger('client'), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionState, setActionState] = useState<Record<string, ActionState>>(
    {},
  );
  const [bulkMessage, setBulkMessage] = useState<ActionState | null>(null);

  const busy = disabled || isLoading;
  const lockedProvider = lockedModel?.embeddingProvider;
  const lockModel = lockedModel?.embeddingModel ?? lockedModelId;
  const lockDimensions = lockedModel?.embeddingDimensions;
  const lockDisplay = lockModel
    ? [
        lockedProvider ? `${lockedProvider} / ${lockModel}` : lockModel,
        typeof lockDimensions === 'number' ? `${lockDimensions} dims` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const selectableRootPaths = useMemo(
    () =>
      new Set(
        roots
          .filter((root) => !blocksSharedSelection(root, activeRunId))
          .map((root) => root.path),
      ),
    [activeRunId, roots],
  );
  const removableSelectedPaths = useMemo(
    () => Array.from(selected).filter((path) => selectableRootPaths.has(path)),
    [selectableRootPaths, selected],
  );
  const canBulkRemove =
    !busy && !hasActiveRun && removableSelectedPaths.length > 0;
  const selectableRootCount = selectableRootPaths.size;
  const allSelectableSelected =
    selectableRootCount > 0 && selected.size === selectableRootCount;

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(
        Array.from(prev).filter((path) => selectableRootPaths.has(path)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [selectableRootPaths]);

  const toggle = (path: string) => {
    if (!selectableRootPaths.has(path)) {
      return;
    }
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

  const doReembed = async (path: string): Promise<ActionResult> => {
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
      const data = (await res.json()) as {
        queued?: boolean;
        requestId?: string;
        runId?: string;
        queuePosition?: number | null;
      };
      if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
        throw new Error('Missing requestId in response');
      }
      if (data.queued === true) {
        setStatus(path, {
          status: 'success',
          message: `Queued${
            typeof data.queuePosition === 'number'
              ? ` (#${data.queuePosition})`
              : ''
          }`,
        });
      } else if (typeof data.runId === 'string' && data.runId.length > 0) {
        onRunStarted?.(data.runId);
        setStatus(path, {
          status: 'success',
          message: 'Re-embed started',
        });
      } else {
        throw new Error('Malformed re-embed response');
      }
      await onRefresh();
      await onRefreshModels?.();
      return { ok: true, path };
    } catch (err) {
      setStatus(path, { status: 'error', message: (err as Error).message });
      return { ok: false, path };
    }
  };

  const doRemove = async (path: string): Promise<ActionResult> => {
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
      return { ok: true, path };
    } catch (err) {
      setStatus(path, { status: 'error', message: (err as Error).message });
      return { ok: false, path };
    }
  };

  const handleBulk = async (action: 'reembed' | 'remove') => {
    const targetPaths =
      action === 'remove' ? removableSelectedPaths : Array.from(selected);
    if (targetPaths.length === 0) return;
    setBulkMessage({ status: 'loading', message: 'Working on selected…' });
    const results: ActionResult[] = [];
    for (const path of targetPaths) {
      if (action === 'reembed') {
        results.push(await doReembed(path));
      }
      if (action === 'remove') {
        results.push(await doRemove(path));
      }
    }
    const failedPaths = results
      .filter((result) => !result.ok)
      .map((result) => result.path);
    const successCount = results.length - failedPaths.length;
    if (failedPaths.length === 0) {
      setBulkMessage({
        status: 'success',
        message: 'Finished selected actions',
      });
      clearSelection();
      return;
    }
    setSelected(new Set(failedPaths));
    if (successCount === 0) {
      setBulkMessage({
        status: 'error',
        message: `${failedPaths.length} selected action${failedPaths.length === 1 ? '' : 's'} failed. The failed row${failedPaths.length === 1 ? ' remains' : 's remain'} selected for retry.`,
      });
      return;
    }
    setBulkMessage({
      status: 'error',
      message: `Partial failure: ${successCount} of ${results.length} selected actions completed. ${failedPaths.length} failed and remain selected for retry.`,
    });
  };

  const headerActions = useMemo(
    () => (
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Embedded folders
        </Typography>
        {lockDisplay ? (
          <Chip
            label={`Model locked to ${lockDisplay}`}
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
    [lockDisplay, onRefresh, busy],
  );

  useEffect(() => {
    log('info', 'DEV-0000036:T13:ingest_ui_state_rendered', {
      component: 'RootsTable',
      selectedEmbeddingProvider: lockedProvider ?? null,
      selectedEmbeddingModel: lockModel ?? null,
      openAiStatusCode: null,
      hasDimensionsInput: false,
    });
  }, [log, lockModel, lockedProvider]);

  useEffect(() => {
    if (!isDev0000038MarkerGateEnabled()) {
      return;
    }
    for (const root of roots) {
      const sourceId = root.path || 'unknown';
      const phase = root.status === 'ingesting' ? root.phase : undefined;
      console.info(
        `[DEV-0000038][T7] INGEST_UI_ROW_RENDER sourceId=${sourceId} status=${root.status} phase=${phase ?? 'none'}`,
      );
      if (
        root.status === 'completed' ||
        root.status === 'cancelled' ||
        root.status === 'error'
      ) {
        console.info(
          `[DEV-0000038][T7] INGEST_UI_TERMINAL_PHASE_HIDDEN sourceId=${sourceId} status=${root.status}`,
        );
      }
    }
  }, [roots]);

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
          disabled={!canBulkRemove}
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
                    selected.size > 0 && selected.size < selectableRootCount
                  }
                  checked={allSelectableSelected}
                  disabled={busy || selectableRootCount === 0}
                  onChange={() => {
                    if (busy) return;
                    const allSelected = allSelectableSelected;
                    setSelected(
                      allSelected ? new Set() : new Set(selectableRootPaths),
                    );
                  }}
                />
              </TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Path</TableCell>
              <TableCell>Embedding</TableCell>
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
              const removeDisabled =
                rowDisabled || hasActiveRun || blocksUserRemove(root);
              const isSelected = selected.has(root.path);
              const chipColor = statusColor[root.status] ?? 'default';
              const phase =
                root.status === 'ingesting' ? root.phase : undefined;
              const statusLabel =
                root.queueState === 'cleanup-blocked'
                  ? 'cleanup blocked'
                  : root.queueState === 'waiting'
                    ? `queued${typeof root.queuePosition === 'number' ? ` (#${root.queuePosition})` : ''}`
                    : phase
                      ? `${root.status} (${phase})`
                      : root.status;
              const rootModelDisplay =
                root.embeddingModel && root.embeddingProvider
                  ? `${root.embeddingProvider} / ${root.embeddingModel}`
                  : root.model;
              const rootError =
                root.lastError ?? root.error?.message ?? root.error?.details;
              const astCounts = root.ast;
              return (
                <TableRow key={root.path} hover selected={isSelected}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={isSelected}
                      disabled={
                        busy || blocksSharedSelection(root, activeRunId)
                      }
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
                  <TableCell>{rootModelDisplay}</TableCell>
                  <TableCell>
                    <Chip label={statusLabel} color={chipColor} size="small" />
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
                      <Counts
                        label="AST Supported"
                        value={astCounts?.supportedFileCount}
                      />
                      <Counts
                        label="AST Skipped"
                        value={astCounts?.skippedFileCount}
                      />
                      <Counts
                        label="AST Failed"
                        value={astCounts?.failedFileCount}
                      />
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
                        disabled={removeDisabled}
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
                    {rootError ? (
                      <Typography
                        variant="caption"
                        color="error.main"
                        data-testid="roots-row-last-error"
                      >
                        Last error: {rootError}
                      </Typography>
                    ) : null}
                    {message ? (
                      <Typography
                        variant="body2"
                        color={state === 'error' ? 'error' : 'text.secondary'}
                      >
                        {message}
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

const serverBase = getApiBaseUrl();

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
