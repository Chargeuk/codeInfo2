import { jest } from '@jest/globals';
import { getFetchMock, mockJsonResponse } from './support/fetchMock';

const mockFetch = getFetchMock();
const logSpy = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
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
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        provider: 'codex',
        state: 'verification_ready',
        verificationUrl: 'https://example.com/device',
        userCode: 'ABCD-EFGH',
        displayOutput:
          'Open https://example.com/device and enter code ABCD-EFGH.',
      }),
    );

    await postCodexDeviceAuth();

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
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        provider: 'codex',
        state: 'verification_ready',
        verificationUrl: 'https://example.com/device',
        userCode: 'ABCD-EFGH',
        displayOutput:
          'Open https://example.com/device and enter code ABCD-EFGH.',
      }),
    );

    await expect(postCodexDeviceAuth()).resolves.toEqual({
      provider: 'codex',
      state: 'verification_ready',
      verificationUrl: 'https://example.com/device',
      userCode: 'ABCD-EFGH',
      displayOutput:
        'Open https://example.com/device and enter code ABCD-EFGH.',
    });
  });

  it('parses deterministic 400 invalid_request response', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'invalid_request',
          message: 'request body must be an empty JSON object',
        },
        { status: 400 },
      ),
    );

    await expect(postCodexDeviceAuth()).rejects.toMatchObject({
      status: 400,
      message: 'request body must be an empty JSON object',
      error: 'invalid_request',
    });
  });

  it('parses deterministic 200 unavailable-before-start response', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          provider: 'codex',
          state: 'unavailable_before_start',
          reason: 'codex missing',
        },
        { status: 200 },
      ),
    );

    await expect(postCodexDeviceAuth()).resolves.toEqual({
      provider: 'codex',
      state: 'unavailable_before_start',
      reason: 'codex missing',
    });
  });

  it('emits deterministic T14 success log for valid contract consumption', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        provider: 'codex',
        state: 'verification_ready',
        verificationUrl: 'https://example.com/device',
        userCode: 'ABCD-EFGH',
        displayOutput:
          'Open https://example.com/device and enter code ABCD-EFGH.',
      }),
    );

    await postCodexDeviceAuth();

    expect(logSpy).toHaveBeenCalledWith(
      'info',
      '[DEV-0000037][T14] event=client_device_auth_contract_consumed result=success',
      expect.objectContaining({
        status: 200,
        responseState: 'verification_ready',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'info',
      '[DEV-0000037][T26] event=codex_device_auth_api_signature_aligned result=success',
      expect.objectContaining({
        status: 200,
        responseState: 'verification_ready',
      }),
    );
  });

  it('emits deterministic T14 error log for invalid_request path', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'invalid_request',
          message: 'request body must be an empty JSON object',
        },
        { status: 400 },
      ),
    );

    await expect(postCodexDeviceAuth()).rejects.toBeDefined();

    expect(logSpy).toHaveBeenCalledWith(
      'error',
      '[DEV-0000037][T14] event=client_device_auth_contract_consumed result=error',
      expect.objectContaining({
        status: 400,
        error: 'invalid_request',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      'error',
      '[DEV-0000037][T26] event=codex_device_auth_api_signature_aligned result=error',
      expect.objectContaining({
        status: 400,
        error: 'invalid_request',
      }),
    );
  });
});
