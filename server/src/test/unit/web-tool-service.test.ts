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

test('webSearch falls back to DuckDuckGo HTML scraping when duck-duck-scrape is blocked', async () => {
  const result = await webSearch(
    {
      query: 'OpenAI latest news',
      maxResults: 2,
    },
    {
      duckDuckSearchImpl: async () => {
        throw new Error(
          'DDG detected an anomaly in the request, you are likely making requests too quickly.',
        );
      },
      fetchImpl: async () =>
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
        ),
    },
  );

  assert.equal(result.provider, 'duckduckgo-html');
  assert.equal(result.results[0]?.url, 'https://openai.com/news/');
  assert.equal(result.results[0]?.hostname, 'openai.com');
  assert.equal(result.results[0]?.snippet, 'Latest updates from OpenAI.');
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
  assert.match(result.text, /long enough article body/u);
  assert.equal(result.metadata?.title, 'Example article');
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
  assert.match(forwardedCode, /hostnameResolutionCache/u);
  assert.match(forwardedCode, /Blocked DNS rebinding/u);
  assert.match(forwardedCode, /route\.request\(\)\.url\(\)/u);
  assert.doesNotMatch(forwardedCode, /isNavigationRequest/u);
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
