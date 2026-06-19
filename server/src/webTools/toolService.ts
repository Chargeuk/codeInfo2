import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import {
  SafeSearchType,
  search as duckDuckSearch,
} from 'duck-duck-scrape';
import { JSDOM } from 'jsdom';
import { resolveCodeinfoMcpEndpointContract } from '../config/mcpEndpoints.js';

const DEFAULT_MAX_SEARCH_RESULTS = 5;
const DEFAULT_MAX_CHARS = 120_000;
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 5;
const MAX_FETCHED_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT =
  'codeinfo2-web-tools/0.0.1 (+https://localhost/codeinfo2)';
const DYNAMIC_SHELL_MARKERS = [
  'id="__next"',
  "id='__next'",
  'id="root"',
  "id='root'",
  'data-reactroot',
  'data-react-checksum',
  'enable javascript',
  'javascript is required',
  'loading...',
];
const PLAYWRIGHT_RUN_CODE_TOOL_NAMES = [
  'browser_run_code_unsafe',
  'browser_run_code',
];

export type WebSearchParams = {
  query: string;
  maxResults?: number;
  safeSearch?: 'strict' | 'moderate' | 'off';
  region?: string;
  locale?: string;
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  hostname: string;
  snippet: string;
};

export type WebSearchResult = {
  query: string;
  provider: 'duck-duck-scrape' | 'duckduckgo-html';
  noResults: boolean;
  results: WebSearchResultItem[];
  diagnostics: {
    maxResults: number;
    resultCount: number;
    durationMs: number;
  };
};

export type ReadWebPageMode = 'auto' | 'http' | 'playwright';

export type ReadWebPageParams = {
  url: string;
  mode?: ReadWebPageMode;
  extractReadableContent?: boolean;
  includeRawHtml?: boolean;
  includeLinks?: boolean;
  includeMetadata?: boolean;
  maxChars?: number;
  timeoutMs?: number;
  likelyDynamic?: boolean;
};

export type ReadWebPageLink = {
  text: string;
  href: string;
};

export type ReadWebPageMetadata = {
  title?: string;
  description?: string;
  siteName?: string;
  author?: string;
  publishedTime?: string;
  lang?: string;
};

export type ReadWebPageResult = {
  url: string;
  finalUrl: string;
  modeUsed: 'http' | 'playwright';
  readabilityApplied: boolean;
  text: string;
  excerpt?: string;
  metadata?: ReadWebPageMetadata;
  links?: ReadWebPageLink[];
  rawHtml?: string;
  diagnostics: {
    httpStatus?: number;
    contentType?: string;
    fetchMs: number;
    renderMs?: number;
    fallbackReason?: string;
    truncated: boolean;
  };
};

type ParsedMcpPayload =
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      result: unknown;
    }
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      error: {
        code?: number;
        message?: string;
        data?: unknown;
      };
    };

type PlaywrightRenderPayload = {
  finalUrl: string;
  html: string;
};

type ResolvedRemoteAddress = {
  address: string;
  family: 4 | 6;
};

type SafeRemoteTarget = {
  url: URL;
  normalizedHostname: string;
  pinnedAddresses: ResolvedRemoteAddress[];
};

type PinnedHttpResponse = {
  finalUrl: string;
  html: string;
  contentType: string;
  httpStatus: number;
  location?: string;
};

export type ReadWebPageDeps = {
  fetchImpl?: typeof fetch;
  duckDuckSearchImpl?: typeof duckDuckSearch;
  duckDuckGoHtmlTimeoutMs?: number;
  lookupImpl?: typeof lookup;
  requestPinnedImpl?: (params: {
    target: SafeRemoteTarget;
    timeoutMs: number;
  }) => Promise<PinnedHttpResponse>;
  resolvePlaywrightMcpUrl?: () => string | null;
};

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const decodeHtmlText = (value: string): string =>
  normalizeWhitespace(cheerio.load(`<div>${value}</div>`)('div').text());

const resolveDuckDuckGoResultUrl = (value: string): string => {
  const candidate = value.startsWith('//') ? `https:${value}` : value;
  try {
    const parsed = new URL(candidate, 'https://duckduckgo.com');
    const redirected = parsed.searchParams.get('uddg');
    if (redirected) {
      return redirected;
    }
    return parsed.toString();
  } catch {
    return candidate;
  }
};

