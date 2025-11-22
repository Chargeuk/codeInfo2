import { fetchServerVersion, VersionInfo } from '@codeinfo2/common';
import { Box, Card, CardContent, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import pkg from '../../package.json';

export default function HomePage() {
  const [serverVersion, setServerVersion] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const clientVersion = pkg.version;
  const apiUrl =
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta)?.env?.VITE_API_URL) ??
    'http://localhost:5010';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchServerVersion(apiUrl);
        if (!cancelled) setServerVersion(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  return (
    <Box sx={{ mt: 0, maxWidth: 540, width: '100%' }}>
      <Card>
        <CardContent>
          <Typography variant="h4" gutterBottom>
            CodeInfo2 Versions
          </Typography>
          {loading && <Typography>Loading…</Typography>}
          {error && <Typography color="error">{error}</Typography>}
          {!loading && !error && (
            <>
              <Typography>Client version: {clientVersion}</Typography>
              <Typography>Server version: {serverVersion?.version}</Typography>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
