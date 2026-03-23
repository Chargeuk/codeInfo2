import { jest } from '@jest/globals';
import {
  createProviderAuthFixture,
  getFetchMock,
  installProviderAuthFetchFixtures,
  mockJsonResponse,
} from './support/fetchMock';

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

const { postCodexDeviceAuth, postProviderDeviceAuth } = await import(
  '../api/codex'
);

describe('Provider device-auth API helper', () => {
  it('keeps the Codex request body as a strict empty object', async () => {
    installProviderAuthFetchFixtures({
      mockFetch,
      fixtures: [
        createProviderAuthFixture({
          provider: 'codex',
          state: 'verification_ready',
        }),
      ],
    });

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

  it('accepts a Copilot verification-ready response through the generalized helper', async () => {
    installProviderAuthFetchFixtures({
      mockFetch,
      fixtures: [
        createProviderAuthFixture({
          provider: 'copilot',
          state: 'verification_ready',
          payload: {
            verificationUrl: 'https://github.com/login/device',
            userCode: 'COPILOT-CODE',
          },
        }),
      ],
    });

    await expect(postProviderDeviceAuth('copilot')).resolves.toEqual({
      provider: 'copilot',
      state: 'verification_ready',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'COPILOT-CODE',
      displayOutput:
        'Open https://github.com/login/device and enter COPILOT-CODE.',
    });
  });

  it('preserves unavailable-before-start states as shared structured responses', async () => {
    installProviderAuthFetchFixtures({
      mockFetch,
      fixtures: [
        createProviderAuthFixture({
          provider: 'copilot',
          state: 'unavailable_before_start',
          payload: { reason: 'GitHub login required' },
        }),
      ],
    });

    await expect(postProviderDeviceAuth('copilot')).resolves.toEqual({
      provider: 'copilot',
      state: 'unavailable_before_start',
      reason: 'GitHub login required',
    });
  });

  it('preserves failed states as shared structured responses instead of forcing Codex-only handling', async () => {
    installProviderAuthFetchFixtures({
      mockFetch,
      fixtures: [
        createProviderAuthFixture({
          provider: 'copilot',
          state: 'failed',
          payload: { reason: 'copilot auth failed' },
        }),
      ],
    });

    await expect(postProviderDeviceAuth('copilot')).resolves.toEqual({
      provider: 'copilot',
      state: 'failed',
      reason: 'copilot auth failed',
      displayOutput: 'copilot auth failed',
    });
  });

  it('still parses deterministic invalid_request responses for the Codex route', async () => {
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

  it('emits success logs for a provider-aware response', async () => {
    installProviderAuthFetchFixtures({
      mockFetch,
      fixtures: [
        createProviderAuthFixture({
          provider: 'copilot',
          state: 'verification_ready',
        }),
      ],
    });

    await postProviderDeviceAuth('copilot');

    expect(logSpy).toHaveBeenCalledWith(
      'info',
      '[DEV-0000037][T14] event=client_device_auth_contract_consumed result=success',
      expect.objectContaining({
        provider: 'copilot',
        responseState: 'verification_ready',
        status: 200,
      }),
    );
  });
});
