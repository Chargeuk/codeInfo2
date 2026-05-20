import type {
  ChatProviderInfo,
  LmStudioModel,
  VersionInfo,
} from '@codeinfo2/common';
import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import GitHubIcon from '@mui/icons-material/GitHub';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { type ReactNode } from 'react';
import type { HomeProviderPresentation } from './homePageData';

function formatTime(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function humanSize(bytes?: number | null) {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(1)} ${units[idx]}`;
}

function ProviderIcon({ provider }: { provider: ChatProviderInfo }) {
  const iconSx = { fontSize: 36 };
  switch (provider.id) {
    case 'codex':
      return <CodeRoundedIcon sx={iconSx} />;
    case 'copilot':
      return <GitHubIcon sx={iconSx} />;
    default:
      return <MemoryOutlinedIcon sx={iconSx} />;
  }
}

function ActionIcon({ icon }: { icon: ReactNode }) {
  return (
    <Box sx={{ display: 'inline-flex', mr: 1, color: 'inherit' }}>{icon}</Box>
  );
}

export function HomeSummaryCards({
  clientVersion,
  serverVersion,
  versionError,
  versionLoading,
  lastCheckedLabel,
  providerSummaries,
  onRefreshAll,
  onCheckLmStudio,
  onProviderAuth,
}: {
  clientVersion: string;
  serverVersion: VersionInfo | null;
  versionError: string | null;
  versionLoading: boolean;
  lastCheckedLabel: string | null;
  providerSummaries: HomeProviderPresentation[];
  onRefreshAll: () => void;
  onCheckLmStudio: () => void;
  onProviderAuth: () => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const summaryRow = providerSummaries.slice(0, 3);

  return (
    <Stack direction={isMobile ? 'column' : 'row'} spacing={2}>
      <Card sx={{ flex: 1 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  bgcolor: 'rgba(33, 111, 255, 0.08)',
                  color: 'primary.main',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <BoltRoundedIcon />
              </Box>
              <Typography variant="h6">Versions</Typography>
            </Stack>
            <Box>
              <Stack direction="row" justifyContent="space-between" py={1}>
                <Typography>Client version</Typography>
                <Typography>{clientVersion}</Typography>
              </Stack>
              <Divider />
              <Stack direction="row" justifyContent="space-between" py={1}>
                <Typography>Server version</Typography>
                <Typography>{serverVersion?.version ?? 'Unknown'}</Typography>
              </Stack>
            </Box>
            {versionError ? (
              <Alert severity="error">{versionError}</Alert>
            ) : null}
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="body2" color="text.secondary">
                Updated: {lastCheckedLabel ?? 'Unknown'}
              </Typography>
              <Button
                variant="text"
                onClick={onRefreshAll}
                startIcon={<RefreshRoundedIcon />}
                size="small"
              >
                Refresh
              </Button>
            </Stack>
            {versionLoading ? (
              <Typography variant="body2" color="text.secondary">
                Loading status…
              </Typography>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ flex: 1 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  bgcolor: 'rgba(38, 166, 91, 0.08)',
                  color: 'success.main',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <InfoOutlinedIcon />
              </Box>
              <Typography variant="h6">Provider Status</Typography>
            </Stack>
            <Stack spacing={1}>
              {summaryRow.map((entry) => (
                <Stack
                  key={entry.provider.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1.5}
                >
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <ProviderIcon provider={entry.provider} />
                    <Box>
                      <Typography variant="body1">
                        {entry.provider.label}
                      </Typography>
                    </Box>
                  </Stack>
                  <Chip
                    variant="outlined"
                    color={
                      entry.chipColor === 'default'
                        ? undefined
                        : entry.chipColor
                    }
                    label={entry.statusLabel}
                    sx={{ fontWeight: 600 }}
                  />
                </Stack>
              ))}
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Button
                variant="text"
                onClick={onCheckLmStudio}
                startIcon={<ActionIcon icon={<RefreshRoundedIcon />} />}
                sx={{ justifyContent: 'flex-start', px: 0 }}
              >
                LM Studio status
              </Button>
              <Button
                variant="text"
                onClick={onProviderAuth}
                startIcon={<ActionIcon icon={<KeyRoundedIcon />} />}
                sx={{ justifyContent: 'flex-start', px: 0 }}
              >
                Provider auth
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ flex: 1 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  bgcolor: 'rgba(64, 102, 214, 0.08)',
                  color: 'primary.main',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AutorenewRoundedIcon />
              </Box>
              <Typography variant="h6">Quick Actions</Typography>
            </Stack>
            <Stack spacing={1}>
              <Button
                variant="text"
                onClick={onRefreshAll}
                startIcon={<ActionIcon icon={<RefreshRoundedIcon />} />}
                sx={{ justifyContent: 'flex-start', px: 0 }}
              >
                Refresh all
              </Button>
              <Button
                variant="text"
                onClick={onCheckLmStudio}
                startIcon={<ActionIcon icon={<MemoryOutlinedIcon />} />}
                sx={{ justifyContent: 'flex-start', px: 0 }}
              >
                LM Studio status
              </Button>
              <Button
                variant="text"
                onClick={onProviderAuth}
                startIcon={<ActionIcon icon={<ManageAccountsOutlinedIcon />} />}
                sx={{ justifyContent: 'flex-start', px: 0 }}
              >
                Provider auth
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

export function HomeProviderStatusSection({
  providerSummaries,
  loading,
  error,
  onProviderAuth,
  onCheckLmStudio,
  onRefresh,
  lastCheckedLabel,
}: {
  providerSummaries: HomeProviderPresentation[];
  loading: boolean;
  error: string | null;
  onProviderAuth: () => void;
  onCheckLmStudio: () => void;
  onRefresh: () => void;
  lastCheckedLabel: string | null;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (isMobile) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography variant="h6">Provider readiness</Typography>
              <Button
                onClick={onRefresh}
                size="small"
                startIcon={<RefreshRoundedIcon />}
              >
                Refresh
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Last checked: {lastCheckedLabel ?? 'Unknown'}
            </Typography>
            {error ? (
              <Alert
                severity="warning"
                data-testid="home-provider-status-error"
              >
                Provider readiness unavailable: {error}
              </Alert>
            ) : null}
            {loading && providerSummaries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Loading provider readiness…
              </Typography>
            ) : null}
            <Stack spacing={1.5}>
              {providerSummaries.map((entry) => (
                <Paper key={entry.provider.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={1.5}>
                    <Stack
                      direction="row"
                      spacing={1.5}
                      alignItems="flex-start"
                    >
                      <ProviderIcon provider={entry.provider} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1">
                          {entry.provider.label}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {entry.details}
                        </Typography>
                      </Box>
                      <Chip
                        variant="outlined"
                        color={
                          entry.chipColor === 'default'
                            ? undefined
                            : entry.chipColor
                        }
                        label={entry.statusLabel}
                        sx={{ fontWeight: 600 }}
                      />
                    </Stack>
                    <Button
                      variant="outlined"
                      onClick={
                        entry.provider.id === 'lmstudio'
                          ? onCheckLmStudio
                          : onProviderAuth
                      }
                      startIcon={<KeyRoundedIcon />}
                      fullWidth
                    >
                      {entry.provider.id === 'lmstudio'
                        ? 'Check status'
                        : 'Logon'}
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography variant="h6">Provider readiness</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                Last checked: {lastCheckedLabel ?? 'Unknown'}
              </Typography>
              <Button
                onClick={onRefresh}
                size="small"
                startIcon={<RefreshRoundedIcon />}
              >
                Refresh
              </Button>
            </Stack>
          </Stack>
          {error ? (
            <Alert severity="warning" data-testid="home-provider-status-error">
              Provider readiness unavailable: {error}
            </Alert>
          ) : null}
          {loading && providerSummaries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Loading provider readiness…
            </Typography>
          ) : null}
          <Table size="small" aria-label="Provider readiness">
            <TableHead>
              <TableRow>
                <TableCell>Provider</TableCell>
                <TableCell>Status (believed)</TableCell>
                <TableCell>Details</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {providerSummaries.map((entry) => (
                <TableRow key={entry.provider.id}>
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <ProviderIcon provider={entry.provider} />
                      <Typography variant="body1">
                        {entry.provider.label}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      variant="outlined"
                      color={
                        entry.chipColor === 'default'
                          ? undefined
                          : entry.chipColor
                      }
                      label={entry.statusLabel}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {entry.details}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      variant="outlined"
                      onClick={
                        entry.provider.id === 'lmstudio'
                          ? onCheckLmStudio
                          : onProviderAuth
                      }
                      startIcon={<KeyRoundedIcon />}
                    >
                      {entry.provider.id === 'lmstudio'
                        ? 'Check status'
                        : 'Logon'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function HomeLmStudioSection({
  status,
  draftBaseUrl,
  onDraftBaseUrlChange,
  onCheckStatus,
  onResetToDefault,
  onRefreshModels,
  models,
  isLoading,
  isEmpty,
  error,
  lastConnectedLabel,
  committedBaseUrl,
  showAllModels,
  onToggleShowAllModels,
}: {
  status: 'idle' | 'loading' | 'success' | 'error';
  draftBaseUrl: string;
  onDraftBaseUrlChange: (next: string) => void;
  onCheckStatus: () => void;
  onResetToDefault: () => void;
  onRefreshModels: () => void;
  models: LmStudioModel[];
  isLoading: boolean;
  isEmpty: boolean;
  error: string | null;
  lastConnectedLabel: string | null;
  committedBaseUrl: string;
  showAllModels: boolean;
  onToggleShowAllModels: () => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const visibleModels = showAllModels ? models : models.slice(0, 5);

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6">LM Studio</Typography>
              <Chip label="Local runtime" variant="outlined" size="small" />
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                color={
                  status === 'success'
                    ? 'success'
                    : status === 'error'
                      ? 'warning'
                      : 'default'
                }
                variant="outlined"
                label={
                  status === 'success'
                    ? 'Connected'
                    : status === 'error'
                      ? 'Needs attention'
                      : 'Unknown'
                }
              />
              <Typography variant="body2" color="text.secondary">
                {formatTime(lastConnectedLabel)}
              </Typography>
            </Stack>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {status === 'loading'
              ? 'Checking…'
              : status === 'error'
                ? (error ?? 'Unable to reach LM Studio')
                : status === 'success'
                  ? `Connected to ${committedBaseUrl} (${models.length} model${
                      models.length === 1 ? '' : 's'
                    })`
                  : 'Idle'}
          </Typography>
          <Stack
            spacing={1}
            direction={isMobile ? 'column' : 'row'}
            alignItems={isMobile ? 'stretch' : 'center'}
          >
            <TextField
              label="Base URL"
              value={draftBaseUrl}
              onChange={(event) => onDraftBaseUrlChange(event.target.value)}
              size="small"
              fullWidth
            />
            <Button
              variant="outlined"
              onClick={onCheckStatus}
              disabled={isLoading}
              startIcon={<BoltRoundedIcon />}
            >
              Check
            </Button>
            <Button
              variant="outlined"
              onClick={onResetToDefault}
              disabled={isLoading}
              startIcon={<RefreshRoundedIcon />}
            >
              Reset
            </Button>
            <Button
              variant="outlined"
              onClick={onRefreshModels}
              disabled={isLoading}
              startIcon={<AutorenewRoundedIcon />}
            >
              Refresh models
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Using base URL:{' '}
            {status === 'success' ? committedBaseUrl : draftBaseUrl}
          </Typography>
          {isEmpty ? (
            <Typography>No models reported by LM Studio.</Typography>
          ) : null}
          {status === 'error' && error ? (
            <Alert severity="error">{error}</Alert>
          ) : null}
          {models.length > 0 ? (
            isMobile ? (
              <Stack spacing={1} role="list">
                {visibleModels.map((model) => (
                  <Paper
                    key={model.modelKey}
                    role="listitem"
                    variant="outlined"
                    sx={{ p: 2 }}
                  >
                    <Stack spacing={0.5}>
                      <Typography
                        variant="subtitle1"
                        noWrap
                        title={model.displayName}
                      >
                        {model.displayName}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        noWrap
                        title={model.modelKey}
                      >
                        {model.modelKey}
                      </Typography>
                      <Typography variant="body2">
                        {model.type}
                        {model.format ? ` / ${model.format}` : ''}
                      </Typography>
                      <Typography variant="body2">
                        {model.architecture ?? '-'}
                      </Typography>
                      <Typography variant="body2">
                        Size: {humanSize(model.sizeBytes)}
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            ) : (
              <Paper variant="outlined">
                <Table size="small" aria-label="LM Studio models">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Key</TableCell>
                      <TableCell>Type / Format</TableCell>
                      <TableCell>Architecture</TableCell>
                      <TableCell align="right">Size</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleModels.map((model) => (
                      <TableRow key={model.modelKey}>
                        <TableCell>{model.displayName}</TableCell>
                        <TableCell>{model.modelKey}</TableCell>
                        <TableCell>
                          {model.type}
                          {model.format ? ` / ${model.format}` : ''}
                        </TableCell>
                        <TableCell>{model.architecture ?? '-'}</TableCell>
                        <TableCell align="right">
                          {humanSize(model.sizeBytes)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )
          ) : null}
          {models.length > 5 ? (
            <Button
              variant="text"
              onClick={onToggleShowAllModels}
              sx={{ alignSelf: 'flex-start' }}
            >
              {showAllModels
                ? 'Show fewer models'
                : `Show all ${models.length} models`}
              <ChevronRightIcon
                fontSize="small"
                sx={{ transform: showAllModels ? 'rotate(180deg)' : 'none' }}
              />
            </Button>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
