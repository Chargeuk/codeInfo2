import { jest } from '@jest/globals';

import {
  createProviderAuthFixture,
  getFetchMock,
  installProviderAuthFetchFixtures,
} from './support/fetchMock';

const mockFetch = getFetchMock();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe('provider auth fixtures', () => {
  it('returns reusable verification-ready fixture payloads', async () => {
    const logSpy = jest.fn();
    installProviderAuthFetchFixtures({
      mockFetch,
      fixtures: [
        createProviderAuthFixture({
          provider: 'copilot',
          state: 'verification_ready',
          payload: {
            verificationUrl: 'https://github.com/login/device',
            userCode: 'COP-READY',
            displayOutput:
              'Open https://github.com/login/device and enter COP-READY.',
          },
        }),
      ],
      log: logSpy,
    });

    const response = await fetch('http://localhost/copilot/device-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    await expect(response.json()).resolves.toEqual({
      provider: 'copilot',
      state: 'verification_ready',
      verificationUrl: 'https://github.com/login/device',
      userCode: 'COP-READY',
      displayOutput:
        'Open https://github.com/login/device and enter COP-READY.',
    });
    expect(logSpy).toHaveBeenCalledWith(
      'info',
      'story.0000051.task10.client_auth_fixture_applied',
      {
        fixture: 'copilot:verification_ready',
        provider: 'copilot',
      },
    );
  });

  it('returns already-authenticated fixtures without legacy raw fields', () => {
    const fixture = createProviderAuthFixture({
      provider: 'codex',
      state: 'already_authenticated',
    });

    expect(fixture.payload).toEqual({
      provider: 'codex',
      state: 'already_authenticated',
    });
    expect('displayOutput' in fixture.payload).toBe(false);
    expect('rawOutput' in (fixture.payload as Record<string, unknown>)).toBe(
      false,
    );
  });

  it('returns failure fixtures without serialization issues', async () => {
    installProviderAuthFetchFixtures({
      mockFetch,
      fixtures: [
        createProviderAuthFixture({
          provider: 'copilot',
          state: 'failed',
          payload: {
            reason: 'copilot login failed',
            displayOutput: 'copilot login failed',
          },
        }),
      ],
    });

    const response = await fetch('http://localhost/copilot/device-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    await expect(response.json()).resolves.toEqual({
      provider: 'copilot',
      state: 'failed',
      reason: 'copilot login failed',
      displayOutput: 'copilot login failed',
    });
  });
});
