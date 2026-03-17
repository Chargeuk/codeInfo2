import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const expectedApiBase =
  process.env.E2E_API_URL ?? 'http://host.docker.internal:6010';
const expectedLmStudioBase =
  process.env.VITE_CODEINFO_LMSTUDIO_URL ?? 'http://host.docker.internal:1234';

test('runtime config marker matches injected client config', async ({ page }) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }

  const markerPromise = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'info' &&
      message.text().includes('DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG'),
  });

  await page.goto(baseUrl);

  const marker = await markerPromise;
  const markerArgs = await Promise.all(marker.args().map((arg) => arg.jsonValue()));
  const markerPayload = markerArgs[1] as Record<string, unknown>;

  const runtimeConfig = (await page.evaluate(() => {
    return (
      (window as typeof window & {
        __CODEINFO_CONFIG__?: Record<string, unknown>;
      }).__CODEINFO_CONFIG__ ?? {}
    );
  })) as Record<string, unknown>;

  expect(runtimeConfig.apiBaseUrl).toBe(expectedApiBase);
  expect(runtimeConfig.lmStudioBaseUrl).toBe(expectedLmStudioBase);
  expect(runtimeConfig.logForwardEnabled).toBe(true);
  expect(runtimeConfig.logMaxBytes).toBe(32768);

  expect(markerPayload.apiBaseUrl).toBe(expectedApiBase);
  expect(markerPayload.apiBaseUrlSource).toBe('runtime');
  expect(markerPayload.lmStudioBaseUrl).toBe(expectedLmStudioBase);
  expect(markerPayload.lmStudioBaseUrlSource).toBe('runtime');
  expect(markerPayload.logForwardEnabled).toBe(true);
  expect(markerPayload.logForwardEnabledSource).toBe('runtime');
  expect(markerPayload.logMaxBytes).toBe(32768);
  expect(markerPayload.logMaxBytesSource).toBe('runtime');
  expect(markerPayload.hasInvalidCanonicalConfig).toBe(false);
});

test('runtime config marker surfaces object-like malformed runtime containers before env fallback wins', async ({
  page,
}) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }

  await page.route('**/config.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: "window.__CODEINFO_CONFIG__ = new Date('2026-03-17T00:00:00.000Z');",
    });
  });

  const markerPromise = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'info' &&
      message.text().includes('DEV_0000048_T8_VITE_CODEINFO_RUNTIME_CONFIG'),
  });

  await page.goto(baseUrl);

  const marker = await markerPromise;
  const markerArgs = await Promise.all(marker.args().map((arg) => arg.jsonValue()));
  const markerPayload = markerArgs[1] as Record<string, unknown>;

  expect(markerPayload.apiBaseUrl).toBe(expectedApiBase);
  expect(markerPayload.apiBaseUrlSource).toBe('env');
  expect(markerPayload.lmStudioBaseUrl).toBe(expectedLmStudioBase);
  expect(markerPayload.lmStudioBaseUrlSource).toBe('env');
  expect(markerPayload.logForwardEnabled).toBe(true);
  expect(markerPayload.logForwardEnabledSource).toBe('env');
  expect(markerPayload.logMaxBytes).toBe(32768);
  expect(markerPayload.logMaxBytesSource).toBe('env');
  expect(markerPayload.hasInvalidCanonicalConfig).toBe(true);
  expect(markerPayload.diagnostics).toEqual([
    {
      container: '__CODEINFO_CONFIG__',
      source: 'runtime',
      rawValue: '"2026-03-17T00:00:00.000Z"',
      reason: 'invalid_container',
    },
  ]);
});
