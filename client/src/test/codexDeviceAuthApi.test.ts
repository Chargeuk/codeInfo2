import { jest } from '@jest/globals';

const mockFetch = jest.fn();
const logSpy = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  logSpy.mockReset();
});

await jest.unstable_mockModule('../logging/logger', async () => ({
  __esModule: true,
  createLogger: jest.fn(() => logSpy),
}));

const { postCodexDeviceAuth } = await import('../api/codex');

describe('Codex device-auth API helper', () => {
  it('serializes request body as strict empty object', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
      }),
    } as unknown as Response);

    await postCodexDeviceAuth({});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
  });

  it('parses strict 200 success shape', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
      }),
    } as unknown as Response);

    await expect(postCodexDeviceAuth({})).resolves.toEqual({
      status: 'ok',
      rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
    });
  });

  it('parses deterministic 400 invalid_request response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'invalid_request',
        message: 'request body must be an empty JSON object',
      }),
    } as unknown as Response);

    await expect(postCodexDeviceAuth({})).rejects.toMatchObject({
      status: 400,
      message: 'request body must be an empty JSON object',
      error: 'invalid_request',
    });
  });

  it('parses deterministic 503 codex_unavailable response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'codex_unavailable',
        reason: 'codex missing',
      }),
    } as unknown as Response);

    await expect(postCodexDeviceAuth({})).rejects.toMatchObject({
      status: 503,
      message: 'codex missing',
      error: 'codex_unavailable',
    });
  });

  it('emits deterministic T14 success log for valid contract consumption', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        rawOutput: 'Open https://example.com/device and enter code ABCD-EFGH.',
      }),
    } as unknown as Response);

    await postCodexDeviceAuth({});

    expect(logSpy).toHaveBeenCalledWith(
      'info',
      '[DEV-0000037][T14] event=client_device_auth_contract_consumed result=success',
      expect.objectContaining({
        status: 200,
        responseStatus: 'ok',
      }),
    );
  });

  it('emits deterministic T14 error log for invalid_request path', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({
        error: 'invalid_request',
        message: 'request body must be an empty JSON object',
      }),
    } as unknown as Response);

    await expect(postCodexDeviceAuth({})).rejects.toBeDefined();

    expect(logSpy).toHaveBeenCalledWith(
      'error',
      '[DEV-0000037][T14] event=client_device_auth_contract_consumed result=error',
      expect.objectContaining({
        status: 400,
        error: 'invalid_request',
      }),
    );
  });
});
