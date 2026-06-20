import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import test, { afterEach, mock } from 'node:test';
import {
  readWebPage,
  webSearch,
} from '../../webTools/toolService.js';

afterEach(() => {
  mock.restoreAll();
});

test('webSearch normalizes duck-duck-scrape results into CodeInfo payloads', async () => {
  const result = await webSearch(
    {
      query: 'react compiler docs',
      maxResults: 2,
    },
    {
      duckDuckSearchImpl: async () => ({
        noResults: false,
        vqd: 'demo',
        results: [
          {
            hostname: 'react.dev',
            url: 'https://react.dev/reference/react/compiler',
            title: 'React &amp; Compiler',
            description: 'Official <b>compiler</b> docs',
            rawDescription: 'Official compiler docs',
            icon: '',
          },
        ],
      }),
    },
  );

  assert.equal(result.provider, 'duck-duck-scrape');
  assert.equal(result.results[0]?.title, 'React & Compiler');
  assert.equal(result.results[0]?.snippet, 'Official compiler docs');
});

test('webSearch drops non-http result URLs from the primary DuckDuckGo path and keeps noResults consistent', async () => {
  const result = await webSearch(
    {
      query: 'filtered results',
      maxResults: 5,
    },
    {
      duckDuckSearchImpl: async () => ({
        noResults: false,
        vqd: 'demo',
        results: [
          {
            hostname: 'bad.example',
            url: 'javascript:alert(1)',
            title: 'Bad result',
            description: 'Should be dropped',
            rawDescription: 'Should be dropped',
            icon: '',
          },
          {
            hostname: 'good.example',
            url: 'https://example.com/good',
            title: 'Good &amp; result',
            description: 'Kept result',
            rawDescription: 'Kept result',
            icon: '',
          },
        ],
      }),
    },
  );

  assert.equal(result.noResults, false);
  assert.deepEqual(
    result.results.map((entry) => entry.url),
    ['https://example.com/good'],
  );
  assert.equal(result.results[0]?.title, 'Good & result');
});

test('webSearch reports noResults when primary DuckDuckGo results are all filtered out', async () => {
  const result = await webSearch(
    {
      query: 'all filtered',
      maxResults: 5,
    },
    {
      duckDuckSearchImpl: async () => ({
        noResults: false,
        vqd: 'demo',
        results: [
          {
            hostname: 'bad.example',
            url: 'file:///etc/passwd',
            title: 'Bad result',
            description: 'Should be dropped',
            rawDescription: 'Should be dropped',
            icon: '',
          },
        ],
      }),
    },
  );

  assert.equal(result.noResults, true);
  assert.deepEqual(result.results, []);
});

test('webSearch falls back to DuckDuckGo HTML scraping when duck-duck-scrape is blocked', async () => {
  let fallbackUrl: URL | undefined;
  const result = await webSearch(
    {
      query: 'OpenAI latest news',
      maxResults: 2,
      safeSearch: 'strict',
    },
    {
      duckDuckSearchImpl: async () => {
        throw new Error(
          'DDG detected an anomaly in the request, you are likely making requests too quickly.',
        );
      },
      fetchImpl: async (input) => {
        fallbackUrl = new URL(String(input));
        return (
        new Response(
          [
            '<html><body>',
            '<div class="results">',
            '<div class="result">',
            '<h2 class="result__title"><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fnews%2F">OpenAI News</a></h2>',
            '<a class="result__snippet">Latest updates from OpenAI.</a>',
            '</div>',
            '</div>',
            '</body></html>',
          ].join(''),
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        )
        );
      },
    },
  );

  assert.equal(result.provider, 'duckduckgo-html');
  assert.equal(result.results[0]?.url, 'https://openai.com/news/');
  assert.equal(result.results[0]?.hostname, 'openai.com');
  assert.equal(result.results[0]?.snippet, 'Latest updates from OpenAI.');
  assert.equal(fallbackUrl?.searchParams.get('kp'), '1');
});