const mapSafeSearch = (value: WebSearchParams['safeSearch']) => {
  switch (value) {
    case 'strict':
      return SafeSearchType.STRICT;
    case 'off':
      return SafeSearchType.OFF;
    case 'moderate':
    default:
      return SafeSearchType.MODERATE;
  }
};

const normalizeIpHostLiteral = (value: string): string =>
  value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;

const isPrivateIpv4 = (ip: string): boolean => {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
};

const isPrivateIpv6 = (ip: string): boolean => {
  const normalized = normalizeIpHostLiteral(ip).toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    if (isIP(mappedIpv4) === 4) {
      return isPrivateIpv4(mappedIpv4);
    }
    const mappedSegments = mappedIpv4.split(':');
    if (mappedSegments.length === 2) {
      const high = Number.parseInt(mappedSegments[0] ?? '', 16);
      const low = Number.parseInt(mappedSegments[1] ?? '', 16);
      if (
        Number.isInteger(high) &&
        Number.isInteger(low) &&
        high >= 0 &&
        high <= 0xffff &&
        low >= 0 &&
        low <= 0xffff
      ) {
        return isPrivateIpv4(
          [
            (high >> 8) & 0xff,
            high & 0xff,
            (low >> 8) & 0xff,
            low & 0xff,
          ].join('.'),
        );
      }
    }
  }
  return (
    normalized === '::' ||
    normalized === '0:0:0:0:0:0:0:0' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
};

function createBodyTooLargeError(context: string): Error {
  return new Error(
    `${context} exceeded ${MAX_FETCHED_BODY_BYTES} bytes while buffering response content`,
  );
}

async function readResponseTextCapped(
  response: Response,
  context: string,
): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_FETCHED_BODY_BYTES) {
        await reader.cancel(createBodyTooLargeError(context)).catch(() => {});
        throw createBodyTooLargeError(context);
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf8');
}

function buildPinnedLookup(
  addresses: ReadonlyArray<ResolvedRemoteAddress>,
): LookupFunction {
  return (hostname, options, callback) => {
    const preferredFamily =
      typeof options === 'number'
        ? options
        : typeof options?.family === 'number'
          ? options.family
          : 0;
    const candidates =
      preferredFamily === 0
        ? addresses
        : addresses.filter((entry) => entry.family === preferredFamily);

    if (candidates.length === 0) {
      callback(
        new Error(`No validated DNS answers available for ${hostname}`),
        undefined as never,
        undefined as never,
      );
      return;
    }

    if (typeof options === 'object' && options?.all) {
      callback(null, candidates as never);
      return;
    }

    callback(null, candidates[0].address, candidates[0].family);
  };
}

