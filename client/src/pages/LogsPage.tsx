import type { LogEntry } from '@codeinfo2/common';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import useLogs from '../hooks/useLogs';
import { createLogger } from '../logging';

const levelOptions: LogEntry['level'][] = ['error', 'warn', 'info', 'debug'];
const sourceOptions: LogEntry['source'][] = ['server', 'client'];

function formatTimestamp(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

function LevelChip({ level }: { level: LogEntry['level'] }) {
  const color =
    level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'primary';
  return <Chip size="small" color={color} label={level.toUpperCase()} />;
}

export default function LogsPage() {
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));
  const [text, setText] = useState('');
  const [levelFilters, setLevelFilters] = useState<string[]>([]);
  const [sourceFilters, setSourceFilters] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const logger = useMemo(() => createLogger('client'), []);
  const apiBase =
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta).env?.VITE_API_URL) ??
    'http://localhost:5010';
  const { logs, loading, error, refreshQuery } = useLogs(
    { level: levelFilters, source: sourceFilters, text },
    live,
  );

  const toggleFilter = (
    value: string,
    current: string[],
    set: (next: string[]) => void,
  ) => {
    set(
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
  };

  const handleSampleLog = async () => {
    const timestamp = new Date().toISOString();
    const context = { route: '/logs', demo: true, generatedAt: timestamp };

    logger('info', 'sample log', { feature: 'logs', ...context });

    try {
      await fetch(new URL('/logs', apiBase).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          level: 'info',
          message: 'sample log',
          timestamp,
          source: 'client',
          route: '/logs',
          context,
        }),
      });
      refreshQuery();
    } catch (postError) {
      console.error(postError);
    }
  };

  const handleRefresh = () => {
    refreshQuery();
  };

  const empty = !loading && !logs.length;

  const renderContext = (entry: LogEntry) => {
    const fields: Record<string, unknown> = {
      route: entry.route,
      requestId: entry.requestId,
      correlationId: entry.correlationId,
      ...entry.context,
    };
    const filtered = Object.entries(fields).filter(
      ([, value]) => value !== undefined,
    );
    if (!filtered.length) return null;
    return (
      <Typography
        component="div"
        variant="body2"
        sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
      >
        {JSON.stringify(Object.fromEntries(filtered))}
      </Typography>
    );
  };

  const tableRows = logs.map((log) => (
    <Box
      key={log.sequence ?? log.timestamp}
      component="tr"
      sx={{ '& td': { borderBottomColor: 'divider' } }}
    >
      <Box component="td" sx={{ py: 1, pr: 2 }}>
        <Typography variant="body2">
          {formatTimestamp(log.timestamp)}
        </Typography>
      </Box>
      <Box component="td" sx={{ py: 1, pr: 2 }}>
        <LevelChip level={log.level} />
      </Box>
      <Box component="td" sx={{ py: 1, pr: 2 }}>
        <Chip label={log.source} size="small" variant="outlined" />
      </Box>
      <Box component="td" sx={{ py: 1, pr: 2 }}>
        <Typography variant="body2" noWrap title={log.message}>
          {log.message}
        </Typography>
      </Box>
      <Box component="td" sx={{ py: 1 }}>
        {renderContext(log)}
      </Box>
    </Box>
  ));

  const cards = logs.map((log) => (
    <Card key={log.sequence ?? log.timestamp} variant="outlined">
      <CardContent sx={{ display: 'grid', gap: 0.5 }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="space-between"
        >
          <LevelChip level={log.level} />
          <Chip size="small" label={log.source} variant="outlined" />
        </Stack>
        <Typography variant="subtitle2">
          {formatTimestamp(log.timestamp)}
        </Typography>
        <Typography variant="body1">{log.message}</Typography>
        {renderContext(log)}
      </CardContent>
    </Card>
  ));

  return (
    <Container maxWidth="lg" sx={{ pb: 4 }}>
      <Stack spacing={3} sx={{ mt: 0 }}>
        <Stack spacing={1}>
          <Typography variant="h4">Logs</Typography>
          <Typography variant="body2" color="text.secondary">
            Live feed of client and server events with filters, manual refresh,
            and a sample emitter to verify end-to-end logging.
          </Typography>
        </Stack>

        <Stack
          spacing={1}
          direction={isSmall ? 'column' : 'row'}
          alignItems={isSmall ? 'stretch' : 'center'}
          divider={isSmall ? <Divider flexItem /> : undefined}
        >
          <TextField
            label="Search text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            size="small"
            fullWidth={isSmall}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {levelOptions.map((lvl) => (
              <Chip
                key={lvl}
                label={lvl.toUpperCase()}
                color={levelFilters.includes(lvl) ? 'primary' : 'default'}
                variant={levelFilters.includes(lvl) ? 'filled' : 'outlined'}
                onClick={() => toggleFilter(lvl, levelFilters, setLevelFilters)}
              />
            ))}
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {sourceOptions.map((src) => (
              <Chip
                key={src}
                label={src}
                color={sourceFilters.includes(src) ? 'secondary' : 'default'}
                variant={sourceFilters.includes(src) ? 'filled' : 'outlined'}
                onClick={() =>
                  toggleFilter(src, sourceFilters, setSourceFilters)
                }
              />
            ))}
          </Stack>
          <FormControlLabel
            control={
              <Switch
                checked={live}
                onChange={(e) => setLive(e.target.checked)}
              />
            }
            label="Live"
          />
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="outlined"
              onClick={handleRefresh}
              disabled={loading}
            >
              Refresh now
            </Button>
            <Button
              variant="contained"
              onClick={handleSampleLog}
              color="secondary"
            >
              Send sample log
            </Button>
          </Stack>
        </Stack>

        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}

        {loading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={20} />
            <Typography>Loading logs…</Typography>
          </Stack>
        )}

        {empty && !loading && (
          <Typography>No logs yet. Emit one with “Send sample log”.</Typography>
        )}

        {!empty && (
          <Box>
            {isSmall ? (
              <Stack spacing={1}>{cards}</Stack>
            ) : (
              <Box
                component="table"
                sx={{ width: '100%', borderCollapse: 'collapse' }}
                aria-label="Logs table"
              >
                <Box component="thead">
                  <Box
                    component="tr"
                    sx={{
                      '& th': {
                        textAlign: 'left',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        py: 1,
                        pr: 2,
                      },
                    }}
                  >
                    <Box component="th">Time</Box>
                    <Box component="th">Level</Box>
                    <Box component="th">Source</Box>
                    <Box component="th">Message</Box>
                    <Box component="th">Context</Box>
                  </Box>
                </Box>
                <Box component="tbody">{tableRows}</Box>
              </Box>
            )}
          </Box>
        )}
      </Stack>
    </Container>
  );
}
