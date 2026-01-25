import { jest } from '@jest/globals';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

const { postCodexDeviceAuth } = await import('../api/codex');

describe('Codex device-auth API helper', () => {
  it('returns parsed data on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        target: 'chat',
        verificationUrl: 'https://example.com/device',
        userCode: 'ABCD-EFGH',
        expiresInSec: 300,
      }),
    } as unknown as Response);

    await expect(postCodexDeviceAuth({ target: 'chat' })).resolves.toEqual({
      status: 'completed',
      target: 'chat',
      verificationUrl: 'https://example.com/device',
      userCode: 'ABCD-EFGH',
      expiresInSec: 300,
      agentName: undefined,
    });
  });

  it('throws structured error for non-200 responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'invalid_request',
        message: 'target is required',
      }),
    } as unknown as Response);

    await expect(postCodexDeviceAuth({ target: 'chat' })).rejects.toMatchObject(
      {
        status: 400,
        message: 'target is required',
      },
    );
  });

  it('uses reason when provided by the API', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'codex_unavailable',
        reason: 'codex missing',
      }),
    } as unknown as Response);

    await expect(postCodexDeviceAuth({ target: 'chat' })).rejects.toMatchObject(
      {
        status: 503,
        message: 'codex missing',
      },
    );
  });
});