async function performPinnedHttpRequest(params: {
  target: SafeRemoteTarget;
  timeoutMs: number;
}): Promise<PinnedHttpResponse> {
  const requestImpl =
    params.target.url.protocol === 'https:' ? https.request : http.request;

  return new Promise<PinnedHttpResponse>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    const request = requestImpl(
      params.target.url,
      {
        method: 'GET',
        lookup: buildPinnedLookup(params.target.pinnedAddresses),
        servername: params.target.normalizedHostname,
        headers: {
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
          'user-agent': DEFAULT_USER_AGENT,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on('data', (chunk) => {
          const buffer =
            typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          totalBytes += buffer.length;
          if (totalBytes > MAX_FETCHED_BODY_BYTES) {
            const error = createBodyTooLargeError(
              `Response body for ${params.target.url}`,
            );
            response.destroy(error);
            request.destroy(error);
            fail(error);
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          if (settled) {
            return;
          }
          settled = true;
          const html = Buffer.concat(chunks).toString('utf8');
          resolve({
            finalUrl: params.target.url.toString(),
            html,
            contentType: String(response.headers['content-type'] ?? ''),
            httpStatus: response.statusCode ?? 0,
            location:
              typeof response.headers.location === 'string'
                ? response.headers.location
                : Array.isArray(response.headers.location)
                  ? response.headers.location[0]
                  : undefined,
          });
        });
        response.on('error', (error) => {
          fail(error instanceof Error ? error : new Error(String(error)));
        });
      },
    );

    request.setTimeout(params.timeoutMs, () => {
      request.destroy(
        new Error(`Request timed out after ${params.timeoutMs}ms`),
      );
    });
    request.on('error', (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
    request.end();
  });
}

async function assertSafeRemoteUrl(
  input: string,
  lookupImpl: typeof lookup = lookup,
): Promise<SafeRemoteTarget> {
  const parsed = new URL(input);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Embedded URL credentials are not allowed');
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  const normalizedHostname = normalizeIpHostLiteral(hostname);
  if (
    hostname === 'localhost' ||
    hostname === 'host.docker.internal' ||
    hostname.endsWith('.local')
  ) {
    throw new Error(`Blocked local hostname: ${parsed.hostname}`);
  }

  const hostIpVersion = isIP(normalizedHostname);
  if (
    (hostIpVersion === 4 && isPrivateIpv4(normalizedHostname)) ||
    (hostIpVersion === 6 && isPrivateIpv6(normalizedHostname))
  ) {
    throw new Error(`Blocked private IP address: ${parsed.hostname}`);
  }

  const pinnedAddresses: ResolvedRemoteAddress[] = [];
  if (hostIpVersion === 0) {
    const addresses = await lookupImpl(normalizedHostname, {
      all: true,
      verbatim: true,
    });
    if (addresses.length === 0) {
      throw new Error(`Unable to resolve host: ${parsed.hostname}`);
    }
    for (const address of addresses) {
      if (
        (address.family === 4 && isPrivateIpv4(address.address)) ||
        (address.family === 6 && isPrivateIpv6(address.address))
      ) {
        throw new Error(`Blocked private host resolution for ${parsed.hostname}`);
      }
      pinnedAddresses.push({
        address: address.address,
        family: address.family as 4 | 6,
      });
    }
  } else {
    pinnedAddresses.push({
      address: normalizedHostname,
      family: hostIpVersion as 4 | 6,
    });
  }

  return {
    url: parsed,
    normalizedHostname,
    pinnedAddresses,
  };
}

async function fetchWithRedirects(params: {
  url: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  lookupImpl?: typeof lookup;
  requestPinnedImpl?: (params: {
    target: SafeRemoteTarget;
    timeoutMs: number;
  }) => Promise<PinnedHttpResponse>;
}): Promise<{
  finalUrl: string;
  html: string;
  contentType: string;
  httpStatus: number;
}> {
  let currentUrl = params.url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const safeTarget = await assertSafeRemoteUrl(
      currentUrl,
      params.lookupImpl ?? lookup,
    );

    try {
      const response =
        params.fetchImpl === fetch
          ? await (params.requestPinnedImpl ?? performPinnedHttpRequest)({
              target: safeTarget,
              timeoutMs: params.timeoutMs,
            })
          : await (async () => {
              const controller = new AbortController();
              const timeout = setTimeout(
                () => controller.abort(),
                params.timeoutMs,
              );
              try {
                const fetchedResponse = await params.fetchImpl(currentUrl, {
                  method: 'GET',
                  redirect: 'manual',
                  signal: controller.signal,
                  headers: {
                    accept:
                      'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
                    'user-agent': DEFAULT_USER_AGENT,
                  },
                });
                return {
                  fetchedResponse,
                  cleanup: async () => {
                    clearTimeout(timeout);
                    await delay(0);
                  },
                };
              } catch (error) {
                clearTimeout(timeout);
                await delay(0);
                throw error;
              }
            })();

      if ('fetchedResponse' in response) {
        const { fetchedResponse } = response;
        try {
          if (
            fetchedResponse.status >= 300 &&
            fetchedResponse.status < 400 &&
            fetchedResponse.headers.get('location')
          ) {
            currentUrl = new URL(
              fetchedResponse.headers.get('location') ?? '',
              currentUrl,
            ).toString();
            continue;
          }

          if (!fetchedResponse.ok) {
            throw new Error(
              `HTTP ${fetchedResponse.status} while fetching ${currentUrl}`,
            );
          }

          return {
            finalUrl: fetchedResponse.url || currentUrl,
            html: await readResponseTextCapped(
              fetchedResponse,
              `Response body for ${currentUrl}`,
            ),
            contentType: fetchedResponse.headers.get('content-type') ?? '',
            httpStatus: fetchedResponse.status,
          };
        } finally {
          await response.cleanup();
        }
      }

      if (
        response.httpStatus >= 300 &&
        response.httpStatus < 400 &&
        response.location
      ) {
        currentUrl = new URL(response.location, currentUrl).toString();
        continue;
      }

      if (response.httpStatus < 200 || response.httpStatus >= 300) {
        throw new Error(`HTTP ${response.httpStatus} while fetching ${currentUrl}`);
      }

      return response;
    } finally {
      await delay(0);
    }
  }

  throw new Error(`Too many redirects while fetching ${params.url}`);
}

const truncateText = (value: string, maxChars: number) =>
  value.length > maxChars
    ? { text: value.slice(0, maxChars), truncated: true }
    : { text: value, truncated: false };

function extractFromHtml(params: {
  url: string;
  html: string;
  extractReadableContent: boolean;
  includeLinks: boolean;
  includeMetadata: boolean;
  includeRawHtml: boolean;
  maxChars: number;
  modeUsed: 'http' | 'playwright';
  diagnostics: ReadWebPageResult['diagnostics'];
}): ReadWebPageResult {
  const metadataDom = new JSDOM(params.html, { url: params.url });
  const readabilityDom = new JSDOM(params.html, { url: params.url });
  try {
    const $ = cheerio.load(params.html);
    const metadata: ReadWebPageMetadata | undefined = params.includeMetadata
      ? {
          title: normalizeWhitespace(
            $('meta[property="og:title"]').attr('content') ??
              $('title').text() ??
              '',
          ) || undefined,
          description: normalizeWhitespace(
            $('meta[name="description"]').attr('content') ??
              $('meta[property="og:description"]').attr('content') ??
              '',
          ) || undefined,
          siteName: normalizeWhitespace(
            $('meta[property="og:site_name"]').attr('content') ?? '',
          ) || undefined,
          author: normalizeWhitespace(
            $('meta[name="author"]').attr('content') ??
              $('[rel="author"]').first().text() ??
              '',
          ) || undefined,
          publishedTime: normalizeWhitespace(
            $('meta[property="article:published_time"]').attr('content') ??
              $('time[datetime]').first().attr('datetime') ??
              '',
          ) || undefined,
          lang: normalizeWhitespace(
            $('html').attr('lang') ??
              metadataDom.window.document.documentElement.lang,
          ) || undefined,
        }
      : undefined;

    const readabilityCandidate = params.extractReadableContent
      ? new Readability(readabilityDom.window.document).parse()
      : null;
    const readerable = params.extractReadableContent
      ? isProbablyReaderable(metadataDom.window.document)
      : false;

    const bodyText = normalizeWhitespace($('body').text());
    const selectedText = normalizeWhitespace(
      readabilityCandidate?.textContent ?? bodyText,
    );
    const excerpt = normalizeWhitespace(
      readabilityCandidate?.excerpt ?? selectedText.slice(0, 280),
    );
    const truncated = truncateText(selectedText, params.maxChars);

    const links = params.includeLinks
      ? $('a[href]')
          .toArray()
          .map((element) => {
            const href = $(element).attr('href') ?? '';
            const text = normalizeWhitespace($(element).text());
            if (!href) return null;
            try {
              const absoluteHref = new URL(href, params.url).toString();
              return {
                href: absoluteHref,
                text,
              };
            } catch {
              return null;
            }
          })
          .filter((entry): entry is ReadWebPageLink => Boolean(entry?.href))
          .slice(0, 25)
      : undefined;

    return {
      url: params.url,
      finalUrl: params.url,
      modeUsed: params.modeUsed,
      readabilityApplied: Boolean(readabilityCandidate) && readerable,
      text: truncated.text,
      excerpt: excerpt || undefined,
      ...(metadata ? { metadata } : {}),
      ...(links ? { links } : {}),
      ...(params.includeRawHtml ? { rawHtml: params.html } : {}),
      diagnostics: {
        ...params.diagnostics,
        truncated: truncated.truncated,
      },
    };
  } finally {
    metadataDom.window.close();
    readabilityDom.window.close();
  }
}

function shouldUsePlaywrightFallback(params: {
  html: string;
  text: string;
  likelyDynamic: boolean;
}): { shouldFallback: boolean; reason?: string } {
  if (params.likelyDynamic) {
    return { shouldFallback: true, reason: 'likely_dynamic_hint' };
  }

  const htmlLower = params.html.toLowerCase();
  const bodyTextLength = normalizeWhitespace(params.text).length;
  const shellMarkerPresent = DYNAMIC_SHELL_MARKERS.some((marker) =>
    htmlLower.includes(marker),
  );

  if (shellMarkerPresent && bodyTextLength < 1200) {
    return { shouldFallback: true, reason: 'js_shell_detected' };
  }

  if (bodyTextLength < 400) {
    return { shouldFallback: true, reason: 'content_too_thin' };
  }

  return { shouldFallback: false };
}

function parseJsonRpcPayload(rawBody: string): ParsedMcpPayload | null {
  const trimmed = rawBody.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as ParsedMcpPayload;
  } catch {
    const sseDataLine = trimmed
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!sseDataLine) {
      return null;
    }
    try {
      return JSON.parse(
        sseDataLine.slice('data:'.length).trim(),
      ) as ParsedMcpPayload;
    } catch {
      return null;
    }
  }
}

