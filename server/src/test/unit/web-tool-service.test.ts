import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readWebPage,
  webSearch,
} from '../../webTools/toolService.js';

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
