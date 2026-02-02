import {
  Box,
  Chip,
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { IngestRoot } from '../../hooks/useIngestRoots';

export type RootDetailsDrawerProps = {
  root?: IngestRoot;
  open: boolean;
  lockedModelId?: string;
  onClose: () => void;
};

export default function RootDetailsDrawer({
  root,
  open,
  lockedModelId,
  onClose,
}: RootDetailsDrawerProps) {
  const loading = open && !root;
  const includeList = DEFAULT_INCLUDE_EXTENSIONS;
  const excludeList = DEFAULT_EXCLUDES;
  const astCounts = root?.ast;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      data-testid="root-details"
    >
      <Box sx={{ width: 380, p: 3 }} role="dialog" aria-label="Root details">
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
              <LabelValue label="Model" value={root.model} />
              {lockedModelId ? (
                <LabelValue
                  label="Model lock"
                  value={`Embedding model locked to ${lockedModelId}`}
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
              <LabelValue label="Run ID" value={root.runId} mono />
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

            {root.lastError ? (
              <Typography variant="body2" color="error">
                Last error: {root.lastError}
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
      </Box>
    </Drawer>
  );
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