async function callRemoteMcp(params: {
  url: string;
  method: string;
  requestId: string;
  bodyParams?: unknown;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await params.fetchImpl(params.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: params.requestId,
        method: params.method,
        params: params.bodyParams,
      }),
    });
    const rawBody = await response.text();
    const payload = parseJsonRpcPayload(rawBody);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from remote MCP`);
    }
    if (!payload) {
      throw new Error(`Invalid JSON-RPC payload from remote MCP at ${params.url}`);
    }
    if ('error' in payload && payload.error) {
      const message =
        typeof payload.error === 'object' &&
        payload.error &&
        'message' in payload.error &&
        typeof payload.error.message === 'string'
          ? payload.error.message
          : 'Remote MCP error';
      throw new Error(message);
    }
    if (!('result' in payload)) {
      throw new Error(`Missing result payload from remote MCP at ${params.url}`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
    await delay(0);
  }
}

function extractMcpTextResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const content = (result as { content: Array<Record<string, unknown>> }).content;
    const textParts = content
      .map((entry) =>
        entry.type === 'text' && typeof entry.text === 'string'
          ? entry.text
          : null,
      )
      .filter((entry): entry is string => typeof entry === 'string');
    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  return JSON.stringify(result);
}

async function renderWithPlaywright(params: {
  url: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  resolvePlaywrightMcpUrl: () => string | null;
}): Promise<PlaywrightRenderPayload> {
  const playwrightMcpUrl = params.resolvePlaywrightMcpUrl();
  if (!playwrightMcpUrl) {
    throw new Error('Playwright MCP URL is not configured');
  }

  const requestTimeout = Math.max(params.timeoutMs, DEFAULT_PLAYWRIGHT_TIMEOUT_MS);
  const code = `async (page) => {
    const { lookup } = await import('node:dns/promises');
    const { isIP } = await import('node:net');
    const hostnameResolutionCache = new Map();
    const normalizeIpHostLiteral = (value) =>
      value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
    const isPrivateIpv4 = (ip) => {
      const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
      if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
        return false;
      }
      const [a, b] = parts;
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      );
    };
    const isPrivateIpv6 = (ip) => {
      const normalized = normalizeIpHostLiteral(ip).toLowerCase();
      if (normalized.startsWith('::ffff:')) {
        const mappedIpv4 = normalized.slice('::ffff:'.length);
        if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(mappedIpv4)) {
          return isPrivateIpv4(mappedIpv4);
        }
        const mappedSegments = mappedIpv4.split(':');
        if (mappedSegments.length === 2) {
          const high = Number.parseInt(mappedSegments[0] ?? '', 16);
          const low = Number.parseInt(mappedSegments[1] ?? '', 16);
          if (
            Number.isInteger(high) &&
            Number.isInteger(low) &&
            high >= 0 &&
            high <= 0xffff &&
            low >= 0 &&
            low <= 0xffff
          ) {
            return isPrivateIpv4(
              [
                (high >> 8) & 0xff,
                high & 0xff,
                (low >> 8) & 0xff,
                low & 0xff,
              ].join('.')
            );
          }
        }
      }
      return (
        normalized === '::' ||
        normalized === '0:0:0:0:0:0:0:0' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:')
      );
    };
    const assertSafeBrowserUrl = async (value) => {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http and https URLs are allowed');
      }
      if (parsed.username || parsed.password) {
        throw new Error('Embedded URL credentials are not allowed');
      }
      const hostname = parsed.hostname.trim().toLowerCase();
      const normalizedHostname = normalizeIpHostLiteral(hostname);
      if (
        hostname === 'localhost' ||
        hostname === 'host.docker.internal' ||
        hostname.endsWith('.local')
      ) {
        throw new Error('Blocked local hostname: ' + parsed.hostname);
      }
      if (
        isPrivateIpv4(normalizedHostname) ||
        isPrivateIpv6(normalizedHostname)
      ) {
        throw new Error('Blocked private IP address: ' + parsed.hostname);
      }
      if (isIP(normalizedHostname) === 0) {
        const addresses = await lookup(normalizedHostname, {
          all: true,
          verbatim: true,
        });
        if (!Array.isArray(addresses) || addresses.length === 0) {
          throw new Error('Unable to resolve host: ' + parsed.hostname);
        }
        for (const address of addresses) {
          if (
            (address.family === 4 && isPrivateIpv4(address.address)) ||
            (address.family === 6 && isPrivateIpv6(address.address))
          ) {
            throw new Error(
              'Blocked private host resolution for ' + parsed.hostname
            );
          }
        }
        const resolutionSignature = addresses
          .map((address) => address.family + ':' + address.address)
          .sort()
          .join(',');
        const previousResolution = hostnameResolutionCache.get(normalizedHostname);
        if (
          typeof previousResolution === 'string' &&
          previousResolution !== resolutionSignature
        ) {
          throw new Error('Blocked DNS rebinding for ' + parsed.hostname);
        }
        hostnameResolutionCache.set(normalizedHostname, resolutionSignature);
      }
    };
    let blockedNavigationError = null;
    await page.route('**/*', async (route) => {
      try {
        await assertSafeBrowserUrl(route.request().url());
      } catch (error) {
        blockedNavigationError =
          error instanceof Error ? error.message : String(error);
        await route.abort('blockedbyclient').catch(() => {});
        return;
      }
      await route.continue().catch(async () => {});
    });
    await page.goto(${JSON.stringify(params.url)}, {
      waitUntil: 'domcontentloaded',
      timeout: ${requestTimeout}
    }).catch((error) => {
      if (blockedNavigationError) {
        throw new Error(blockedNavigationError);
      }
      throw error;
    });
    if (blockedNavigationError) {
      throw new Error(blockedNavigationError);
    }
    await page.waitForLoadState('load', { timeout: ${requestTimeout} }).catch(() => {});
    await assertSafeBrowserUrl(page.url());
    await page
      .waitForFunction(
        () => (document.body?.innerText ?? '').trim().length > 500,
        { timeout: ${Math.min(requestTimeout, 7_000)} }
      )
      .catch(() => {});
    return JSON.stringify({
      finalUrl: page.url(),
      html: await page.content(),
    });
  }`;

  let lastError: Error | null = null;
  for (const toolName of PLAYWRIGHT_RUN_CODE_TOOL_NAMES) {
    try {
      const result = await callRemoteMcp({
        url: playwrightMcpUrl,
        method: 'tools/call',
        bodyParams: {
          name: toolName,
          arguments: { code },
        },
        requestId: `read-web-page-${toolName}`,
        timeoutMs: requestTimeout + 5_000,
        fetchImpl: params.fetchImpl,
      });
      const textResult = extractMcpTextResult(result);
      const parsed = JSON.parse(textResult) as PlaywrightRenderPayload;
      if (
        typeof parsed?.finalUrl === 'string' &&
        typeof parsed?.html === 'string'
      ) {
        return parsed;
      }
      throw new Error(`Unexpected Playwright MCP payload shape for ${toolName}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!/tool not found/i.test(lastError.message)) {
        break;
      }
    }
  }

  throw lastError ?? new Error('Playwright MCP browser-run tool unavailable');
}

