import { VersionInfo, getAppInfo } from '@codeinfo2/common';
import {
  Container,
  Card,
  Typography,
  Stack,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useEffect, useState } from 'react';
import pkg from '../package.json';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5010';

function App() {
  const [serverInfo, setServerInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${apiUrl}/version`);
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = (await res.json()) as VersionInfo;
        if (!cancelled) {
          setServerInfo(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const clientInfo = getAppInfo('client', pkg.version);

  return (
    <Container maxWidth="sm" sx={{ paddingY: 4 }}>
      <Card sx={{ padding: 3, boxShadow: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h4" gutterBottom>
            CodeInfo2 Versions
          </Typography>
          <Divider />
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" color="text.secondary">
              Client version
            </Typography>
            <Typography variant="h6">{clientInfo.version}</Typography>
          </Stack>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" color="text.secondary">
              Server version
            </Typography>
            {loading ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2">Loading…</Typography>
              </Stack>
            ) : error ? (
              <Alert severity="error" variant="outlined">
                {error}
              </Alert>
            ) : (
              <Typography variant="h6">
                {serverInfo?.version ?? 'unknown'}
              </Typography>
            )}
          </Stack>
          <Divider />
          <Typography variant="body2" color="text.secondary">
            API base: {apiUrl}
          </Typography>
        </Stack>
      </Card>
    </Container>
  );
}

export default App;
