import type { ChatProviderInfo } from '@codeinfo2/common';

export type HomeProviderPresentation = {
  provider: ChatProviderInfo;
  statusLabel: string;
  details: string;
  chipColor: 'success' | 'warning' | 'default' | 'info';
};

function getProviderPresentation(
  provider: ChatProviderInfo,
): HomeProviderPresentation {
  const lowerReason = provider.reason?.toLowerCase() ?? '';
  if (provider.id === 'lmstudio') {
    return provider.available
      ? {
          provider,
          statusLabel: 'No login required',
          details: 'Local runtime • No authentication needed',
          chipColor: 'default',
        }
      : {
          provider,
          statusLabel: 'Unavailable',
          details: provider.reason ?? 'Local runtime unavailable',
          chipColor: 'warning',
        };
  }

  if (!provider.available) {
    const authRequired = /auth|login/.test(lowerReason);
    return {
      provider,
      statusLabel: authRequired ? 'Authentication required' : 'Unavailable',
      details:
        provider.reason ??
        (authRequired
          ? 'Logon required to use this provider.'
          : 'Provider unavailable'),
      chipColor: 'warning',
    };
  }

  return {
    provider,
    statusLabel: 'Available',
    details:
      provider.id === 'codex'
        ? 'CLI and auth prerequisites are satisfied.'
        : 'Authenticated and ready for use.',
    chipColor: 'success',
  };
}

export function createHomeProviderSummaries(
  providers: ChatProviderInfo[],
): HomeProviderPresentation[] {
  return providers.map((provider) => getProviderPresentation(provider));
}
