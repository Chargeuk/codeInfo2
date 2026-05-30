import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Chip,
  Divider,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Typography,
  IconButton,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo } from 'react';
import type { IngestRoot } from '../../hooks/useIngestRoots';
import { createLogger } from '../../logging';

export type RootDetailsDrawerProps = {
  root?: IngestRoot;
  open: boolean;
  lockedModelId?: string;
  lockedModel?: {
    embeddingProvider?: 'lmstudio' | 'openai';
    embeddingModel?: string;
    embeddingDimensions?: number;
  };
  onClose: () => void;
};

export default function RootDetailsDrawer({
  root,
  open,
  lockedModelId,
  lockedModel,
  onClose,
}: RootDetailsDrawerProps) {
  const log = useMemo(() => createLogger('client'), []);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const loading = open && !root;
  const includeList = DEFAULT_INCLUDE_EXTENSIONS;
  const excludeList = DEFAULT_EXCLUDES;
  const astCounts = root?.ast;
  const lockModel = lockedModel?.embeddingModel ?? lockedModelId;
  const lockDisplay = lockModel
    ? [
        lockedModel?.embeddingProvider
          ? `${lockedModel.embeddingProvider} / ${lockModel}`
          : lockModel,
        typeof lockedModel?.embeddingDimensions === 'number'
          ? `${lockedModel.embeddingDimensions} dims`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const rootModelDisplay = root ? getRootEmbeddingDisplay(root) : undefined;
  const rootError = root ? getRenderableRootError(root) : null;

  useEffect(() => {
    if (!open) return;
    log('info', 'DEV-0000036:T13:ingest_ui_state_rendered', {
      component: 'RootDetailsDrawer',
      selectedEmbeddingProvider: root?.embeddingProvider ?? null,
      selectedEmbeddingModel: root?.embeddingModel ?? root?.model ?? null,
      openAiStatusCode: null,
      hasDimensionsInput: false,
    });
  }, [log, open, root?.embeddingModel, root?.embeddingProvider, root?.model]);

  const content = (
    <Stack spacing={2}>
      {loading ? (
        <Stack spacing={2}>
          <Skeleton variant="text" width="70%" />
          <Skeleton variant="rectangular" height={120} />
        </Stack>
      ) : null}

      {root ? (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6" sx={{ flex: 1 }}>
              {root.name || 'Embedded root'}
            </Typography>
            <Chip label={root.status} size="small" />
          </Stack>

          <Stack spacing={0.5}>
            <LabelValue
              label="Description"
              value={root.description || 'No description provided'}
            />
            <LabelValue label="Path" value={root.path} mono />
            <LabelValue label="Model" value={rootModelDisplay ?? '—'} />
            {lockDisplay ? (
              <LabelValue
                label="Model lock"
                value={`Embedding model locked to ${lockDisplay}`}
              />
            ) : null}
            <LabelValue
              label="Last ingest"
              value={
                root.lastIngestAt
                  ? new Date(root.lastIngestAt).toLocaleString()
                  : '—'
              }
            />
            {root.requestId ? (
              <LabelValue label="Request ID" value={root.requestId} mono />
            ) : null}
            <LabelValue
              label="Run ID"
              value={root.runId ?? 'Pending queue start'}
              mono
            />
            {root.queueState ? (
              <LabelValue
                label="Queue state"
                value={
                  root.queueState === 'waiting'
                    ? typeof root.queuePosition === 'number'
                      ? `waiting (#${root.queuePosition})`
                      : 'waiting'
                    : root.queueState
                }
              />
            ) : null}
          </Stack>

          <Divider />

          <Stack spacing={0.5}>
            <Typography variant="subtitle2">Counts</Typography>
            <Typography variant="body2" color="text.secondary">
              Files: {root.counts?.files ?? '–'} • Chunks:{' '}
              {root.counts?.chunks ?? '–'} • Embedded:{' '}
              {root.counts?.embedded ?? '–'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              AST Supported: {astCounts?.supportedFileCount ?? '–'} • AST
              Skipped: {astCounts?.skippedFileCount ?? '–'} • AST Failed:{' '}
              {astCounts?.failedFileCount ?? '–'}
            </Typography>
          </Stack>

          {rootError ? (
            <Typography variant="body2" color="error">
              Last error: {rootError}
            </Typography>
          ) : null}

          <Divider />

          <Typography variant="subtitle2">Include extensions</Typography>
          <List dense>
            {includeList.map((item) => (
              <ListItem key={item} disablePadding>
                <ListItemText primary={item} />
              </ListItem>
            ))}
          </List>

          <Typography variant="subtitle2">Exclude patterns</Typography>
          <List dense>
            {excludeList.map((item) => (
              <ListItem key={item} disablePadding>
                <ListItemText primary={item} />
              </ListItem>
            ))}
          </List>

          <Typography variant="caption" color="text.secondary">
            Lists show server defaults when detailed metadata is unavailable.
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );

  if (isMobile) {
    return (
      <Dialog
        fullScreen
        open={open}
        onClose={onClose}
        data-testid="root-details"
      >
        <DialogTitle sx={{ pr: 6 }}>
          Root details
          <IconButton
            aria-label="Close root details"
            onClick={onClose}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box>{content}</Box>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      data-testid="root-details"
    >
      <Box sx={{ width: 380, p: 3 }} role="dialog" aria-label="Root details">
        {content}
      </Box>
    </Drawer>
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

function LabelValue({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={mono ? { fontFamily: 'monospace' } : undefined}
      >
        {value}
      </Typography>
    </Stack>
  );
}

const DEFAULT_INCLUDE_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'jsonc',
  'md',
  'mdx',
  'txt',
  'py',
  'java',
  'kt',
  'kts',
  'go',
  'rs',
  'rb',
  'php',
  'cs',
  'cpp',
  'cc',
  'c',
  'h',
  'hpp',
  'swift',
  'scala',
  'clj',
  'cljs',
  'edn',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'env',
  'sql',
];

const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'logs',
  'vendor',
  '*.log',
  '*.min.js',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];