async function searchDuckDuckGoHtml(params: {
  query: string;
  maxResults: number;
  region?: string;
  locale?: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<WebSearchResult> {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', params.query);
  if (params.region) {
    url.searchParams.set('kl', params.region);
  }
  if (params.locale) {
    url.searchParams.set('locale', params.locale);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  let html = '';

  try {
    const response = await params.fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTML search failed (${response.status})`);
    }

    html = await readResponseTextCapped(
      response,
      `DuckDuckGo HTML search response for ${params.query}`,
    );
  } finally {
    clearTimeout(timeout);
    await delay(0);
  }

  const $ = cheerio.load(html);
  const results = $('.result')
    .toArray()
    .map((element) => {
      const title = decodeHtmlText($(element).find('.result__title').text());
      const href = $(element).find('.result__title a').attr('href') ?? '';
      const snippet = decodeHtmlText(
        $(element).find('.result__snippet').text(),
      );
      if (!title || !href) {
        return null;
      }
      const urlValue = resolveDuckDuckGoResultUrl(href);
      let hostname = '';
      try {
        hostname = new URL(urlValue).hostname;
      } catch {
        hostname = '';
      }
      return {
        title,
        url: urlValue,
        hostname,
        snippet,
      };
    })
    .filter((entry): entry is WebSearchResultItem => Boolean(entry?.url))
    .slice(0, params.maxResults);

  return {
    query: params.query,
    provider: 'duckduckgo-html',
    noResults: results.length === 0,
    results,
    diagnostics: {
      maxResults: params.maxResults,
      resultCount: results.length,
      durationMs: 0,
    },
  };
}

export async function webSearch(
  params: WebSearchParams,
  deps: ReadWebPageDeps = {},
): Promise<WebSearchResult> {
  const startedAt = Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxResults = Math.min(
    Math.max(params.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS, 1),
    10,
  );
  try {
    const searchResult = await (deps.duckDuckSearchImpl ?? duckDuckSearch)(
      params.query,
      {
        safeSearch: mapSafeSearch(params.safeSearch),
        region: params.region ?? 'wt-wt',
        locale: params.locale ?? 'en-us',
      },
    );

    const results = searchResult.results.slice(0, maxResults).map((entry) => ({
      title: decodeHtmlText(entry.title),
      url: entry.url,
      hostname: entry.hostname,
      snippet: decodeHtmlText(entry.description),
    }));

    return {
      query: params.query,
      provider: 'duck-duck-scrape',
      noResults: searchResult.noResults,
      results,
      diagnostics: {
        maxResults,
        resultCount: results.length,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch {
    const fallback = await searchDuckDuckGoHtml({
      query: params.query,
      maxResults,
      region: params.region ?? 'wt-wt',
      locale: params.locale ?? 'en-us',
      timeoutMs: deps.duckDuckGoHtmlTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
      fetchImpl,
    });
    return {
      ...fallback,
      diagnostics: {
        ...fallback.diagnostics,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

export async function readWebPage(
  params: ReadWebPageParams,
  deps: ReadWebPageDeps = {},
): Promise<ReadWebPageResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookupImpl = deps.lookupImpl ?? lookup;
  const resolvePlaywrightMcpUrl =
    deps.resolvePlaywrightMcpUrl ??
    (() => resolveCodeinfoMcpEndpointContract().playwrightMcpUrl);
  const requestedMode = params.mode ?? 'auto';
  const extractReadableContent = params.extractReadableContent ?? true;
  const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
  const httpTimeoutMs = Math.min(
    params.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
    DEFAULT_PLAYWRIGHT_TIMEOUT_MS,
  );

  const validatedUrl = await assertSafeRemoteUrl(params.url, lookupImpl);

  if (requestedMode === 'playwright') {
    const renderStartedAt = Date.now();
    const rendered = await renderWithPlaywright({
      url: validatedUrl.url.toString(),
      timeoutMs: params.timeoutMs ?? DEFAULT_PLAYWRIGHT_TIMEOUT_MS,
      fetchImpl,
      resolvePlaywrightMcpUrl,
    });
    const validatedFinalUrl = await assertSafeRemoteUrl(
      rendered.finalUrl,
      lookupImpl,
    );
    const extracted = extractFromHtml({
      url: validatedFinalUrl.url.toString(),
      html: rendered.html,
      extractReadableContent,
      includeLinks: params.includeLinks ?? false,
      includeMetadata: params.includeMetadata ?? false,
      includeRawHtml: params.includeRawHtml ?? false,
      maxChars,
      modeUsed: 'playwright',
      diagnostics: {
        fetchMs: 0,
        renderMs: Date.now() - renderStartedAt,
        truncated: false,
      },
    });
    return {
      ...extracted,
      finalUrl: validatedFinalUrl.url.toString(),
    };
  }

  const fetchStartedAt = Date.now();
  const fetched = await fetchWithRedirects({
    url: validatedUrl.url.toString(),
    timeoutMs: httpTimeoutMs,
    fetchImpl,
    lookupImpl,
    requestPinnedImpl: deps.requestPinnedImpl,
  });
  const validatedFinalUrl = await assertSafeRemoteUrl(
    fetched.finalUrl,
    lookupImpl,
  );
  const httpResult = extractFromHtml({
    url: validatedFinalUrl.url.toString(),
    html: fetched.html,
    extractReadableContent,
    includeLinks: params.includeLinks ?? false,
    includeMetadata: params.includeMetadata ?? false,
    includeRawHtml: params.includeRawHtml ?? false,
    maxChars,
    modeUsed: 'http',
    diagnostics: {
      httpStatus: fetched.httpStatus,
      contentType: fetched.contentType,
      fetchMs: Date.now() - fetchStartedAt,
      truncated: false,
    },
  });

  if (requestedMode === 'http') {
    return {
      ...httpResult,
      finalUrl: validatedFinalUrl.url.toString(),
    };
  }

  const fallbackDecision = shouldUsePlaywrightFallback({
    html: fetched.html,
    text: httpResult.text,
    likelyDynamic: params.likelyDynamic ?? false,
  });
  if (!fallbackDecision.shouldFallback) {
    return {
      ...httpResult,
      finalUrl: validatedFinalUrl.url.toString(),
    };
  }

  try {
    const renderStartedAt = Date.now();
    const rendered = await renderWithPlaywright({
      url: validatedFinalUrl.url.toString(),
      timeoutMs: params.timeoutMs ?? DEFAULT_PLAYWRIGHT_TIMEOUT_MS,
      fetchImpl,
      resolvePlaywrightMcpUrl,
    });
    const renderedFinalUrl = await assertSafeRemoteUrl(
      rendered.finalUrl,
      lookupImpl,
    );
    const renderedResult = extractFromHtml({
      url: renderedFinalUrl.url.toString(),
      html: rendered.html,
      extractReadableContent,
      includeLinks: params.includeLinks ?? false,
      includeMetadata: params.includeMetadata ?? false,
      includeRawHtml: params.includeRawHtml ?? false,
      maxChars,
      modeUsed: 'playwright',
      diagnostics: {
        httpStatus: fetched.httpStatus,
        contentType: fetched.contentType,
        fetchMs: Date.now() - fetchStartedAt,
        renderMs: Date.now() - renderStartedAt,
        fallbackReason: fallbackDecision.reason,
        truncated: false,
      },
    });
    return {
      ...renderedResult,
      finalUrl: renderedFinalUrl.url.toString(),
    };
  } catch (error) {
    return {
      ...httpResult,
      finalUrl: validatedFinalUrl.url.toString(),
      diagnostics: {
        ...httpResult.diagnostics,
        fallbackReason:
          `${fallbackDecision.reason ?? 'playwright_fallback'}:` +
          `${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
