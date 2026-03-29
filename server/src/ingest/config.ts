import { OPENAI_MAX_INPUTS_PER_REQUEST } from './providers/openaiConstants.js';
import { IngestConfig } from './types.js';

const DEFAULT_LARGE_TEXT_THRESHOLD_BYTES = 65536;
export const DEFAULT_OPENAI_MAX_BATCH_SIZE = 20;
export const DEFAULT_OPENAI_MAX_INFLIGHT = 10;
export const DEFAULT_LMSTUDIO_MAX_BATCH_SIZE = 1;
export const DEFAULT_LMSTUDIO_MAX_INFLIGHT = 4;
export const DEFAULT_INGEST_MAX_QUEUE_SIZE = -1;
export const MAX_OPENAI_INFLIGHT = 10;
export const MAX_LMSTUDIO_BATCH_SIZE = 1;
export const MAX_LMSTUDIO_INFLIGHT = 4;

const defaultIncludes = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'jsonc',
  'md',
  'mdx',
  'txt',
  'py',
  'java',
  'kt',
  'kts',
  'go',
  'rs',
  'rb',
  'php',
  'cs',
  'cpp',
  'cc',
  'c',
  'h',
  'hpp',
  'swift',
  'scala',
  'clj',
  'cljs',
  'edn',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'env',
  'sql',
];

const defaultExcludes = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'logs',
  'vendor',
];

function parseFiniteNumberWithFallback(
  rawValue: string | undefined,
  fallback: number,
  { min }: { min?: number } = {},
): number {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  if (typeof min === 'number' && parsed < min) return fallback;
  return parsed;
}

function parseClampedIntegerWithFallback(
  rawValue: string | undefined,
  fallback: number,
  { min, max }: { min?: number; max?: number } = {},
): number {
  const parsed = parseFiniteNumberWithFallback(rawValue, fallback, { min });
  const floored = Math.floor(parsed);
  if (typeof max === 'number' && floored > max) return max;
  return floored;
}

function parseQueueCap(rawValue: string | undefined): number {
  const parsed = Number(rawValue ?? DEFAULT_INGEST_MAX_QUEUE_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_INGEST_MAX_QUEUE_SIZE;
  return Math.max(DEFAULT_INGEST_MAX_QUEUE_SIZE, Math.floor(parsed));
}

export function resolveConfig(): IngestConfig {
  const envIncludes =
    process.env.CODEINFO_INGEST_INCLUDE?.split(',')
      .filter(Boolean)
      .map((s) => s.trim()) ?? [];
  const includes = envIncludes.length ? envIncludes : defaultIncludes;

  const envExcludes =
    process.env.CODEINFO_INGEST_EXCLUDE?.split(',')
      .filter(Boolean)
      .map((s) => s.trim()) ?? [];
  const excludes = Array.from(new Set([...defaultExcludes, ...envExcludes]));

  const tokenSafetyMargin = parseFiniteNumberWithFallback(
    process.env.CODEINFO_INGEST_TOKEN_MARGIN,
    0.85,
  );
  const fallbackTokenLimit = parseFiniteNumberWithFallback(
    process.env.CODEINFO_INGEST_FALLBACK_TOKENS,
    2048,
    { min: 1 },
  );
  const rawFlushEvery = Number(process.env.CODEINFO_INGEST_FLUSH_EVERY ?? 20);
  const flushEvery = Number.isFinite(rawFlushEvery)
    ? Math.min(500, Math.max(1, Math.floor(rawFlushEvery)))
    : 20;
  const largeTextThresholdBytes = Math.floor(
    parseFiniteNumberWithFallback(
      process.env.CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES,
      DEFAULT_LARGE_TEXT_THRESHOLD_BYTES,
      { min: 1 },
    ),
  );
  const openAiMaxBatchSize = parseClampedIntegerWithFallback(
    process.env.CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE,
    DEFAULT_OPENAI_MAX_BATCH_SIZE,
    {
      min: 1,
      max: OPENAI_MAX_INPUTS_PER_REQUEST,
    },
  );
  const openAiMaxInFlight = parseClampedIntegerWithFallback(
    process.env.CODEINFO_INGEST_OPENAI_MAX_INFLIGHT,
    DEFAULT_OPENAI_MAX_INFLIGHT,
    {
      min: 1,
      max: MAX_OPENAI_INFLIGHT,
    },
  );
  const lmStudioMaxBatchSize = parseClampedIntegerWithFallback(
    process.env.CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE,
    DEFAULT_LMSTUDIO_MAX_BATCH_SIZE,
    {
      min: 1,
      max: MAX_LMSTUDIO_BATCH_SIZE,
    },
  );
  const lmStudioMaxInFlight = parseClampedIntegerWithFallback(
    process.env.CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT,
    DEFAULT_LMSTUDIO_MAX_INFLIGHT,
    {
      min: 1,
      max: MAX_LMSTUDIO_INFLIGHT,
    },
  );
  const maxQueueSize = parseQueueCap(
    process.env.CODEINFO_INGEST_MAX_QUEUE_SIZE,
  );

  return {
    includes,
    excludes,
    tokenSafetyMargin,
    fallbackTokenLimit,
    flushEvery,
    largeTextThresholdBytes,
    openAiMaxBatchSize,
    openAiMaxInFlight,
    lmStudioMaxBatchSize,
    lmStudioMaxInFlight,
    maxQueueSize,
  };
}
