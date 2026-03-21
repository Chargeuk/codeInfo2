import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export const STARTUP_ENV_ORDER = ['server/.env', 'server/.env.local'] as const;
export const SERVER_CODEINFO_ENV_NAMES = [
  'CODEINFO_SERVER_PORT',
  'CODEINFO_LMSTUDIO_BASE_URL',
  'CODEINFO_CHROMA_URL',
  'CODEINFO_MONGO_URI',
  'CODEINFO_MCP_PORT',
  'CODEINFO_CHAT_MCP_PORT',
  'CODEINFO_AGENTS_MCP_PORT',
  'CODEINFO_PLAYWRIGHT_MCP_URL',
  'CODEINFO_OPENAI_EMBEDDING_KEY',
  'CODEINFO_CHAT_DEFAULT_PROVIDER',
  'CODEINFO_CHAT_DEFAULT_MODEL',
  'CODEINFO_INGEST_INCLUDE',
  'CODEINFO_INGEST_EXCLUDE',
  'CODEINFO_INGEST_TOKEN_MARGIN',
  'CODEINFO_INGEST_FALLBACK_TOKENS',
  'CODEINFO_INGEST_FLUSH_EVERY',
  'CODEINFO_INGEST_COLLECTION',
  'CODEINFO_INGEST_ROOTS_COLLECTION',
  'CODEINFO_INGEST_TEST_GIT_PATHS',
  'CODEINFO_HOST_INGEST_DIR',
  'CODEINFO_LOG_FILE_PATH',
  'CODEINFO_LOG_LEVEL',
  'CODEINFO_LOG_BUFFER_MAX',
  'CODEINFO_LOG_MAX_CLIENT_BYTES',
  'CODEINFO_LOG_INGEST_WS_THROTTLE_MS',
  'CODEINFO_LOG_FILE_ROTATE',
  'CODEINFO_OPENAI_INGEST_MAX_RETRIES',
] as const;

export type StartupEnvValueSource =
  | 'preseeded'
  | 'server/.env'
  | 'server/.env.local'
  | 'absent';

export type StartupEnvLoadResult = {
  orderedFiles: readonly string[];
  loadedFiles: readonly string[];
  overrideApplied: boolean;
  valueSources: Record<string, StartupEnvValueSource>;
};

export type CodeinfoEnvResolution = {
  name: (typeof SERVER_CODEINFO_ENV_NAMES)[number];
  source: StartupEnvValueSource;
  defined: boolean;
  nonEmpty: boolean;
};

const resolveServerRoot = () => {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), '../..');
};

let cachedStartupEnvLoad: StartupEnvLoadResult | null = null;

export const resetStartupEnvLoadCacheForTests = () => {
  cachedStartupEnvLoad = null;
};

export const loadStartupEnv = ({
  serverRoot = resolveServerRoot(),
  targetEnv = process.env,
}: {
  serverRoot?: string;
  targetEnv?: NodeJS.ProcessEnv;
} = {}): StartupEnvLoadResult => {
  const envPath = path.resolve(serverRoot, '.env');
  const envLocalPath = path.resolve(serverRoot, '.env.local');
  const envExists = fs.existsSync(envPath);
  const envLocalExists = fs.existsSync(envLocalPath);

  const preseededKeys = new Set(Object.keys(targetEnv));
  const valueSources: Record<string, StartupEnvValueSource> = {};
  for (const key of preseededKeys) {
    valueSources[key] = 'preseeded';
  }

  const assignParsedValues = (
    filePath: string,
    source: Extract<StartupEnvValueSource, 'server/.env' | 'server/.env.local'>,
    allowFileOverride = false,
  ) => {
    const parsed = parse(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (preseededKeys.has(key)) continue;
      if (!allowFileOverride && key in targetEnv) continue;
      targetEnv[key] = value;
      valueSources[key] = source;
    }
  };

  if (envExists) assignParsedValues(envPath, 'server/.env');
  if (envLocalExists)
    assignParsedValues(envLocalPath, 'server/.env.local', true);

  return {
    orderedFiles: STARTUP_ENV_ORDER,
    loadedFiles: [
      ...(envExists ? (['server/.env'] as const) : []),
      ...(envLocalExists ? (['server/.env.local'] as const) : []),
    ],
    overrideApplied: envLocalExists,
    valueSources,
  };
};

export const ensureStartupEnvLoaded = (): StartupEnvLoadResult => {
  if (cachedStartupEnvLoad) return cachedStartupEnvLoad;
  cachedStartupEnvLoad = loadStartupEnv();
  return cachedStartupEnvLoad;
};

export const resolveOpenAiEmbeddingCapabilityState = (
  env: Record<string, string | undefined> = process.env,
): { enabled: boolean } => {
  const key = env.CODEINFO_OPENAI_EMBEDDING_KEY;
  return { enabled: typeof key === 'string' && key.trim().length > 0 };
};

export const resolveCodeinfoEnvResolutions = ({
  env = process.env,
  loadResult = ensureStartupEnvLoaded(),
}: {
  env?: Record<string, string | undefined>;
  loadResult?: StartupEnvLoadResult;
} = {}): CodeinfoEnvResolution[] =>
  SERVER_CODEINFO_ENV_NAMES.map((name) => {
    const rawValue = env[name];
    return {
      name,
      source: loadResult.valueSources[name] ?? 'absent',
      defined: typeof rawValue === 'string',
      nonEmpty: typeof rawValue === 'string' && rawValue.trim().length > 0,
    };
  });