test('webSearch HTML fallback drops malformed and non-http result URLs', async () => {
  const result = await webSearch(
    {
      query: 'OpenAI latest news',
      maxResults: 5,
    },
    {
      duckDuckSearchImpl: async () => {
        throw new Error('primary path unavailable');
      },
      fetchImpl: async () =>
        new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<h2 class="result__title"><a href="javascript:alert(1)">Bad One</a></h2>',
            '<a class="result__snippet">Dropped.</a>',
            '</div>',
            '<div class="result">',
            '<h2 class="result__title"><a href="file:///etc/passwd">Bad Two</a></h2>',
            '<a class="result__snippet">Dropped too.</a>',
            '</div>',
            '<div class="result">',
            '<h2 class="result__title"><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopenai.com%2Fnews%2F">OpenAI News</a></h2>',
            '<a class="result__snippet">Latest updates from OpenAI.</a>',
            '</div>',
            '</body></html>',
          ].join(''),
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        ),
    },
  );

  assert.equal(result.provider, 'duckduckgo-html');
  assert.deepEqual(
    result.results.map((entry) => entry.url),
    ['https://openai.com/news/'],
  );
  assert.equal(result.noResults, false);
});

test('webSearch aborts the DuckDuckGo HTML fallback when it exceeds the timeout', async () => {
  await assert.rejects(
    () =>
      webSearch(
        {
          query: 'slow fallback',
        },
        {
          duckDuckSearchImpl: async () => {
            throw new Error('primary search unavailable');
          },
          duckDuckGoHtmlTimeoutMs: 10,
          fetchImpl: async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              if (!signal) {
                reject(new Error('signal missing'));
                return;
              }
              signal.addEventListener(
                'abort',
                () => reject(signal.reason ?? new Error('aborted')),
                { once: true },
              );
            }),
        },
      ),
    /abort/i,
  );
});

test('webSearch falls back when the primary DuckDuckGo search path times out', async () => {
  let fallbackFetchCount = 0;

  const result = await webSearch(
    {
      query: 'timed out primary search',
    },
    {
      duckDuckSearchImpl: () =>
        new Promise<never>(() => {
          // Intentionally never resolves so the wrapper timeout drives fallback.
        }) as never,
      duckDuckSearchTimeoutMs: 10,
      fetchImpl: async () => {
        fallbackFetchCount += 1;
        return new Response(
          [
            '<html><body>',
            '<div class="result">',
            '<h2 class="result__title"><a href="https://example.com/fallback">Fallback Result</a></h2>',
            '<a class="result__snippet">Fallback search snippet.</a>',
            '</div>',
            '</body></html>',
          ].join(''),
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        );
      },
    },
  );

  assert.equal(fallbackFetchCount, 1);
  assert.equal(result.provider, 'duckduckgo-html');
  assert.equal(result.results[0]?.url, 'https://example.com/fallback');
});

test('readWebPage returns readable HTTP content when the first fetch is sufficient', async () => {
  const html = [
    '<html lang="en">',
    '<head>',
    '<title>Example article</title>',
    '<meta name="description" content="Demo description" />',
    '</head>',
    '<body>',
    '<main>',
    '<article>',
    '<h1>Example article</h1>',
    '<p>This is a long enough article body to avoid the Playwright fallback path.</p>',
    '<p>It contains enough text for readability extraction to keep the HTTP result.</p>',
    '</article>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');

  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/article',
      includeMetadata: true,
    },
    {
      fetchImpl: async () =>
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    },
  );

  assert.equal(result.modeUsed, 'http');
  assert.equal(result.readabilityApplied, true);
  assert.match(result.text, /long enough article body/u);
  assert.equal(result.metadata?.title, 'Example article');
});

test('readWebPage reports readabilityApplied false when readable extraction is disabled', async () => {
  const html = [
    '<html lang="en">',
    '<head><title>Simple page</title></head>',
    '<body><main><p>Visible body text.</p></main></body>',
    '</html>',
  ].join('');

  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/simple',
      extractReadableContent: false,
    },
    {
      fetchImpl: async () =>
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    },
  );

  assert.equal(result.readabilityApplied, false);
  assert.match(result.text, /Visible body text/u);
});

