import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export const STARTUP_ENV_ORDER = ['server/.env', 'server/.env.local'] as const;

export type StartupEnvLoadResult = {
  orderedFiles: readonly string[];
  loadedFiles: readonly string[];
  overrideApplied: boolean;
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
  const assignParsedValues = (filePath: string, allowFileOverride = false) => {
    const parsed = parse(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (preseededKeys.has(key)) continue;
      if (!allowFileOverride && key in targetEnv) continue;
      targetEnv[key] = value;
    }
  };

  if (envExists) assignParsedValues(envPath);
  if (envLocalExists) assignParsedValues(envLocalPath, true);

  return {
    orderedFiles: STARTUP_ENV_ORDER,
    loadedFiles: [
      ...(envExists ? (['server/.env'] as const) : []),
      ...(envLocalExists ? (['server/.env.local'] as const) : []),
    ],
    overrideApplied: envLocalExists,
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
  const key = env.OPENAI_EMBEDDING_KEY;
  return { enabled: typeof key === 'string' && key.trim().length > 0 };
};
