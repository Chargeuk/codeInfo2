import { fetchServerVersion, VersionInfo } from '@codeinfo2/common';
import { Alert, Box, Card, CardContent, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import pkg from '../../package.json';
import { getApiBaseUrl } from '../api/baseUrl';
import { getApiBaseUrlBlockingIssueMessage } from '../config/runtimeConfig';
import { createLogger } from '../logging';

export default function HomePage() {
  const [serverVersion, setServerVersion] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const clientVersion = pkg.version;
  const logger = useMemo(() => createLogger('client-home'), []);
  const apiUrl = getApiBaseUrl();
  const apiBaseUrlBlockingIssueMessage = getApiBaseUrlBlockingIssueMessage();

  useEffect(() => {
    if (apiBaseUrlBlockingIssueMessage) {
      setServerVersion(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchServerVersion(apiUrl);
        if (!cancelled) setServerVersion(data);
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        if (!cancelled) {
          setError(message);
          logger('error', 'version fetch failed', { error: message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrlBlockingIssueMessage, apiUrl, logger]);

  return (
    <Box sx={{ mt: 0, maxWidth: 540, width: '100%' }}>
      {apiBaseUrlBlockingIssueMessage && (
        <Alert
          severity="error"
          data-testid="runtime-config-api-base-url-home-banner"
          sx={{ mb: 2 }}
        >
          {apiBaseUrlBlockingIssueMessage}
        </Alert>
      )}
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