test('readWebPage allows public 169.x IPv4 hosts outside the link-local range', async () => {
  const result = await readWebPage(
    {
      url: 'https://169.20.10.5/article',
    },
    {
      fetchImpl: async () =>
        new Response('<html><body><main><p>Public content.</p></main></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    },
  );

  assert.equal(result.modeUsed, 'http');
  assert.match(result.text, /Public content/u);
});

test('readWebPage blocks IPv4 benchmarking addresses before fetching', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'https://198.18.0.10/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );
});

test('readWebPage blocks IPv4 multicast addresses before fetching', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'https://224.0.0.10/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );
});

test('readWebPage pins resolved public DNS answers through the direct HTTP path', async () => {
  let pinnedAddresses:
    | Array<{ address: string; family: 4 | 6 }>
    | undefined;

  const result = await readWebPage(
    {
      url: 'https://docs.example.dev/article',
    },
    {
      lookupImpl: ((async () => [
        {
          address: '93.184.216.34',
          family: 4 as const,
        },
      ]) as unknown) as typeof lookup,
      requestPinnedImpl: async ({ target }) => {
        pinnedAddresses = [...target.pinnedAddresses];
        return {
          finalUrl: target.url.toString(),
          html: '<html><body><main><p>Pinned content.</p></main></body></html>',
          contentType: 'text/html; charset=utf-8',
          httpStatus: 200,
        };
      },
    },
  );

  assert.deepEqual(pinnedAddresses, [
    {
      address: '93.184.216.34',
      family: 4,
    },
  ]);
  assert.equal(result.modeUsed, 'http');
  assert.match(result.text, /Pinned content/u);
});

test('readWebPage blocks private redirect targets on the pinned HTTP path', async () => {
  let requestCount = 0;

  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'https://docs.example.dev/article',
          mode: 'http',
        },
        {
          lookupImpl: ((async (hostname: string) => {
            if (hostname === 'docs.example.dev') {
              return [
                {
                  address: '93.184.216.34',
                  family: 4 as const,
                },
              ];
            }
            throw new Error(`unexpected lookup for ${hostname}`);
          }) as unknown) as typeof lookup,
          requestPinnedImpl: async ({ target }) => {
            requestCount += 1;
            return {
              finalUrl: target.url.toString(),
              html: '',
              contentType: 'text/html; charset=utf-8',
              httpStatus: 302,
              location: 'http://127.0.0.1/private',
            };
          },
        },
      ),
    /Blocked private IP address/u,
  );

  assert.equal(requestCount, 1);
});

test('readWebPage auto mode escalates to Playwright when HTTP content is a JS shell', async () => {
  const responses = [
    new Response(
      [
        '<html><head><title>Shell</title></head><body>',
        '<div id="root"></div>',
        '<script>window.__APP__ = true;</script>',
        '</body></html>',
      ].join(''),
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    ),
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'read-web-page-browser_run_code_unsafe',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                finalUrl: 'https://93.184.216.34/rendered',
                html: '<html><body><main><article><p>Rendered text from browser fallback.</p></article></main></body></html>',
              }),
            },
          ],
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    ),
  ];

  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/react-page',
    },
    {
      fetchImpl: async () => {
        const next = responses.shift();
        if (!next) {
          throw new Error('unexpected extra fetch');
        }
        return next;
      },
      resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
    },
  );

  assert.equal(result.modeUsed, 'playwright');
  assert.equal(result.finalUrl, 'https://93.184.216.34/rendered');
  assert.match(result.text, /Rendered text from browser fallback/u);
  assert.equal(result.diagnostics.fallbackReason, 'js_shell_detected');
});

test('readWebPage sends Playwright code that blocks redirected private navigation targets', async () => {
  let forwardedCode = '';
  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/react-page',
      mode: 'playwright',
    },
    {
      fetchImpl: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as {
          params?: { arguments?: { code?: string } };
        };
        forwardedCode = payload.params?.arguments?.code ?? '';
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'read-web-page-browser_run_code_unsafe',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    finalUrl: 'https://93.184.216.34/rendered',
                    html: '<html><body><main><article><p>Rendered text from browser fallback.</p></article></main></body></html>',
                  }),
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
      resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
    },
  );

  assert.equal(result.modeUsed, 'playwright');
  assert.match(forwardedCode, /page\.route\('\*\*\/\*'/u);
  assert.match(forwardedCode, /blockedNavigationError/u);
  assert.match(forwardedCode, /assertSafeBrowserUrl/u);
  assert.match(forwardedCode, /hostIpVersion === 0/u);
  assert.match(forwardedCode, /Blocked non-IP hostname in Playwright fallback/u);
  assert.match(forwardedCode, /route\.request\(\)\.url\(\)/u);
  assert.doesNotMatch(forwardedCode, /isNavigationRequest/u);
  assert.doesNotMatch(forwardedCode, /hostnameResolutionCache/u);
  assert.doesNotMatch(forwardedCode, /lookup\(normalizedHostname/u);
});

