import {
  Alert,
  Button,
  Card,
  CardContent,
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
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
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
  warning?: string;
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

type BulkActionTarget = {
  selectionKey: string;
  path: string;
};

type BulkActionResult = ActionResult & {
  selectionKey: string;
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

function getRootEmbeddingDisplay(root: IngestRoot) {
  const provider =
    root.queueState === 'waiting'
      ? (root.embeddingProvider ?? root.lock?.embeddingProvider)
      : root.embeddingProvider;
  const model =
    root.queueState === 'waiting'
      ? (root.embeddingModel ?? root.model)
      : (root.embeddingModel ?? root.model);
  if (provider && model) {
    return `${provider} / ${model}`;
  }
  return model ?? '—';
}

function getRootSelectionKey(root: IngestRoot) {
  return root.id || root.path;
}

function getRootReembedPath(root: IngestRoot) {
  return root.id || root.path;
}

function getRootRemovePath(root: IngestRoot) {
  return root.path;
}

function getRootActionStatusKeys(root: IngestRoot) {
  return Array.from(
    new Set([getRootReembedPath(root), getRootRemovePath(root)]),
  );
}

function getRenderableRootError(root: IngestRoot) {
  if (
    root.status === 'ingesting' &&
    (root.queueState === 'waiting' || root.queueState === 'running')
  ) {
    return null;
  }
  return root.lastError ?? root.error?.message ?? root.error?.details;
}

export default function RootsTable({
  roots,
  activeRunId,
  lockedModelId,
  lockedModel,
  isLoading,
  error,
  warning,
  disabled,
  hasActiveRun = false,
  onRefresh,
  onRunStarted,
  onShowDetails,
  onRefreshModels,
}: RootsTableProps) {
  const log = useMemo(() => createLogger('client'), []);
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));
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
          .map((root) => getRootSelectionKey(root)),
      ),
    [activeRunId, roots],
  );
  const rootSelectionKeys = useMemo(
    () => new Set(roots.map((root) => getRootSelectionKey(root))),
    [roots],
  );
  const rootsBySelectionKey = useMemo(
    () =>
      new Map(
        roots.map((root) => [
          getRootSelectionKey(root),
          {
            root,
            selectionKey: getRootSelectionKey(root),
            reembedPath: getRootReembedPath(root),
            removePath: getRootRemovePath(root),
          },
        ]),
      ),
    [roots],
  );
  const selectedEligibleRoots = useMemo(
    () =>
      Array.from(selected)
        .map((selectionKey) => rootsBySelectionKey.get(selectionKey))
        .filter(
          (
            entry,
          ): entry is {
            root: IngestRoot;
            selectionKey: string;
            reembedPath: string;
            removePath: string;
          } => {
            if (!entry) {
              return false;
            }
            return selectableRootPaths.has(entry.selectionKey);
          },
        ),
    [rootsBySelectionKey, selectableRootPaths, selected],
  );
  const selectedStaleCurrentKeys = useMemo(
    () =>
      Array.from(selected).filter(
        (selectionKey) =>
          rootSelectionKeys.has(selectionKey) &&
          !selectableRootPaths.has(selectionKey),
      ),
    [rootSelectionKeys, selectableRootPaths, selected],
  );
  const removableSelectedTargets: BulkActionTarget[] = useMemo(
    () =>
      selectedEligibleRoots.map((entry) => ({
        selectionKey: entry.selectionKey,
        path: entry.removePath,
      })),
    [selectedEligibleRoots],
  );
  const reembeddableSelectedTargets: BulkActionTarget[] = useMemo(
    () =>
      selectedEligibleRoots.map((entry) => ({
        selectionKey: entry.selectionKey,
        path: entry.reembedPath,
      })),
    [selectedEligibleRoots],
  );
  const canBulkRemove =
    !busy && !hasActiveRun && removableSelectedTargets.length > 0;
  const selectableRootCount = selectableRootPaths.size;
  const selectedSelectableCount = selectedEligibleRoots.length;
  const allSelectableSelected =
    selectableRootCount > 0 && selectedSelectableCount === selectableRootCount;

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
        queueState?: 'running' | null;
        queuePosition?: number | null;
      };
      if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
        throw new Error('Missing requestId in response');
      }
      const isWaiting = data.queued === true;
      const runId =
        typeof data.runId === 'string' && data.runId.length > 0
          ? data.runId
          : undefined;
      if (isWaiting) {
        setStatus(path, {
          status: 'success',
          message: `Queued${
            typeof data.queuePosition === 'number'
              ? ` (#${data.queuePosition})`
              : ''
          }`,
        });
      } else if (runId || data.queueState === 'running') {
        if (!runId) {
          throw new Error('Malformed re-embed response');
        }
        onRunStarted?.(runId);
        setStatus(path, {
          status: 'success',
          message: 'Re-embed started',
        });
      } else {
        throw new Error('Malformed re-embed response');
      }
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
      return { ok: true, path };
    } catch (err) {
      setStatus(path, { status: 'error', message: (err as Error).message });
      return { ok: false, path };
    }
  };

  const handleRowReembed = async (path: string) => {
    const result = await doReembed(path);
    if (!result.ok) {
      return;
    }
    await onRefresh();
    await onRefreshModels?.();
  };

  const handleRowRemove = async (path: string, selectionKey: string) => {
    const result = await doRemove(path);
    if (!result.ok) {
      return;
    }
    await onRefresh();
    await onRefreshModels?.();
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(selectionKey);
      return next;
    });
  };

  const handleBulk = async (action: 'reembed' | 'remove') => {
    const targets =
      action === 'remove'
        ? removableSelectedTargets
        : reembeddableSelectedTargets;
    if (targets.length === 0) return;
    setBulkMessage({ status: 'loading', message: 'Working on selected…' });
    const results: BulkActionResult[] = [];
    for (const target of targets) {
      if (action === 'reembed') {
        results.push({
          ...(await doReembed(target.path)),
          selectionKey: target.selectionKey,
        });
      }
      if (action === 'remove') {
        results.push({
          ...(await doRemove(target.path)),
          selectionKey: target.selectionKey,
        });
      }
    }
    const failedSelectionKeys = results
      .filter((result) => !result.ok)
      .map((result) => result.selectionKey);
    const successCount = results.length - failedSelectionKeys.length;
    if (successCount > 0) {
      await onRefresh();
      await onRefreshModels?.();
    }
    if (failedSelectionKeys.length === 0) {
      setBulkMessage({
        status: 'success',
        message: 'Finished selected actions',
      });
      setSelected(new Set(selectedStaleCurrentKeys));
      return;
    }
    setSelected(new Set([...selectedStaleCurrentKeys, ...failedSelectionKeys]));
    if (successCount === 0) {
      setBulkMessage({
        status: 'error',
        message: `${failedSelectionKeys.length} selected action${failedSelectionKeys.length === 1 ? '' : 's'} failed. The failed row${failedSelectionKeys.length === 1 ? ' remains' : 's remain'} selected for retry.`,
      });
      return;
    }
    setBulkMessage({
      status: 'error',
      message: `Partial failure: ${successCount} of ${results.length} selected actions completed. ${failedSelectionKeys.length} failed and remain selected for retry.`,
    });
  };

  const headerActions = useMemo(
    () => (
      <Stack
        direction={isSmall ? 'column' : 'row'}
        spacing={2}
        alignItems={isSmall ? 'stretch' : 'center'}
        sx={{ mb: 2 }}
      >
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
    [busy, isSmall, lockDisplay, onRefresh],
  );

  const bulkControls = (
    <Stack
      direction={isSmall ? 'column' : 'row'}
      spacing={1.5}
      alignItems={isSmall ? 'stretch' : 'center'}
    >
      <Typography variant="body2" color="text.secondary">
        {selected.size} selected
      </Typography>
      <Stack
        direction={isSmall ? 'column' : 'row'}
        spacing={1}
        flexWrap="wrap"
        alignItems={isSmall ? 'stretch' : 'center'}
      >
        <Button
          variant="outlined"
          size="small"
          onClick={() => void handleBulk('reembed')}
          disabled={busy || reembeddableSelectedTargets.length === 0}
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
      </Stack>
      {bulkMessage ? (
        <Typography
          variant="body2"
          color={bulkMessage.status === 'error' ? 'error' : 'text.secondary'}
        >
          {bulkMessage.message}
        </Typography>
      ) : null}
    </Stack>
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

  if (isSmall) {
    return (
      <Stack spacing={2}>
        {headerActions}
        {warning ? <Alert severity="warning">{warning}</Alert> : null}
        {bulkControls}
        <Stack spacing={1.5}>
          {roots.map((root) => {
            const reembedPath = getRootReembedPath(root);
            const removePath = getRootRemovePath(root);
            const activeActionState =
              getRootActionStatusKeys(root)
                .map((statusKey) => actionState[statusKey])
                .find((status) => status?.status === 'loading') ??
              getRootActionStatusKeys(root)
                .map((statusKey) => actionState[statusKey])
                .find(Boolean);
            const state = activeActionState?.status;
            const message = activeActionState?.message;
            const rowDisabled = busy || state === 'loading';
            const reembedDisabled =
              rowDisabled || blocksSharedSelection(root, activeRunId);
            const removeDisabled =
              rowDisabled || hasActiveRun || blocksUserRemove(root);
            const rowKey = getRootSelectionKey(root);
            const isSelected = selected.has(rowKey);
            const chipColor = statusColor[root.status] ?? 'default';
            const phase = root.status === 'ingesting' ? root.phase : undefined;
            const statusLabel =
              root.queueState === 'cleanup-blocked'
                ? 'cleanup blocked'
                : root.queueState === 'waiting'
                  ? `queued${typeof root.queuePosition === 'number' ? ` (#${root.queuePosition})` : ''}`
                  : phase
                    ? `${root.status} (${phase})`
                    : root.status;
            const rootModelDisplay = getRootEmbeddingDisplay(root);
            const rootError = getRenderableRootError(root);
            const astCounts = root.ast;

            return (
              <Card key={rowKey} variant="outlined">
                <CardContent sx={{ display: 'grid', gap: 1.25 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Checkbox
                      checked={isSelected}
                      disabled={
                        busy || blocksSharedSelection(root, activeRunId)
                      }
                      onChange={() => toggle(rowKey)}
                      inputProps={{ 'aria-label': `Select ${root.name}` }}
                      sx={{ mt: -0.75, ml: -1 }}
                    />
                    <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                      <Tooltip
                        title={root.description || 'No description provided'}
                        placement="top"
                      >
                        <Typography fontWeight={600} noWrap>
                          {root.name || 'Untitled'}
                        </Typography>
                      </Tooltip>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {root.path}
                      </Typography>
                    </Stack>
                    <Chip label={statusLabel} color={chipColor} size="small" />
                  </Stack>

                  <Typography variant="body2">
                    <strong>Embedding:</strong> {rootModelDisplay}
                  </Typography>

                  <Stack spacing={0.5}>
                    <Typography variant="body2" color="text.secondary">
                      Last ingest:{' '}
                      {root.lastIngestAt
                        ? new Date(root.lastIngestAt).toLocaleString()
                        : '–'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Files {root.counts?.files ?? '–'} · Chunks{' '}
                      {root.counts?.chunks ?? '–'} · Embedded{' '}
                      {root.counts?.embedded ?? '–'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      AST Supported {astCounts?.supportedFileCount ?? '–'} · AST
                      Skipped {astCounts?.skippedFileCount ?? '–'} · AST Failed{' '}
                      {astCounts?.failedFileCount ?? '–'}
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button
                      variant="text"
                      size="small"
                      onClick={() => void handleRowReembed(reembedPath)}
                      disabled={reembedDisabled}
                    >
                      Re-embed
                    </Button>
                    <Button
                      variant="text"
                      color="error"
                      size="small"
                      onClick={() => void handleRowRemove(removePath, rowKey)}
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
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {headerActions}
      {warning ? <Alert severity="warning">{warning}</Alert> : null}
      {bulkControls}

      <TableContainer
        data-testid="roots-table-scroll-region"
        sx={{ width: '100%', overflowX: 'auto' }}
      >
        <Table size="small" sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  inputProps={{ 'aria-label': 'Select all roots' }}
                  indeterminate={
                    selectedSelectableCount > 0 &&
                    selectedSelectableCount < selectableRootCount
                  }
                  checked={allSelectableSelected}
                  disabled={busy || selectableRootCount === 0}
                  onChange={() => {
                    if (busy) return;
                    const allSelected = allSelectableSelected;
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const path of selectableRootPaths) {
                        if (allSelected) {
                          next.delete(path);
                        } else {
                          next.add(path);
                        }
                      }
                      return next;
                    });
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
              const reembedPath = getRootReembedPath(root);
              const removePath = getRootRemovePath(root);
              const activeActionState =
                getRootActionStatusKeys(root)
                  .map((statusKey) => actionState[statusKey])
                  .find((status) => status?.status === 'loading') ??
                getRootActionStatusKeys(root)
                  .map((statusKey) => actionState[statusKey])
                  .find(Boolean);
              const state = activeActionState?.status;
              const message = activeActionState?.message;
              const rowDisabled = busy || state === 'loading';
              const reembedDisabled =
                rowDisabled || blocksSharedSelection(root, activeRunId);
              const removeDisabled =
                rowDisabled || hasActiveRun || blocksUserRemove(root);
              const rowKey = getRootSelectionKey(root);
              const isSelected = selected.has(rowKey);
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
              const rootModelDisplay = getRootEmbeddingDisplay(root);
              const rootError = getRenderableRootError(root);
              const astCounts = root.ast;
              return (
                <TableRow key={rowKey} hover selected={isSelected}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={isSelected}
                      disabled={
                        busy || blocksSharedSelection(root, activeRunId)
                      }
                      onChange={() => toggle(rowKey)}
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
                        onClick={() => void handleRowReembed(reembedPath)}
                        disabled={reembedDisabled}
                      >
                        Re-embed
                      </Button>
                      <Button
                        variant="text"
                        color="error"
                        size="small"
                        onClick={() => void handleRowRemove(removePath, rowKey)}
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
