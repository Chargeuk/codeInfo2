import type { ChatProviderInfo } from '@codeinfo2/common';
import { createHomeProviderSummaries } from '../components/home/homePageData';

function buildProvider(
  overrides: Partial<ChatProviderInfo> & Pick<ChatProviderInfo, 'id' | 'label'>,
): ChatProviderInfo {
  return {
    id: overrides.id,
    label: overrides.label,
    available: overrides.available ?? false,
    toolsAvailable: overrides.toolsAvailable ?? false,
    endpointOnly: overrides.endpointOnly ?? false,
    reason: overrides.reason,
    defaultModel: overrides.defaultModel,
    defaultModelSource: overrides.defaultModelSource,
    warnings: overrides.warnings ?? [],
    agentFlags: overrides.agentFlags ?? [],
    compatibility: overrides.compatibility,
  };
}

describe('createHomeProviderSummaries', () => {
  it('maps authenticated harnesses to Available', () => {
    const [summary] = createHomeProviderSummaries([
      buildProvider({
        id: 'copilot',
        label: 'GitHub Copilot',
        available: true,
        toolsAvailable: true,
      }),
    ]);

    expect(summary.statusLabel).toBe('Available');
    expect(summary.details).toBe('Authenticated and ready for use.');
    expect(summary.chipColor).toBe('success');
  });

  it('maps endpoint-only unauthenticated harnesses to Local Only', () => {
    const [summary] = createHomeProviderSummaries([
      buildProvider({
        id: 'codex',
        label: 'OpenAI Codex',
        available: true,
        toolsAvailable: true,
        endpointOnly: true,
        warnings: ['Server warning copy can change without breaking the UI.'],
      }),
    ]);

    expect(summary.statusLabel).toBe('Local Only');
    expect(summary.details).toBe(
      'Unauthenticated, local models are available',
    );
    expect(summary.chipColor).toBe('warning');
  });

  it('maps unavailable unauthenticated harnesses to Unavailable', () => {
    const [summary] = createHomeProviderSummaries([
      buildProvider({
        id: 'copilot',
        label: 'GitHub Copilot',
        available: false,
        toolsAvailable: false,
        reason: 'copilot authentication required',
      }),
    ]);

    expect(summary.statusLabel).toBe('Unavailable');
    expect(summary.details).toBe('copilot authentication required');
    expect(summary.chipColor).toBe('error');
  });
});