test('readWebPage blocks private-network URLs before fetching', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://localhost:3000/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked local hostname/u,
  );
});

test('readWebPage blocks IPv4-mapped IPv6 loopback URLs before fetching', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://[::ffff:127.0.0.1]/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );
});

test('readWebPage blocks IPv6 unspecified URLs before fetching', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://[::]/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );
});

test('readWebPage blocks expanded IPv6 loopback URLs before fetching', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://[0:0:0:0:0:0:0:1]/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );
});

test('readWebPage blocks IPv6 link-local hosts across the full fe80::/10 range', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://[fe90::1]/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );
});

test('readWebPage blocks IPv6 site-local and multicast hosts before fetching', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://[fec0::1]/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );

  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://[ff02::1]/private',
        },
        {
          fetchImpl: async () => {
            throw new Error('fetch should not be called');
          },
        },
      ),
    /Blocked private IP address/u,
  );
});

test('readWebPage rejects oversized bodies on the custom fetch path', async () => {
  const oversizedBody = new Uint8Array(2 * 1024 * 1024 + 1).fill(97);
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'https://93.184.216.34/large',
          mode: 'http',
        },
        {
          fetchImpl: async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(oversizedBody);
                  controller.close();
                },
              }),
              {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' },
              },
            ),
        },
      ),
    /exceeded 2097152 bytes/u,
  );
});

test('readWebPage rejects oversized bodies on the pinned direct HTTP path', async () => {
  mock.method(http, 'request', (...args: Parameters<typeof http.request>) => {
    const callback = args[args.length - 1];
    const response = new PassThrough() as PassThrough & {
      statusCode?: number;
      headers?: Record<string, string>;
    };
    response.statusCode = 200;
    response.headers = {
      'content-type': 'text/html; charset=utf-8',
    };

    const request = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, listener: () => void) => void;
      destroy: (error?: Error) => void;
      end: () => void;
    };
    request.setTimeout = (ms, listener) => {
      void ms;
      void listener;
    };
    request.destroy = (error?: Error) => {
      void error;
    };
    request.end = () => {
      if (typeof callback === 'function') {
        callback(response as unknown as Parameters<typeof callback>[0]);
      }
      response.emit(
        'data',
        Buffer.alloc(2 * 1024 * 1024 + 1, 'a'),
      );
      response.emit('end');
    };

    return request as unknown as ReturnType<typeof http.request>;
  });

  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'http://93.184.216.34/large',
          mode: 'http',
        },
        {
          fetchImpl: fetch,
        },
      ),
    /exceeded 2097152 bytes/u,
  );
});

test('readWebPage rejects oversized remote MCP payloads on the Playwright fallback path', async () => {
  const oversizedBody = new Uint8Array(2 * 1024 * 1024 + 1).fill(97);

  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'https://93.184.216.34/react-page',
          mode: 'playwright',
        },
        {
          fetchImpl: async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(oversizedBody);
                  controller.close();
                },
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              },
            ),
          resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
        },
      ),
    /Remote MCP response from http:\/\/playwright\.test\/mcp exceeded 2097152 bytes/u,
  );
});

test('readWebPage forwards longer explicit HTTP timeouts without clamping them to the Playwright default', async () => {
  let observedTimeoutMs: number | undefined;

  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/article',
      mode: 'http',
      timeoutMs: 60_000,
    },
    {
      requestPinnedImpl: async ({ target, timeoutMs }) => {
        observedTimeoutMs = timeoutMs;
        return {
          finalUrl: target.url.toString(),
          html: '<html><body><main><p>Timeout preserved.</p></main></body></html>',
          contentType: 'text/html; charset=utf-8',
          httpStatus: 200,
        };
      },
    },
  );

  assert.equal(observedTimeoutMs, 60_000);
  assert.match(result.text, /Timeout preserved/u);
});

test('readWebPage Playwright mode honors shorter explicit timeouts in generated browser code', async () => {
  let forwardedCode = '';

  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/react-page',
      mode: 'playwright',
      timeoutMs: 1_234,
    },
    {
      fetchImpl: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as {
          params?: { arguments?: { code?: string } };
        };
        forwardedCode = payload.params?.arguments?.code ?? '';
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'read-web-page-browser_run_code_unsafe',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    finalUrl: 'https://93.184.216.34/rendered',
                    html: '<html><body><main><article><p>Rendered text.</p></article></main></body></html>',
                  }),
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
      resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
    },
  );

  assert.equal(result.modeUsed, 'playwright');
  assert.match(forwardedCode, /timeout: 1234/u);
  assert.match(forwardedCode, /waitForLoadState\('load', \{ timeout: 1234 \}\)/u);
});

test('readWebPage explicit Playwright mode rejects hostname URLs to avoid browser-path DNS rebinding', async () => {
  await assert.rejects(
    () =>
      readWebPage(
        {
          url: 'https://example.com/react-page',
          mode: 'playwright',
        },
        {
          fetchImpl: async () => {
            throw new Error('remote MCP should not be called');
          },
          resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
        },
      ),
    /IP-literal URL/u,
  );
});

test('readWebPage Playwright mode accepts multi-event SSE payloads from remote MCP', async () => {
  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/react-page',
      mode: 'playwright',
    },
    {
      fetchImpl: async () =>
        new Response(
          [
            'event: message',
            'data: {"jsonrpc":"2.0","id":"read-web-page-browser_run_code_unsafe","result":{"content":[{"type":"text","text":"progress"}]}}',
            '',
            'event: message',
            'data: {"jsonrpc":"2.0","id":"read-web-page-browser_run_code_unsafe","result":{"content":[{"type":"text","text":"{\\"finalUrl\\":\\"https://93.184.216.34/rendered\\",\\"html\\":\\"<html><body><main><article><p>Rendered from SSE.</p></article></main></body></html>\\"}"}]}}',
            '',
          ].join('\n'),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
    },
  );

  assert.equal(result.modeUsed, 'playwright');
  assert.match(result.text, /Rendered from SSE/u);
});

test('readWebPage Playwright mode accepts multi-line SSE event payloads from remote MCP', async () => {
  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/react-page',
      mode: 'playwright',
    },
    {
      fetchImpl: async () =>
        new Response(
          [
            'event: message',
            'data: {',
            'data: "jsonrpc":"2.0",',
            'data: "id":"read-web-page-browser_run_code_unsafe",',
            'data: "result":{"content":[{"type":"text","text":"{\\"finalUrl\\":\\"https://93.184.216.34/rendered\\",\\"html\\":\\"<html><body><main><article><p>Rendered from multi-line SSE.</p></article></main></body></html>\\"}"}]}}',
            '',
          ].join('\n'),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
    },
  );

  assert.equal(result.modeUsed, 'playwright');
  assert.match(result.text, /Rendered from multi-line SSE/u);
});

test('readWebPage Playwright mode prefers the final JSON text chunk when remote MCP content includes progress text', async () => {
  const result = await readWebPage(
    {
      url: 'https://93.184.216.34/react-page',
      mode: 'playwright',
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'read-web-page-browser_run_code_unsafe',
            result: {
              content: [
                { type: 'text', text: 'progress' },
                {
                  type: 'text',
                  text: JSON.stringify({
                    finalUrl: 'https://93.184.216.34/rendered',
                    html: '<html><body><main><article><p>Rendered from final JSON.</p></article></main></body></html>',
                  }),
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      resolvePlaywrightMcpUrl: () => 'http://playwright.test/mcp',
    },
  );

  assert.equal(result.modeUsed, 'playwright');
  assert.match(result.text, /Rendered from final JSON/u);
});
